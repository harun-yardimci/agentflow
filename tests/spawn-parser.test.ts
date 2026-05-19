import { describe, it, expect } from 'vitest';
import { parseSpawnDirectives, stripSpawnBlock } from '../server/engine/spawn-parser.js';

describe('parseSpawnDirectives', () => {
  it('should parse a valid SPAWN_TASKS block', () => {
    const output = `
Here is my review output.

<!-- SPAWN_TASKS
[
  {
    "name": "Fix null check in auth.ts",
    "agentId": "developer",
    "model": "claude",
    "approval": "auto",
    "input": "Fix the null check issue in auth.ts line 42",
    "priority": "urgent"
  },
  {
    "name": "Add tests for auth module",
    "agentId": "qa",
    "input": "Write unit tests for the auth module"
  }
]
SPAWN_TASKS -->
    `;

    const result = parseSpawnDirectives(output);
    expect(result).toHaveLength(2);

    expect(result[0]).toEqual({
      name: 'Fix null check in auth.ts',
      agentId: 'developer',
      model: 'claude',
      approval: 'auto',
      input: 'Fix the null check issue in auth.ts line 42',
      priority: 'urgent',
    });

    expect(result[1]).toEqual({
      name: 'Add tests for auth module',
      agentId: 'qa',
      input: 'Write unit tests for the auth module',
    });
  });

  it('should return empty array for output without SPAWN_TASKS block', () => {
    const output = 'Just a normal task output with no spawn block.';
    expect(parseSpawnDirectives(output)).toEqual([]);
  });

  it('should return empty array for empty/null output', () => {
    expect(parseSpawnDirectives('')).toEqual([]);
  });

  it('should return empty array for malformed JSON', () => {
    const output = '<!-- SPAWN_TASKS\n{ this is not valid json }\nSPAWN_TASKS -->';
    expect(parseSpawnDirectives(output)).toEqual([]);
  });

  it('should return empty array if block content is not an array', () => {
    const output = '<!-- SPAWN_TASKS\n{"name": "single object"}\nSPAWN_TASKS -->';
    expect(parseSpawnDirectives(output)).toEqual([]);
  });

  it('should skip items missing required fields', () => {
    const output = `<!-- SPAWN_TASKS
[
  { "name": "Valid task", "agentId": "developer", "input": "Do something" },
  { "name": "Missing agentId", "input": "Do something" },
  { "agentId": "developer", "input": "Missing name" },
  { "name": "Missing input", "agentId": "developer" },
  { "name": "", "agentId": "developer", "input": "Empty name" },
  { "name": "Empty input", "agentId": "developer", "input": "" }
]
SPAWN_TASKS -->`;

    const result = parseSpawnDirectives(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Valid task');
  });

  it('should skip null and non-object items', () => {
    const output = `<!-- SPAWN_TASKS
[
  null,
  42,
  "string",
  { "name": "Valid", "agentId": "dev", "input": "work" }
]
SPAWN_TASKS -->`;

    const result = parseSpawnDirectives(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Valid');
  });

  it('should enforce max items limit', () => {
    const items = Array.from({ length: 15 }, (_, i) => ({
      name: `Task ${i}`,
      agentId: 'developer',
      input: `Do thing ${i}`,
    }));

    const output = `<!-- SPAWN_TASKS\n${JSON.stringify(items)}\nSPAWN_TASKS -->`;

    // Default max is 10
    const result = parseSpawnDirectives(output);
    expect(result).toHaveLength(10);

    // Custom max
    const result3 = parseSpawnDirectives(output, 3);
    expect(result3).toHaveLength(3);
  });

  it('should validate approval field', () => {
    const output = `<!-- SPAWN_TASKS
[
  { "name": "T1", "agentId": "dev", "input": "work", "approval": "auto" },
  { "name": "T2", "agentId": "dev", "input": "work", "approval": "manual" },
  { "name": "T3", "agentId": "dev", "input": "work", "approval": "invalid" }
]
SPAWN_TASKS -->`;

    const result = parseSpawnDirectives(output);
    expect(result[0]!.approval).toBe('auto');
    expect(result[1]!.approval).toBe('manual');
    expect(result[2]!.approval).toBeUndefined();
  });

  it('should validate priority field', () => {
    const output = `<!-- SPAWN_TASKS
[
  { "name": "T1", "agentId": "dev", "input": "work", "priority": "urgent" },
  { "name": "T2", "agentId": "dev", "input": "work", "priority": "high" },
  { "name": "T3", "agentId": "dev", "input": "work", "priority": "medium" },
  { "name": "T4", "agentId": "dev", "input": "work", "priority": "low" },
  { "name": "T5", "agentId": "dev", "input": "work", "priority": "critical" }
]
SPAWN_TASKS -->`;

    const result = parseSpawnDirectives(output);
    expect(result[0]!.priority).toBe('urgent');
    expect(result[1]!.priority).toBe('high');
    expect(result[2]!.priority).toBe('medium');
    expect(result[3]!.priority).toBe('low');
    expect(result[4]!.priority).toBeUndefined();
  });

  it('should recover wrapped newlines inside JSON string values', () => {
    const output = `<!-- SPAWN_TASKS
[
  {
    "name": "

Implement missing fraud signals",
    "agentId": "developer",
    "input": "Add payment.method and payment.is_3ds

to the schema"
  }
]
SPAWN_TASKS -->`;

    const result = parseSpawnDirectives(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('Implement missing fraud signals');
    expect(result[0]!.input).toContain('payment.method');
  });

  it('should trim whitespace from string fields', () => {
    const output = `<!-- SPAWN_TASKS
[
  { "name": "  Trim me  ", "agentId": "  developer  ", "input": "  work  ", "model": "  claude  " }
]
SPAWN_TASKS -->`;

    const result = parseSpawnDirectives(output);
    expect(result[0]!.name).toBe('Trim me');
    expect(result[0]!.agentId).toBe('developer');
    expect(result[0]!.input).toBe('work');
    expect(result[0]!.model).toBe('claude');
  });

  it('should only parse the first SPAWN_TASKS block', () => {
    const output = `
<!-- SPAWN_TASKS
[{ "name": "First", "agentId": "dev", "input": "a" }]
SPAWN_TASKS -->

Some text in between

<!-- SPAWN_TASKS
[{ "name": "Second", "agentId": "dev", "input": "b" }]
SPAWN_TASKS -->`;

    const result = parseSpawnDirectives(output);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe('First');
  });
});

describe('stripSpawnBlock', () => {
  it('should remove SPAWN_TASKS block and keep rest of output', () => {
    const output = `Here is the review.

Found 3 issues.

<!-- SPAWN_TASKS
[{ "name": "Fix bug", "agentId": "dev", "input": "fix it" }]
SPAWN_TASKS -->`;

    const stripped = stripSpawnBlock(output);
    expect(stripped).toBe('Here is the review.\n\nFound 3 issues.');
    expect(stripped).not.toContain('SPAWN_TASKS');
  });

  it('should return original output if no SPAWN_TASKS block', () => {
    const output = 'Normal output without any spawn block.';
    expect(stripSpawnBlock(output)).toBe(output);
  });

  it('should handle output that is only a SPAWN_TASKS block', () => {
    const output = `<!-- SPAWN_TASKS
[{ "name": "T1", "agentId": "dev", "input": "work" }]
SPAWN_TASKS -->`;

    expect(stripSpawnBlock(output)).toBe('');
  });

  it('should preserve text before and after the block', () => {
    const output = `Before the block.

<!-- SPAWN_TASKS
[{ "name": "T1", "agentId": "dev", "input": "work" }]
SPAWN_TASKS -->

After the block.`;

    const stripped = stripSpawnBlock(output);
    expect(stripped).toContain('Before the block.');
    expect(stripped).toContain('After the block.');
    expect(stripped).not.toContain('SPAWN_TASKS');
  });
});
