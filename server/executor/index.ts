import { CLIExecutor } from './cli-executor.js';
import type { BaseExecutor } from './types.js';

export type { BaseExecutor, ExecutorInput, ExecutorResult } from './types.js';

/** Create a CLI executor (only execution mode supported) */
export function createExecutor(_model: string): BaseExecutor {
  return new CLIExecutor();
}

/** Detect which CLI providers are available on PATH */
export async function detectProviders(): Promise<Record<string, boolean>> {
  const cliExecutor = new CLIExecutor();
  return cliExecutor.detectProviders();
}
