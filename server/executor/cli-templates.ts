export interface CLITemplate {
  /** The CLI command to spawn */
  command: string;
  /** Arguments template. Use {{prompt}} for the task prompt, {{systemPrompt}} for system prompt */
  args: string[];
  /** Whether to pass prompt via stdin instead of args */
  useStdin: boolean;
  /** Flag to skip interactive prompts/permissions */
  skipPermissionFlag: string | null;
  /** Flag for non-interactive/quiet mode */
  quietFlag: string | null;
  /** Flag to specify output format */
  outputFormatFlag: string | null;
  /** Default output format (can be overridden per execution) */
  defaultOutputFormat?: 'text' | 'json' | 'stream-json';
  /** How to extract token count from output (regex or null) */
  tokenPattern: string | null;
  /** Flag for interactive mode (bidirectional stdin/stdout control protocol) */
  interactiveFlag: string | null;
  /** How to pass image files to the CLI (e.g. '--image' for codex, null for others) */
  imageFlag: string | null;
  /** How to pass generic file attachments to the CLI (e.g. '--file' for claude/gemini, null for codex) */
  fileFlag: string | null;
  /** How to pass extra workspace directories outside cwd */
  extraDirFlag: string | null;
  /** Flag to resume a previous session by ID (null = not supported) */
  resumeFlag: string | null;
  /** Regex to extract session_id from CLI output */
  sessionIdPattern: string | null;
}

export const CLI_TEMPLATES: Record<string, CLITemplate> = {
  claude: {
    command: 'claude',
    args: ['-p', '{{prompt}}'],
    useStdin: false,
    skipPermissionFlag: '--dangerously-skip-permissions',
    quietFlag: null,
    outputFormatFlag: '--output-format',
    defaultOutputFormat: 'json',
    tokenPattern: '"total_tokens"\\s*:\\s*(\\d+)',
    interactiveFlag: '--permission-prompt-tool=stdio',
    imageFlag: null,
    fileFlag: '--file',
    extraDirFlag: '--add-dir',
    resumeFlag: '--resume',
    sessionIdPattern: '"session_id"\\s*:\\s*"([^"]+)"',
  },
  gemini: {
    command: 'gemini',
    args: ['-p', '{{prompt}}'],
    useStdin: false,
    skipPermissionFlag: '--yolo',
    quietFlag: null,
    outputFormatFlag: '-o',
    defaultOutputFormat: 'json',
    tokenPattern: null,
    interactiveFlag: null,
    imageFlag: null,
    fileFlag: '--file',
    extraDirFlag: '--include-directories',
    resumeFlag: '--resume',
    sessionIdPattern: '"session_id"\\s*:\\s*"([^"]+)"',
  },
  codex: {
    command: 'codex',
    args: ['exec'],
    useStdin: false,
    skipPermissionFlag: '--dangerously-bypass-approvals-and-sandbox',
    quietFlag: null,
    outputFormatFlag: null, // --json is a boolean flag, handled specially
    defaultOutputFormat: 'json',
    tokenPattern: '"input_tokens"\\s*:\\s*(\\d+)',
    interactiveFlag: null,
    imageFlag: '--image',
    fileFlag: null,
    extraDirFlag: '--add-dir',
    resumeFlag: null, // codex resume requires TTY — not supported in headless execution
    sessionIdPattern: '"thread_id"\\s*:\\s*"([^"]+)"',
  },
};

/** Build the full args array for a CLI invocation */
export function buildCliArgs(
  template: CLITemplate,
  prompt: string,
  options: {
    skipPermissions: boolean;
    systemPrompt?: string;
    maxTokens?: number;
    outputFormat?: 'text' | 'json' | 'stream-json';
    includePartialMessages?: boolean;
    interactive?: boolean;
    modelFlag?: string;
    imageFiles?: string[];
    attachmentFiles?: string[];
    additionalWorkspaceDirs?: string[];
    resumeSessionId?: string;
  }
): string[] {
  const args: string[] = [];
  let promptInserted = false;

  // Codex resume: `codex resume --full-auto <sessionId> <prompt>`
  if (options.resumeSessionId && template.command === 'codex' && template.resumeFlag) {
    args.push(template.resumeFlag);
    if (options.skipPermissions && template.skipPermissionFlag) {
      args.push(template.skipPermissionFlag);
    }
    args.push(options.resumeSessionId, '--', prompt);
    promptInserted = true;
  } else {
    for (const arg of template.args) {
      if (arg === '{{prompt}}') {
        args.push(prompt);
        promptInserted = true;
      } else if (arg === '{{systemPrompt}}') {
        if (options.systemPrompt) args.push(options.systemPrompt);
      } else {
        args.push(arg);
      }
    }
  }

  // Interactive mode: use --permission-prompt-tool=stdio instead of skip-permissions
  // Codex resume already has --full-auto inserted above
  const codexResumeHandled = options.resumeSessionId && template.command === 'codex';
  if (options.interactive && template.interactiveFlag) {
    args.push(template.interactiveFlag);
  } else if (options.skipPermissions && template.skipPermissionFlag && !codexResumeHandled) {
    args.push(template.skipPermissionFlag);
  }

  const outputFormat = options.outputFormat ?? template.defaultOutputFormat;
  if (outputFormat && template.outputFormatFlag) {
    args.push(template.outputFormatFlag, outputFormat);
  }

  // Codex: --json is a boolean flag (no value argument), but not supported on `resume` subcommand
  if (template.command === 'codex' && !options.resumeSessionId && (outputFormat === 'json' || outputFormat === 'stream-json')) {
    args.push('--json');
  }

  if (template.extraDirFlag && options.additionalWorkspaceDirs?.length) {
    for (const dir of options.additionalWorkspaceDirs) {
      args.push(template.extraDirFlag, dir);
    }
  }

  if (template.command === 'claude' && outputFormat === 'stream-json') {
    args.push('--verbose');
  }

  if (options.includePartialMessages && template.command === 'claude') {
    args.push('--include-partial-messages');
  }

  // Sub-model selection via --model flag
  if (options.modelFlag) {
    args.push('--model', options.modelFlag);
  }

  // Resume previous session (Claude/Gemini use --resume flag, Codex handled above)
  if (options.resumeSessionId && template.resumeFlag && template.command !== 'codex') {
    args.push(template.resumeFlag, options.resumeSessionId);
  }

  // Append image attachment flags (e.g. Codex --image)
  if (options.imageFiles?.length && template.imageFlag) {
    for (const file of options.imageFiles) {
      args.push(template.imageFlag, file);
    }
  }

  // Append generic file attachment flags (e.g. Claude/Gemini --file)
  if (options.attachmentFiles?.length && template.fileFlag) {
    for (const file of options.attachmentFiles) {
      args.push(template.fileFlag, file);
    }
  }

  // If prompt wasn't inserted inline (positional-arg CLIs like Codex),
  // append it at the end with '--' separator to prevent argument injection
  // (e.g. a prompt starting with '--' being parsed as a CLI flag)
  if (!promptInserted && !template.useStdin) {
    args.push('--', prompt);
  }

  return args;
}
