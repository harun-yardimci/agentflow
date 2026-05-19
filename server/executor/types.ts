import type { ControlRequest } from './control-protocol.js';

export interface ExecutorInput {
  /** The full assembled prompt for the agent */
  prompt: string;
  /** Working directory (worktree path) */
  workingDir: string;
  /** Timeout in milliseconds */
  timeoutMs: number;
  /** Model key */
  model: string;
  /** Agent system prompt */
  systemPrompt?: string;
  /** Max output tokens */
  maxTokens?: number;
  /** Environment variables to pass */
  env?: Record<string, string>;
  /** CLI output format override (CLI executors only) */
  outputFormat?: 'text' | 'json' | 'stream-json';
  /** Include partial assistant chunks (Claude CLI stream-json only) */
  includePartialMessages?: boolean;
  /** Force non-interactive permission-skipping mode for CLI executors */
  forceSkipPermissions?: boolean;
  /** Enable interactive mode (bidirectional control protocol via stdin/stdout) */
  interactiveMode?: boolean;
  /** Resume a previous CLI session by ID (for follow-up context continuity) */
  resumeSessionId?: string;
  /** Task attachments copied to .attachments/ directory */
  attachments?: {
    images: { originalName: string; mimeType: string }[];
    files: { originalName: string; mimeType: string }[];
  };
}

export interface ExecutorResult {
  /** Agent output text */
  output: string;
  /** Process exit code */
  exitCode: number;
  /** Token count (estimated or reported) */
  tokens: number;
  /** Duration in ms */
  durationMs: number;
  /** Stderr output */
  stderr: string;
  /** Files created/modified by the agent */
  artifacts: string[];
  /** CLI session ID for resume support (extracted from output) */
  sessionId?: string;
}

export interface ExecutorCallbacks {
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

export interface BaseExecutor {
  /** Unique executor type name */
  readonly type: string;
  /** Execute a task */
  execute(
    input: ExecutorInput,
    onStdout?: (chunk: string) => void,
    onStderr?: (chunk: string) => void,
    onControlRequest?: (request: ControlRequest) => void,
  ): Promise<ExecutorResult>;
  /** Abort a running execution */
  abort(): void;
  /** Check if this executor is available (CLI installed / API key set) */
  isAvailable(): Promise<boolean>;
  /** Send a control response to the running process (interactive mode only) */
  sendControlResponse?(response: string): void;
}
