/**
 * Spawn Parser — parses structured SPAWN_TASKS directives from task output.
 *
 * Agents can request follow-up tasks by including a special HTML comment block
 * in their output. This module extracts and validates those directives.
 */

export interface SpawnDirective {
  name: string;
  agentId: string;
  model?: string;
  approval?: 'auto' | 'manual';
  input: string;
  priority?: 'urgent' | 'high' | 'medium' | 'low';
  branch?: string;
  stage?: number;
}

const SPAWN_BLOCK_RE = /<!-- SPAWN_TASKS\s*([\s\S]*?)\s*SPAWN_TASKS -->/;
const VALID_APPROVALS = new Set(['auto', 'manual']);
const VALID_PRIORITIES = new Set(['urgent', 'high', 'medium', 'low']);

function parseSpawnJson(block: string): unknown {
  try {
    return JSON.parse(block);
  } catch {
    let repaired = '';
    let inString = false;
    let escaping = false;

    for (const char of block) {
      if (escaping) {
        repaired += char;
        escaping = false;
        continue;
      }

      if (char === '\\') {
        repaired += char;
        escaping = true;
        continue;
      }

      if (char === '"') {
        repaired += char;
        inString = !inString;
        continue;
      }

      if (inString && (char === '\n' || char === '\r' || char === '\t')) {
        repaired += ' ';
        continue;
      }

      repaired += char;
    }

    return JSON.parse(repaired);
  }
}

/**
 * Parse SPAWN_TASKS directives from task output.
 *
 * @param output - The raw task output string
 * @param maxItems - Maximum number of directives to return (safety limit)
 * @returns Array of validated SpawnDirective objects. Empty array on parse error.
 */
export function parseSpawnDirectives(
  output: string,
  maxItems = 10,
): SpawnDirective[] {
  if (!output) return [];

  const match = SPAWN_BLOCK_RE.exec(output);
  if (!match?.[1]) return [];

  let parsed: unknown;
  try {
    parsed = parseSpawnJson(match[1]);
  } catch {
    console.warn('[SpawnParser] Failed to parse SPAWN_TASKS JSON block');
    return [];
  }

  if (!Array.isArray(parsed)) {
    console.warn('[SpawnParser] SPAWN_TASKS block is not an array');
    return [];
  }

  const directives: SpawnDirective[] = [];

  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;

    const raw = item as Record<string, unknown>;

    // Required fields
    if (typeof raw.name !== 'string' || !raw.name.trim()) continue;
    if (typeof raw.agentId !== 'string' || !raw.agentId.trim()) continue;
    if (typeof raw.input !== 'string' || !raw.input.trim()) continue;

    const directive: SpawnDirective = {
      name: raw.name.trim(),
      agentId: raw.agentId.trim(),
      input: raw.input.trim(),
    };

    // Optional fields with validation
    if (typeof raw.model === 'string' && raw.model.trim()) {
      directive.model = raw.model.trim();
    }

    if (typeof raw.approval === 'string' && VALID_APPROVALS.has(raw.approval)) {
      directive.approval = raw.approval as 'auto' | 'manual';
    }

    if (typeof raw.priority === 'string' && VALID_PRIORITIES.has(raw.priority)) {
      directive.priority = raw.priority as SpawnDirective['priority'];
    }

    if (typeof raw.branch === 'string' && raw.branch.trim()) {
      directive.branch = raw.branch.trim();
    }

    if (typeof raw.stage === 'number' && Number.isInteger(raw.stage) && raw.stage >= 0) {
      directive.stage = raw.stage;
    }

    directives.push(directive);

    if (directives.length >= maxItems) {
      console.warn(
        `[SpawnParser] Truncated spawn directives to ${maxItems} (limit)`,
      );
      break;
    }
  }

  return directives;
}

/**
 * Remove the SPAWN_TASKS block from output, keeping the rest intact.
 */
export function stripSpawnBlock(output: string): string {
  return output.replace(SPAWN_BLOCK_RE, '').trim();
}
