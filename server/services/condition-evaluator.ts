/**
 * Evaluates dependency conditions for conditional task branching.
 * Pure functions — no DB or side effects.
 */

import { runInNewContext } from 'node:vm';

export interface DependencyCondition {
  type: 'contains' | 'not_contains' | 'regex' | 'status';
  value: string;
}

/** Max time (ms) to allow a regex to run before aborting (ReDoS protection) */
const REGEX_TIMEOUT_MS = 1000;

/** Max output length to test against regex (truncate longer outputs) */
const REGEX_MAX_OUTPUT_LEN = 100_000;

/**
 * Safely test a regex pattern against text with a timeout.
 * Prevents ReDoS by running in a sandboxed VM context with a time limit.
 */
function safeRegexTest(pattern: string, text: string): boolean {
  const truncated = text.length > REGEX_MAX_OUTPUT_LEN
    ? text.slice(0, REGEX_MAX_OUTPUT_LEN)
    : text;

  try {
    return runInNewContext(
      'new RegExp(pattern, "i").test(text)',
      { pattern, text: truncated },
      { timeout: REGEX_TIMEOUT_MS },
    ) as boolean;
  } catch {
    // Timeout or invalid regex — treat as condition not met
    return false;
  }
}

/**
 * Evaluate a condition against a dependency task's output and status.
 * Returns true if the condition is met (task should proceed).
 */
export function evaluateCondition(
  condition: DependencyCondition | null,
  depOutput: string | null,
  depStatus: string,
): boolean {
  if (!condition) return true;

  const output = depOutput ?? '';

  switch (condition.type) {
    case 'contains':
      return output.toLowerCase().includes(condition.value.toLowerCase());

    case 'not_contains':
      return !output.toLowerCase().includes(condition.value.toLowerCase());

    case 'regex':
      return safeRegexTest(condition.value, output);

    case 'status':
      return depStatus.toLowerCase() === condition.value.toLowerCase();

    default:
      return true; // unknown type = pass (safe default)
  }
}

/**
 * Parse a condition JSON string from the database.
 * Returns null for empty/invalid values (unconditional).
 */
export function parseCondition(conditionJson: string | null): DependencyCondition | null {
  if (!conditionJson) return null;
  try {
    const parsed = JSON.parse(conditionJson);
    if (parsed && typeof parsed.type === 'string' && typeof parsed.value === 'string') {
      return parsed as DependencyCondition;
    }
    return null;
  } catch {
    return null;
  }
}
