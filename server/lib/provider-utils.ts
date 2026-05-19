/** Shared provider/model resolution utilities — reads from DB */

import { getDb } from '../db/connection.js';

/** Map a model identifier to its provider key (claude, gemini, codex) */
export function getProviderKey(model: string): string {
  try {
    const db = getDb();
    const row = db.prepare('SELECT provider FROM models WHERE id = ?').get(model) as { provider: string } | undefined;
    if (row) return row.provider;
  } catch {
    // models table may not exist yet (e.g. in tests) — fall through to heuristic
  }

  // Fallback: parse from model string prefix (e.g. "claude:sonnet" → "claude")
  const prefix = model.split(':')[0];
  if (prefix && ['claude', 'gemini', 'codex'].includes(prefix)) return prefix;

  // Fallback: match well-known model name patterns
  if (/^(gpt-|o[1-9]|codex)/i.test(model)) return 'codex';
  if (/^gemini/i.test(model)) return 'gemini';
  if (/^claude/i.test(model)) return 'claude';

  return 'claude';
}

/** Get the CLI --model flag value for a sub-model, or undefined if default */
export function getModelCliFlag(model: string): string | undefined {
  try {
    const db = getDb();
    const row = db.prepare('SELECT cli_flag FROM models WHERE id = ?').get(model) as { cli_flag: string | null } | undefined;
    return row?.cli_flag ?? undefined;
  } catch {
    // models table may not exist yet (e.g. in tests) — return undefined (use default)
    return undefined;
  }
}
