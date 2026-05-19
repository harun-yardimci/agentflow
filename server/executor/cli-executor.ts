import { spawn, type ChildProcess } from 'child_process';
import type { Writable } from 'stream';
import { CLI_TEMPLATES, buildCliArgs } from './cli-templates.js';
import type { BaseExecutor, ExecutorInput, ExecutorResult } from './types.js';
import type { ControlRequest } from './control-protocol.js';
import { parseStdoutLine } from './control-protocol.js';
import { getDb } from '../db/connection.js';
import { getProviderKey, getModelCliFlag } from '../lib/provider-utils.js';
import { getAdditionalWorkspaceDirs } from './codex-sandbox.js';

export class CLIExecutor implements BaseExecutor {
  readonly type = 'cli';
  private process: ChildProcess | null = null;
  private aborted = false;
  private stdinWriter: Writable | null = null;
  private pendingControlRequests = 0;

  async execute(
    input: ExecutorInput,
    onStdout?: (chunk: string) => void,
    onStderr?: (chunk: string) => void,
    onControlRequest?: (request: ControlRequest) => void,
  ): Promise<ExecutorResult> {
    // Resolve provider template from model key (e.g. 'claude:opus' → 'claude')
    const providerKey = getProviderKey(input.model);
    const template = CLI_TEMPLATES[providerKey];
    if (!template) {
      throw new Error(`No CLI template for provider: ${providerKey} (model: ${input.model})`);
    }

    // Read skip_permissions setting (can be overridden per request)
    const db = getDb();
    const setting = db.prepare("SELECT value FROM settings WHERE key = 'cli_skip_permissions'").get() as { value: string } | undefined;
    const configuredSkipPermissions = setting?.value !== 'false';
    const skipPermissions = input.forceSkipPermissions ?? configuredSkipPermissions;
    const streamStderr = input.env?.AGENTFLOW_STREAM_STDERR === '1';

    // Interactive mode: only for Claude with the flag available
    const isInteractive = input.interactiveMode === true && template.interactiveFlag !== null;

    // Get sub-model CLI flag (e.g. 'claude:opus' → '--model claude-opus-4-6')
    // Skip --model when resuming — the session already knows its model, and
    // sending a potentially different model ID causes "model not found" errors.
    const modelFlag = input.resumeSessionId ? undefined : getModelCliFlag(input.model);

    // Extract image file paths for --image flags (Codex)
    const imageFiles = input.attachments?.images
      ?.map((f) => `.attachments/${f.originalName}`) ?? [];

    // Extract non-image attachment paths for --file flags (Claude/Gemini)
    const attachmentFiles = input.attachments?.files
      ?.map((f) => `.attachments/${f.originalName}`) ?? [];
    const additionalWorkspaceDirs = getAdditionalWorkspaceDirs(input.workingDir);

    const args = buildCliArgs(template, input.prompt, {
      skipPermissions: isInteractive ? false : skipPermissions,
      systemPrompt: input.systemPrompt,
      maxTokens: input.maxTokens,
      outputFormat: input.outputFormat,
      includePartialMessages: input.includePartialMessages,
      interactive: isInteractive,
      modelFlag,
      imageFiles,
      attachmentFiles,
      additionalWorkspaceDirs,
      resumeSessionId: input.resumeSessionId,
    });

    const startTime = Date.now();
    this.aborted = false;
    this.pendingControlRequests = 0;

    // Strip env vars that cause Claude CLI to detect nested session
    const cleanEnv = { ...process.env };
    for (const key of Object.keys(cleanEnv)) {
      if (
        key === 'CLAUDECODE' ||
        key.startsWith('CLAUDE_') ||
        key.startsWith('ANTHROPIC_') ||
        key === '__CFBundleIdentifier' ||
        key === 'MCP_CONNECTION_NONBLOCKING'
      ) {
        delete cleanEnv[key];
      }
    }

    return new Promise<ExecutorResult>((resolve, reject) => {
      // Codex requires stdin to be a TTY; use 'ignore' to avoid "stdin is not a terminal"
      const stdinMode = (template.command === 'codex' && !isInteractive && !template.useStdin)
        ? 'ignore' as const
        : 'pipe' as const;

      const proc = spawn(template.command, args, {
        cwd: input.workingDir,
        env: { ...cleanEnv, ...input.env },
        timeout: isInteractive ? 0 : input.timeoutMs, // Interactive: no spawn timeout, we manage it ourselves
        stdio: [stdinMode, 'pipe', 'pipe'],
      });

      this.process = proc;

      let stdout = '';
      let stderr = '';
      let settled = false;
      const MAX_OUTPUT = 2 * 1024 * 1024; // 2MB — stream-json includes base64 images
      let resultLine = '';

      const settleWith = (result: ExecutorResult): void => {
        if (settled) return;
        settled = true;
        this.process = null;
        this.stdinWriter = null;
        this.pendingControlRequests = 0;
        if (safetyTimer) clearTimeout(safetyTimer);
        if (streamDrainTimer) clearTimeout(streamDrainTimer);
        resolve(result);
      };

      const buildResult = (code: number | null, signal: NodeJS.Signals | null): ExecutorResult => {
        const durationMs = Date.now() - startTime;
        const wasAborted = this.aborted;
        const wasTimeout = !wasAborted && (
          (signal === 'SIGTERM' && input.timeoutMs > 0 && durationMs >= input.timeoutMs * 0.9) ||
          (code === 143 && input.timeoutMs > 0 && durationMs >= input.timeoutMs * 0.9)
        );
        const wasTerminated = !wasAborted && !wasTimeout && (
          signal === 'SIGTERM' || code === 143
        );

        let tokens = 0;
        if (template.tokenPattern) {
          try {
            const match = stdout.match(new RegExp(template.tokenPattern));
            if (match?.[1]) {
              tokens = parseInt(match[1], 10);
            }
          } catch {
            // Ignore regex errors
          }
        }
        if (tokens === 0) {
          tokens = Math.round((input.prompt.length + stdout.length) / 4);
        }

        // Extract session ID from output for resume support
        let sessionId: string | undefined;
        if (template.sessionIdPattern) {
          try {
            const sessionMatch = (stdout + '\n' + stderr).match(new RegExp(template.sessionIdPattern));
            if (sessionMatch?.[1]) {
              sessionId = sessionMatch[1];
            }
          } catch {
            // Ignore regex errors
          }
        }

        if (stdout.length >= MAX_OUTPUT && resultLine) {
          stdout += '\n' + resultLine;
        }

        const finalStderr = wasTimeout
          ? `TIMEOUT: Process killed after ${Math.round(durationMs / 1000)}s (limit: ${Math.round((input.timeoutMs || 0) / 1000)}s)${stderr ? '\n' + stderr : ''}`
          : wasAborted
            ? `ABORTED: Process terminated by user${stderr ? '\n' + stderr : ''}`
            : wasTerminated
              ? `TERMINATED: Process received SIGTERM${stderr ? '\n' + stderr : ''}`
              : stderr;

        return {
          output: stdout,
          exitCode: wasAborted ? -1 : (code ?? ((wasTimeout || wasTerminated) ? 143 : -1)),
          tokens,
          durationMs,
          stderr: finalStderr,
          artifacts: [],
          sessionId,
        };
      };

      // --- Partial line buffer for interactive mode ---
      let lineBuffer = '';

      // --- Stream handlers ---
      proc.stdout?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stdout.length < MAX_OUTPUT) {
          stdout += text;
        }

        // Interactive mode: line-based parsing for control protocol
        if (isInteractive && onControlRequest) {
          lineBuffer += text;
          const lines = lineBuffer.split('\n');
          // Keep the last incomplete line in buffer
          lineBuffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;

            const parsed = parseStdoutLine(line);
            if (parsed?.kind === 'control_request') {
              this.pendingControlRequests++;
              onControlRequest(parsed.request);
              // Don't forward control requests to onStdout
              continue;
            }

            if (parsed?.kind === 'result' && line.includes('"type":"result"')) {
              resultLine = line.trim();
            }
          }

          // Forward full chunk to onStdout for live streaming (includes control request lines too,
          // but that's fine — the output parser handles them)
          onStdout?.(text);
        } else {
          // Non-interactive: existing behavior
          if (text.includes('"type":"result"')) {
            const lines = text.split('\n');
            for (const line of lines) {
              if (line.includes('"type":"result"')) {
                resultLine = line.trim();
              }
            }
          }
          onStdout?.(text);
        }
      });

      proc.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        if (stderr.length < MAX_OUTPUT) {
          stderr += text;
        }
        onStderr?.(text);
        if (streamStderr) {
          onStdout?.(`[cli-stderr] ${text}`);
        }
      });

      // --- Error handler ---
      proc.on('error', (err) => {
        if (this.aborted) {
          settleWith({
            output: stdout,
            exitCode: -1,
            tokens: 0,
            durationMs: Date.now() - startTime,
            stderr: 'Execution aborted by user',
            artifacts: [],
          });
        } else if (!settled) {
          settled = true;
          this.process = null;
          this.stdinWriter = null;
          if (safetyTimer) clearTimeout(safetyTimer);
          if (streamDrainTimer) clearTimeout(streamDrainTimer);
          reject(new Error(`CLI spawn failed: ${err.message}`));
        }
      });

      // --- Exit/Close handlers ---
      let streamDrainTimer: ReturnType<typeof setTimeout> | null = null;

      proc.on('exit', (code, signal) => {
        streamDrainTimer = setTimeout(() => {
          settleWith(buildResult(code, signal));
        }, 500);
      });

      proc.on('close', (code, signal) => {
        settleWith(buildResult(code, signal));
      });

      // --- Safety timeout ---
      const SAFETY_MARGIN_MS = 30_000;
      const MAX_SAFETY_MS = 10 * 60 * 1000;
      const INTERACTIVE_SAFETY_MS = 60 * 60 * 1000; // 1 hour for interactive mode
      const safetyMs = isInteractive
        ? INTERACTIVE_SAFETY_MS
        : (input.timeoutMs > 0 ? input.timeoutMs + SAFETY_MARGIN_MS : MAX_SAFETY_MS);

      const safetyTimer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* process may already be dead */ }
        settleWith({
          output: stdout,
          exitCode: -1,
          tokens: Math.round((input.prompt.length + stdout.length) / 4),
          durationMs: Date.now() - startTime,
          stderr: `SAFETY_TIMEOUT: Promise did not resolve within ${Math.round(safetyMs / 1000)}s${stderr ? '\n' + stderr : ''}`,
          artifacts: [],
        });
      }, safetyMs);
      safetyTimer.unref();

      // --- Stdin handling ---
      if (isInteractive && proc.stdin) {
        // Interactive mode: keep stdin OPEN for control responses
        this.stdinWriter = proc.stdin;
        // Don't close stdin — we'll write controlResponse JSON to it
      } else if (template.useStdin && proc.stdin) {
        proc.stdin.write(input.prompt);
        proc.stdin.end();
      } else if (proc.stdin) {
        // Close stdin immediately to signal non-interactive mode
        proc.stdin.end();
      }
    });
  }

  /**
   * Send a control response JSON line to the running process's stdin.
   * Only works in interactive mode when stdin is kept open.
   */
  sendControlResponse(json: string): void {
    if (!this.stdinWriter || this.stdinWriter.destroyed) {
      throw new Error('stdin is closed, cannot send control response');
    }
    this.stdinWriter.write(json + '\n');
    this.pendingControlRequests = Math.max(0, this.pendingControlRequests - 1);
  }

  abort(): void {
    this.aborted = true;
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
      setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL');
        }
      }, 3000).unref();
    }
  }

  async isAvailable(): Promise<boolean> {
    const results: Record<string, boolean> = {};
    for (const [model, template] of Object.entries(CLI_TEMPLATES)) {
      results[model] = await this.checkCommand(template.command);
    }
    return Object.values(results).some(Boolean);
  }

  async detectProviders(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [model, template] of Object.entries(CLI_TEMPLATES)) {
      results[model] = await this.checkCommand(template.command);
    }
    return results;
  }

  private checkCommand(command: string): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('which', [command], { stdio: 'pipe' });
      proc.on('close', (code) => resolve(code === 0));
      proc.on('error', () => resolve(false));
    });
  }
}
