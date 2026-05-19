import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

const executeMock = vi.fn();
const abortMock = vi.fn();

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => {
    db?.close();
  },
}));

vi.mock('../server/executor/index.js', () => ({
  createExecutor: () => ({
    type: 'cli',
    execute: executeMock,
    abort: abortMock,
  }),
}));

const { generateBreakdown } = await import('../server/services/breakdown-service.js');

describe('breakdown-service', () => {
  beforeEach(() => {
    db = createTestDb();
    executeMock.mockReset();
    abortMock.mockReset();
  });

  afterEach(() => {
    db.close();
  });

  it('does not leak raw agent prompts into the planner system prompt', async () => {
    db.prepare(
      'INSERT INTO agents (id, name, icon, default_model, prompt) VALUES (?, ?, ?, ?, ?)',
    ).run(
      'reviewer',
      'Reviewer',
      '🧠',
      'claude:sonnet',
      'OUTPUT MARKDOWN REVIEW ONLY. Read all files and produce a PR review report.',
    );

    executeMock.mockResolvedValue({
      output: JSON.stringify({
        summary: 'Plan the review work.',
        tasks: [
          {
            name: 'Inspect changes',
            agentId: 'reviewer',
            model: 'claude',
            approval: 'manual',
            stage: 0,
            dependsOn: [],
            input: 'Review the changed files.',
            rationale: 'Need a review task.',
            priority: 'high',
            tags: ['research'],
            taskType: 'planned',
          },
        ],
        reasoning: 'Use the reviewer agent.',
      }),
      exitCode: 0,
      tokens: 10,
      durationMs: 5,
      stderr: '',
      artifacts: [],
    });

    await generateBreakdown(
      'Review the current PR and prepare a safe execution plan.',
      ['reviewer'],
      'claude:sonnet',
    );

    const firstCall = executeMock.mock.calls[0]?.[0] as {
      prompt: string;
    };

    expect(firstCall.prompt).toContain('**reviewer** ("Reviewer" 🧠): Role: Reviewer.');
    expect(firstCall.prompt).not.toContain('OUTPUT MARKDOWN REVIEW ONLY');
    expect(firstCall.prompt).not.toContain('Read all files and produce a PR review report');
  });

  it('repairs malformed markdown planner output with a fast fallback model', async () => {
    db.prepare(
      'INSERT INTO agents (id, name, icon, default_model, prompt) VALUES (?, ?, ?, ?, ?)',
    ).run(
      'developer',
      'Forge',
      '💻',
      'codex:codex-1',
      'Write production-ready code.',
    );

    executeMock
      .mockResolvedValueOnce({
        output: '# Code Review\n\n## Findings\n- The current plan should be split into implementation and QA.\n',
        exitCode: 0,
        tokens: 50,
        durationMs: 20,
        stderr: '',
        artifacts: [],
      })
      .mockResolvedValueOnce({
        output: JSON.stringify({
          summary: 'Split the work into implementation and QA.',
          tasks: [
            {
              name: 'Implement the requested change',
              agentId: 'developer',
              model: 'codex',
              approval: 'auto',
              stage: 0,
              dependsOn: [],
              input: 'Primary scope: relevant module. Commit as: feat(planner): implement the change.',
              rationale: 'Implementation is required before validation.',
              priority: 'high',
              tags: ['feature', 'backend'],
              taskType: 'planned',
            },
            {
              name: 'Validate the implementation',
              agentId: 'developer',
              model: 'claude',
              approval: 'manual',
              stage: 1,
              dependsOn: [0],
              input: 'Review the implementation and verify expected behavior.',
              rationale: 'A follow-up validation step prevents regressions.',
              priority: null,
              tags: ['test'],
              taskType: 'spawned',
            },
          ],
          reasoning: 'Recovered a valid execution plan from the malformed review output.',
        }),
        exitCode: 0,
        tokens: 30,
        durationMs: 10,
        stderr: '',
        artifacts: [],
      });

    const chunks: string[] = [];
    const plan = await generateBreakdown(
      'Implement a robust planner fallback.',
      ['developer'],
      'claude:opus',
      (chunk) => chunks.push(chunk),
    );

    expect(plan.summary).toContain('implementation and QA');
    expect(plan.tasks).toHaveLength(2);
    expect(plan.tasks[0]?.agentId).toBe('developer');
    expect(plan.tasks[1]?.dependsOn).toEqual([0]);
    expect(plan.tasks[1]?.taskType).toBe('spawned');

    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[0]?.[0].model).toBe('claude');
    expect(executeMock.mock.calls[1]?.[0].model).toBe('claude');
    expect(
      chunks.some((chunk) => chunk.includes('attempting JSON repair with claude:haiku')),
    ).toBe(true);
  });

  it('accepts informational plans with no tasks', async () => {
    db.prepare(
      'INSERT INTO agents (id, name, icon, default_model, prompt) VALUES (?, ?, ?, ?, ?)',
    ).run(
      'research',
      'Scout',
      '🔍',
      'gemini:2.5-pro',
      'Analyze the request.',
    );

    executeMock.mockResolvedValue({
      output: JSON.stringify({
        summary: 'No implementation work is required.',
        tasks: [],
        reasoning: 'The request only needed clarification, not execution.',
      }),
      exitCode: 0,
      tokens: 12,
      durationMs: 5,
      stderr: '',
      artifacts: [],
    });

    const plan = await generateBreakdown(
      'Explain whether this pipeline already covers the requirement.',
      ['research'],
      'gemini:2.5-pro',
    );

    expect(plan.summary).toBe('No implementation work is required.');
    expect(plan.tasks).toEqual([]);
    expect(plan.reasoning).toContain('clarification');
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
