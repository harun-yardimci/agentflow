import { CLIExecutor } from './cli-executor.js';
import { APIExecutor, shouldUseApiExecutor } from './api-executor.js';
import type { BaseExecutor } from './types.js';

export type { BaseExecutor, ExecutorInput, ExecutorResult } from './types.js';

/** Create an executor for the given model — API if provider configured for API, else CLI */
export function createExecutor(model: string): BaseExecutor {
  if (shouldUseApiExecutor(model)) {
    return new APIExecutor();
  }
  return new CLIExecutor();
}

/** Detect which CLI providers are available on PATH */
export async function detectProviders(): Promise<Record<string, boolean>> {
  const cliExecutor = new CLIExecutor();
  return cliExecutor.detectProviders();
}
