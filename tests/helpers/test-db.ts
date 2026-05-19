/**
 * Test helper: provides an in-memory SQLite database
 * with the full AgentFlow schema for isolated unit tests.
 */
import Database from 'better-sqlite3';
import { vi } from 'vitest';

let testDb: Database.Database | null = null;

/** SQL schema — mirrors server/db/schema.ts */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS pipelines (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    created TEXT NOT NULL,
    context_data TEXT DEFAULT '{}',
    working_dir TEXT NOT NULL DEFAULT '.',
    git_branch TEXT,
    execution_mode TEXT DEFAULT 'cli',
    description TEXT DEFAULT '',
    rules TEXT DEFAULT '',
    enabled_agents TEXT DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT 'claude',
    approval TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL DEFAULT 'queued',
    stage INTEGER NOT NULL DEFAULT 0,
    input TEXT NOT NULL DEFAULT '',
    output TEXT,
    tokens INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    duration TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 2,
    iteration INTEGER NOT NULL DEFAULT 0,
    max_iterations INTEGER NOT NULL DEFAULT 3,
    timeout_ms INTEGER NOT NULL DEFAULT 600000,
    working_dir TEXT,
    current_run_id TEXT,
    worktree_path TEXT,
    worktree_status TEXT NOT NULL DEFAULT 'none',
    source_task_id TEXT,
    user_note TEXT,
    original_input TEXT NOT NULL DEFAULT '',
    current_input TEXT NOT NULL DEFAULT '',
    priority TEXT,
    task_type TEXT DEFAULT 'seeded',
    stage_id TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    interactive_mode INTEGER NOT NULL DEFAULT 0,
    use_worktree INTEGER NOT NULL DEFAULT 1,
    branch TEXT,
    archived_at TEXT,
    auto_retry INTEGER NOT NULL DEFAULT 0,
    resume_at TEXT
  );

  CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    UNIQUE(pipeline_id, name)
  );

  CREATE TABLE IF NOT EXISTS task_tags (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (task_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS task_deps (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    condition TEXT,
    PRIMARY KEY (task_id, depends_on_task_id)
  );

  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT NOT NULL DEFAULT '',
    default_model TEXT NOT NULL DEFAULT 'claude',
    prompt TEXT NOT NULL DEFAULT '',
    cli_command TEXT,
    cli_args TEXT,
    max_tokens INTEGER
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    time TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info',
    msg TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pipeline_ctx (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL DEFAULT '',
    set_by_task_id TEXT,
    UNIQUE(pipeline_id, key)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    bg TEXT NOT NULL,
    cli_command TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1,
    execution_mode TEXT NOT NULL DEFAULT 'cli',
    api_key TEXT
  );

  CREATE TABLE IF NOT EXISTS models (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    bg TEXT NOT NULL,
    cost_per_1k REAL NOT NULL DEFAULT 0,
    cli_flag TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS execution_runs (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL DEFAULT 1,
    cycle_id TEXT,
    attempt_number INTEGER,
    parent_run_id TEXT,
    trigger_type TEXT NOT NULL DEFAULT 'initial',
    agent_id TEXT,
    provider TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TEXT NOT NULL,
    completed_at TEXT,
    exit_code INTEGER,
    stdout TEXT DEFAULT '',
    stderr TEXT DEFAULT '',
    tokens_used INTEGER DEFAULT 0,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cache_read_input_tokens INTEGER,
    cache_creation_input_tokens INTEGER,
    cost_usd REAL,
    pricing_source TEXT,
    pricing_snapshot_json TEXT,
    duration_ms INTEGER DEFAULT 0,
    executor_type TEXT,
    model_used TEXT,
    error_message TEXT,
    worktree_path TEXT,
    follow_up_prompt TEXT,
    is_follow_up INTEGER NOT NULL DEFAULT 0,
    session_id TEXT,
    provider_session_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    parsed_output TEXT
  );

  CREATE TABLE IF NOT EXISTS task_cycles (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    cycle_number INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TEXT NOT NULL,
    ended_at TEXT,
    started_by TEXT,
    restart_reason TEXT,
    summary TEXT NOT NULL DEFAULT '',
    UNIQUE(task_id, cycle_number)
  );

  CREATE TABLE IF NOT EXISTS conversation_messages (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    cycle_id TEXT NOT NULL REFERENCES task_cycles(id) ON DELETE CASCADE,
    run_id TEXT REFERENCES execution_runs(id) ON DELETE SET NULL,
    role TEXT NOT NULL,
    message_type TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    agent_id TEXT,
    provider TEXT,
    model_used TEXT,
    meta_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS context_packets (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL DEFAULT '' REFERENCES tasks(id) ON DELETE CASCADE,
    cycle_id TEXT NOT NULL DEFAULT '',
    source_type TEXT NOT NULL,
    source_key TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    content_type TEXT NOT NULL,
    strategy TEXT NOT NULL,
    original_content TEXT NOT NULL,
    compact_content TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    original_tokens INTEGER NOT NULL DEFAULT 0,
    compact_tokens INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    last_accessed_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT REFERENCES pipelines(id) ON DELETE CASCADE,
    layer TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    created_by_task TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    UNIQUE(pipeline_id, layer, key)
  );

  CREATE TABLE IF NOT EXISTS safety_rules (
    id TEXT PRIMARY KEY,
    rule_type TEXT NOT NULL,
    pattern TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'block',
    description TEXT,
    enabled INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS control_requests (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    run_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    tool_use_id TEXT,
    input_json TEXT NOT NULL,
    question TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    response_json TEXT,
    created_at TEXT NOT NULL,
    responded_at TEXT,
    timeout_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pipeline_stages (
    id TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    color TEXT DEFAULT '#9CA3AF',
    max_parallel INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);

  CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    pipeline_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_attachments_target ON attachments(target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_attachments_pipeline ON attachments(pipeline_id);

  CREATE INDEX IF NOT EXISTS idx_tags_pipeline ON tags(pipeline_id);
  CREATE INDEX IF NOT EXISTS idx_task_tags_task ON task_tags(task_id);
  CREATE INDEX IF NOT EXISTS idx_tasks_pipeline ON tasks(pipeline_id);
  CREATE INDEX IF NOT EXISTS idx_logs_pipeline ON logs(pipeline_id);
  CREATE INDEX IF NOT EXISTS idx_pipeline_ctx_pipeline ON pipeline_ctx(pipeline_id);
  CREATE INDEX IF NOT EXISTS idx_exec_runs_task ON execution_runs(task_id);
  CREATE INDEX IF NOT EXISTS idx_task_cycles_task ON task_cycles(task_id);
  CREATE INDEX IF NOT EXISTS idx_conversation_messages_cycle ON conversation_messages(cycle_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_conversation_messages_task ON conversation_messages(task_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_context_packets_task ON context_packets(task_id, source_type, created_at);
  CREATE INDEX IF NOT EXISTS idx_context_packets_cycle ON context_packets(cycle_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_context_packets_hash ON context_packets(content_hash);
  CREATE INDEX IF NOT EXISTS idx_memory_pipeline_layer ON memory(pipeline_id, layer);
  CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
  CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider);
`;

/** Create a fresh in-memory database with the full schema */
export function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

/**
 * Setup mock for server/db/connection.ts
 * Call this in beforeEach() to redirect getDb() to an in-memory DB.
 */
export function setupTestDb(): Database.Database {
  testDb = createTestDb();

  // Mock the getDb() import
  vi.mock('../server/db/connection.js', () => ({
    getDb: () => testDb,
    closeDb: () => {
      if (testDb) {
        testDb.close();
        testDb = null;
      }
    },
  }));

  return testDb;
}

/** Clean up the test database */
export function teardownTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

/** Seed a basic pipeline with tasks for testing cascade logic */
export function seedCascadePipeline(db: Database.Database) {
  // Agent
  db.prepare('INSERT INTO agents (id, name, prompt) VALUES (?, ?, ?)').run(
    'agent-1', 'Test Agent', 'You are a test agent'
  );

  // Pipeline
  db.prepare('INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)').run(
    'p1', 'Test Pipeline', 'running', '2024-01-01 00:00'
  );

  // Tasks:
  //   T1 (auto, running) — no deps
  //   T2 (auto, queued)    — depends on T1
  //   T3 (manual, queued)  — depends on T1
  //   T4 (auto, queued)    — depends on T2 AND T3
  db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    't1', 'p1', 'Task 1', 'agent-1', 'claude', 'auto', 'running', 0, 'Do step 1', 0
  );
  db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    't2', 'p1', 'Task 2', 'agent-1', 'claude', 'auto', 'queued', 1, 'Do step 2', 1
  );
  db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    't3', 'p1', 'Task 3', 'agent-1', 'claude', 'manual', 'queued', 1, 'Do step 3', 2
  );
  db.prepare('INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    't4', 'p1', 'Task 4', 'agent-1', 'claude', 'auto', 'queued', 2, 'Do step 4', 3
  );

  // Dependencies
  db.prepare('INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)').run('t2', 't1');
  db.prepare('INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)').run('t3', 't1');
  db.prepare('INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)').run('t4', 't2');
  db.prepare('INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)').run('t4', 't3');

  return { pipelineId: 'p1', taskIds: ['t1', 't2', 't3', 't4'] };
}

/** Seed safety rules for testing */
export function seedSafetyRules(db: Database.Database) {
  const rules = [
    { id: 'cmd-rm-rf', rule_type: 'command_blacklist', pattern: 'rm\\s+(-[a-zA-Z]*f[a-zA-Z]*\\s+|.*-rf|.*--no-preserve-root)', severity: 'block', description: 'Recursive force delete' },
    { id: 'cmd-chmod-777', rule_type: 'command_blacklist', pattern: 'chmod\\s+(-[a-zA-Z]*\\s+)*777\\s', severity: 'warn', description: 'World-writable permissions' },
    { id: 'cmd-curl-pipe', rule_type: 'command_blacklist', pattern: 'curl\\s+.*\\|\\s*(sudo\\s+)?(ba)?sh', severity: 'block', description: 'Pipe remote script to shell' },
    { id: 'env-aws-key', rule_type: 'env_blacklist', pattern: 'AWS_SECRET_ACCESS_KEY', severity: 'block', description: 'AWS secret key exposure' },
    { id: 'env-private-key', rule_type: 'env_blacklist', pattern: '-----BEGIN\\s+(RSA\\s+)?PRIVATE\\s+KEY-----', severity: 'block', description: 'Private key in output' },
    { id: 'path-system', rule_type: 'path_blacklist', pattern: '^/(etc|usr|bin|sbin|boot|sys|proc)/', severity: 'block', description: 'System directory access' },
    { id: 'path-ssh', rule_type: 'path_blacklist', pattern: '\\.ssh/', severity: 'block', description: 'SSH directory access' },
    { id: 'path-env-file', rule_type: 'path_blacklist', pattern: '\\.env(\\.local|\\.production|\\.staging)?$', severity: 'warn', description: 'Environment file access' },
  ];

  const insert = db.prepare(
    'INSERT INTO safety_rules (id, rule_type, pattern, severity, description, enabled) VALUES (?, ?, ?, ?, ?, 1)'
  );
  for (const r of rules) {
    insert.run(r.id, r.rule_type, r.pattern, r.severity, r.description);
  }
}
