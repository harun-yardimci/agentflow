import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { createTables } from '../server/db/schema.js';

let db: Database.Database | null = null;

function createLegacyDb(): Database.Database {
  const legacyDb = new Database(':memory:');
  legacyDb.pragma('foreign_keys = ON');

  legacyDb.exec(`
    CREATE TABLE pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created TEXT NOT NULL
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'claude:sonnet',
      approval TEXT NOT NULL DEFAULT 'auto',
      status TEXT NOT NULL DEFAULT 'queued',
      stage INTEGER NOT NULL DEFAULT 0,
      input TEXT NOT NULL DEFAULT '',
      output TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      retry_count INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 2,
      iteration INTEGER NOT NULL DEFAULT 0,
      max_iterations INTEGER NOT NULL DEFAULT 3,
      timeout_ms INTEGER NOT NULL DEFAULT 600000,
      current_run_id TEXT,
      worktree_status TEXT NOT NULL DEFAULT 'none',
      priority TEXT,
      created_at TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE execution_runs (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      attempt INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      exit_code INTEGER,
      stdout TEXT DEFAULT '',
      stderr TEXT DEFAULT '',
      tokens_used INTEGER DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      executor_type TEXT,
      model_used TEXT,
      error_message TEXT,
      worktree_path TEXT,
      follow_up_prompt TEXT,
      is_follow_up INTEGER NOT NULL DEFAULT 0,
      session_id TEXT,
      parsed_output TEXT
    );
  `);

  legacyDb.prepare(
    "INSERT INTO pipelines (id, name, status, created) VALUES ('p1', 'Pipeline', 'completed', '2026-03-24T00:00:00.000Z')"
  ).run();
  legacyDb.prepare(`
    INSERT INTO tasks (
      id, pipeline_id, name, agent_id, model, status, input, output, sort_order, created_at
    ) VALUES (
      't1', 'p1', 'Task', 'developer', 'codex:gpt-5.4', 'completed', 'original input',
      'latest output', 0, '2026-03-24T00:00:00.000Z'
    )
  `).run();

  const insertRun = legacyDb.prepare(`
    INSERT INTO execution_runs (
      id, task_id, attempt, status, started_at, completed_at, stdout, stderr,
      model_used, follow_up_prompt, is_follow_up, session_id, parsed_output
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertRun.run(
    'run-1',
    't1',
    1,
    'completed',
    '2026-03-24T00:01:00.000Z',
    '2026-03-24T00:02:00.000Z',
    'First assistant output',
    '',
    'codex:gpt-5.4',
    null,
    0,
    'session-codex',
    'First assistant output',
  );
  insertRun.run(
    'run-2',
    't1',
    1,
    'completed',
    '2026-03-24T00:03:00.000Z',
    '2026-03-24T00:04:00.000Z',
    'Second assistant output',
    '',
    'gemini:3.1-pro',
    'Can you verify that again?',
    1,
    'session-gemini',
    'Second assistant output',
  );

  return legacyDb;
}

describe('Execution backfill migration', () => {
  afterEach(() => {
    db?.close();
    db = null;
  });

  it('backfills attempts and conversation messages for legacy runs', () => {
    db = createLegacyDb();

    createTables(db);

    const runs = db.prepare(`
      SELECT attempt_number, parent_run_id, trigger_type, provider
      FROM execution_runs
      WHERE task_id = 't1'
      ORDER BY started_at ASC
    `).all() as Array<{
      attempt_number: number;
      parent_run_id: string | null;
      trigger_type: string;
      provider: string | null;
    }>;

    expect(runs).toEqual([
      {
        attempt_number: 1,
        parent_run_id: null,
        trigger_type: 'initial',
        provider: 'codex',
      },
      {
        attempt_number: 2,
        parent_run_id: 'run-1',
        trigger_type: 'follow_up',
        provider: 'gemini',
      },
    ]);

    const messages = db.prepare(`
      SELECT role, message_type, content, model_used
      FROM conversation_messages
      WHERE task_id = 't1'
      ORDER BY created_at ASC, rowid ASC
    `).all() as Array<{
      role: string;
      message_type: string;
      content: string;
      model_used: string | null;
    }>;

    expect(messages).toEqual([
      {
        role: 'assistant',
        message_type: 'final_answer',
        content: 'First assistant output',
        model_used: 'codex:gpt-5.4',
      },
      {
        role: 'user',
        message_type: 'follow_up',
        content: 'Can you verify that again?',
        model_used: 'gemini:3.1-pro',
      },
      {
        role: 'assistant',
        message_type: 'final_answer',
        content: 'Second assistant output',
        model_used: 'gemini:3.1-pro',
      },
    ]);
  });
});
