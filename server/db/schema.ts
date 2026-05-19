import type Database from 'better-sqlite3';
import { parseCliOutput } from '../executor/output-parser.js';
import { backfillUsageMetrics } from '../services/usage-service.js';

type LegacyTriggerType =
  | 'initial'
  | 'retry'
  | 'follow_up'
  | 'agent_switch'
  | 'provider_switch'
  | 'model_switch';

interface LegacyTaskRow {
  id: string;
  agent_id: string | null;
  created_at: string | null;
}

interface LegacyRunRow {
  id: string;
  task_id: string;
  cycle_id: string | null;
  started_at: string;
  completed_at: string | null;
  status: string;
  attempt: number;
  attempt_number: number | null;
  session_id: string | null;
  provider_session_id: string | null;
  is_follow_up: number;
  follow_up_prompt: string | null;
  model_used: string | null;
  agent_id: string | null;
  provider: string | null;
  parent_run_id: string | null;
  trigger_type: string | null;
  stdout: string | null;
  stderr: string | null;
  parsed_output: string | null;
  error_message: string | null;
}

function makeMigrationId(prefix: string, seed: string): string {
  return `${prefix}_${seed}_${Math.random().toString(36).slice(2, 8)}`;
}

function inferProviderFromModel(model: string | null): string | null {
  if (!model) return null;

  const prefix = model.split(':')[0];
  if (prefix === 'claude' || prefix === 'gemini' || prefix === 'codex') {
    return prefix;
  }

  if (/^(gpt-|o[1-9]|codex)/i.test(model)) return 'codex';
  if (/^gemini/i.test(model)) return 'gemini';
  if (/^claude/i.test(model)) return 'claude';

  return null;
}

function parseLegacyContent(value: string | null): string {
  if (!value?.trim()) return '';
  const parsed = parseCliOutput(value).content.trim();
  return parsed || value.trim();
}

function isRawStructuredJson(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith('{"type":') || trimmed.startsWith('{"session_id":');
}

function buildLegacyRunContent(run: LegacyRunRow): string {
  if (run.parsed_output?.trim()) {
    return run.parsed_output.trim();
  }

  if (run.status !== 'completed') {
    const stderr = parseLegacyContent(run.stderr);
    if (stderr) return stderr;

    const errorMessage = run.error_message?.trim();
    if (errorMessage) return errorMessage;

    const stdout = parseLegacyContent(run.stdout);
    if (stdout && !isRawStructuredJson(stdout)) return stdout;
    return '';
  }

  const stdout = parseLegacyContent(run.stdout);
  if (stdout && !isRawStructuredJson(stdout)) return stdout;

  const stderr = parseLegacyContent(run.stderr);
  if (stderr) return stderr;

  return run.error_message?.trim() ?? '';
}

function inferLegacyTriggerType(
  previousRun: LegacyRunRow | null,
  run: LegacyRunRow,
): LegacyTriggerType {
  if (!previousRun) return 'initial';

  const hasFollowUp = !!run.follow_up_prompt?.trim() || run.is_follow_up === 1;
  if (hasFollowUp) return 'follow_up';

  if (previousRun.agent_id && run.agent_id && previousRun.agent_id !== run.agent_id) {
    return 'agent_switch';
  }

  const previousProvider = previousRun.provider || inferProviderFromModel(previousRun.model_used);
  const currentProvider = run.provider || inferProviderFromModel(run.model_used);
  if (previousProvider && currentProvider && previousProvider !== currentProvider) {
    return 'provider_switch';
  }

  if (previousRun.model_used && run.model_used && previousRun.model_used !== run.model_used) {
    return 'model_switch';
  }

  return 'retry';
}

function backfillLegacyExecutionConversations(db: Database.Database): void {
  const taskRows = db.prepare(
    'SELECT id, agent_id, created_at FROM tasks'
  ).all() as LegacyTaskRow[];

  const getRunsStmt = db.prepare(`
    SELECT
      id, task_id, cycle_id, started_at, completed_at, status, attempt, attempt_number,
      session_id, provider_session_id, is_follow_up, follow_up_prompt, model_used,
      agent_id, provider, parent_run_id, trigger_type, stdout, stderr, parsed_output,
      error_message
    FROM execution_runs
    WHERE task_id = ?
    ORDER BY started_at ASC, id ASC
  `);
  const hasCycleMessageStmt = db.prepare(
    'SELECT 1 FROM conversation_messages WHERE run_id = ? AND role = ? AND message_type = ? LIMIT 1'
  );
  const updateRunStmt = db.prepare(`
    UPDATE execution_runs
    SET attempt_number = ?,
        parent_run_id = ?,
        trigger_type = ?,
        provider = ?,
        agent_id = ?,
        provider_session_id = COALESCE(provider_session_id, session_id)
    WHERE id = ?
  `);
  const insertMessageStmt = db.prepare(`
    INSERT INTO conversation_messages (
      id, task_id, cycle_id, run_id, role, message_type, content, created_at,
      agent_id, provider, model_used, meta_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const task of taskRows) {
    const runs = getRunsStmt.all(task.id) as LegacyRunRow[];
    if (runs.length === 0) continue;

    let previousRun: LegacyRunRow | null = null;
    for (let index = 0; index < runs.length; index += 1) {
      const run = runs[index]!;
      const triggerType = inferLegacyTriggerType(previousRun, run);
      const provider = run.provider || inferProviderFromModel(run.model_used);
      const agentId = run.agent_id || task.agent_id || null;

      updateRunStmt.run(
        index + 1,
        previousRun?.id ?? null,
        triggerType,
        provider,
        agentId,
        run.id,
      );

      if (run.cycle_id) {
        const followUpPrompt = run.follow_up_prompt?.trim();
        if (followUpPrompt && !hasCycleMessageStmt.get(run.id, 'user', 'follow_up')) {
          insertMessageStmt.run(
            makeMigrationId('msg_user', run.id),
            run.task_id,
            run.cycle_id,
            run.id,
            'user',
            'follow_up',
            followUpPrompt,
            run.started_at || task.created_at || new Date().toISOString(),
            agentId,
            provider,
            run.model_used,
            JSON.stringify({ backfilled: true, legacy: true }),
          );
        }

        const content = buildLegacyRunContent(run);
        if (content) {
          const role = run.status === 'completed' ? 'assistant' : 'system';
          const messageType = run.status === 'completed' ? 'final_answer' : 'error';
          if (!hasCycleMessageStmt.get(run.id, role, messageType)) {
            insertMessageStmt.run(
              makeMigrationId('msg_run', run.id),
              run.task_id,
              run.cycle_id,
              run.id,
              role,
              messageType,
              content,
              run.completed_at || run.started_at || task.created_at || new Date().toISOString(),
              agentId,
              provider,
              run.model_used,
              JSON.stringify({ backfilled: true, legacy: true }),
            );
          }
        }
      }

      previousRun = {
        ...run,
        agent_id: agentId,
        provider,
      };
    }
  }
}

export function createTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipelines (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      created TEXT NOT NULL,
      context_data TEXT DEFAULT '{}',
      working_dir TEXT NOT NULL DEFAULT '.',
      git_branch TEXT,
      execution_mode TEXT DEFAULT 'cli'
    );

    CREATE TABLE IF NOT EXISTS tasks (
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
      priority TEXT
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
      PRIMARY KEY (task_id, depends_on_task_id)
    );

    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT '',
      default_model TEXT NOT NULL DEFAULT 'claude:sonnet',
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

    CREATE TABLE IF NOT EXISTS execution_runs (
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
      worktree_path TEXT
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

    CREATE TABLE IF NOT EXISTS breakdown_drafts (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      description TEXT NOT NULL DEFAULT '',
      selected_agents TEXT NOT NULL DEFAULT '[]',
      plan_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_breakdown_drafts_pipeline ON breakdown_drafts(pipeline_id);

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
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_control_requests_task ON control_requests(task_id);
    CREATE INDEX IF NOT EXISTS idx_control_requests_status ON control_requests(status);
    CREATE INDEX IF NOT EXISTS idx_attachments_target ON attachments(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_pipeline ON attachments(pipeline_id);
  `);

  // Migration: add priority column if missing (for existing databases)
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN priority TEXT');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add task_type column
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN task_type TEXT NOT NULL DEFAULT 'seeded'");
  } catch {
    // Column already exists — ignore
  }

  // Migration: add stage_id column
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN stage_id TEXT');
  } catch {
    // Column already exists — ignore
  }

  // Migration: add created_at column to tasks
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN created_at TEXT NOT NULL DEFAULT ''");
  } catch {
    // Column already exists — ignore
  }

  // Migration: add pipeline description, rules, enabled_agents columns
  try {
    db.exec("ALTER TABLE pipelines ADD COLUMN description TEXT DEFAULT ''");
  } catch { /* exists */ }
  try {
    db.exec("ALTER TABLE pipelines ADD COLUMN rules TEXT DEFAULT ''");
  } catch { /* exists */ }
  try {
    db.exec("ALTER TABLE pipelines ADD COLUMN enabled_agents TEXT DEFAULT '[]'");
  } catch { /* exists */ }

  // Pipeline stages table
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_stages (
      id TEXT PRIMARY KEY,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      color TEXT DEFAULT '#9CA3AF',
      max_parallel INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_pipeline_stages_pipeline ON pipeline_stages(pipeline_id);
  `);

  // Migration: rename old statuses in existing data
  db.exec(`
    UPDATE tasks SET status = 'queued' WHERE status IN ('todo', 'waiting');
    UPDATE tasks SET status = 'completed' WHERE status = 'done';
    UPDATE tasks SET status = 'awaiting_approval' WHERE status = 'pending_approval';
    UPDATE pipelines SET status = 'queued' WHERE status IN ('waiting', 'todo');
    UPDATE pipelines SET status = 'completed' WHERE status = 'done';
    UPDATE pipelines SET status = 'awaiting_approval' WHERE status = 'pending_approval';
  `);

  // Migration: add interactive_mode column to tasks
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN interactive_mode INTEGER NOT NULL DEFAULT 0');
  } catch { /* exists */ }

  // Migration: preserve original task input and editable current input separately
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN original_input TEXT NOT NULL DEFAULT ''");
  } catch { /* exists */ }
  try {
    db.exec("ALTER TABLE tasks ADD COLUMN current_input TEXT NOT NULL DEFAULT ''");
  } catch { /* exists */ }
  db.exec(`
    UPDATE tasks
    SET original_input = CASE WHEN COALESCE(original_input, '') = '' THEN COALESCE(input, '') ELSE original_input END,
        current_input = CASE WHEN COALESCE(current_input, '') = '' THEN COALESCE(input, '') ELSE current_input END
  `);

  // Migration: add session_id to execution_runs for CLI resume support
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN session_id TEXT');
  } catch { /* exists */ }

  // Migration: enrich execution_runs for cycle/attempt tracking
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN cycle_id TEXT');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN attempt_number INTEGER');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN parent_run_id TEXT');
  } catch { /* exists */ }
  try {
    db.exec("ALTER TABLE execution_runs ADD COLUMN trigger_type TEXT NOT NULL DEFAULT 'initial'");
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN agent_id TEXT');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN provider TEXT');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN provider_session_id TEXT');
  } catch { /* exists */ }
  try {
    db.exec("ALTER TABLE execution_runs ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'");
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN input_tokens INTEGER');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN output_tokens INTEGER');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN cache_read_input_tokens INTEGER');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN cache_creation_input_tokens INTEGER');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN cost_usd REAL');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN pricing_source TEXT');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN pricing_snapshot_json TEXT');
  } catch { /* exists */ }

  // Migration: add follow_up_prompt and is_follow_up to execution_runs for conversation threading
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN user_note TEXT');
  } catch { /* exists */ }
  // Rename user_note → follow_up_prompt
  try {
    db.exec('ALTER TABLE execution_runs RENAME COLUMN user_note TO follow_up_prompt');
  } catch { /* already renamed or doesn't exist */ }
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN is_follow_up INTEGER NOT NULL DEFAULT 0');
  } catch { /* exists */ }

  // Migration: add task-level worktree control
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN use_worktree INTEGER NOT NULL DEFAULT 1');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN branch TEXT');
  } catch { /* exists */ }

  // Migration: add archived_at column for task archiving
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN archived_at TEXT');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN input_tokens INTEGER');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN output_tokens INTEGER');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN cost_usd REAL');
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN resume_at TEXT');
  } catch { /* exists */ }
  // Partial index keeps the rate-limit resumer's polling query (runs every
  // 5min) off a full tasks scan once the table grows.
  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_tasks_resume_at ON tasks(resume_at) WHERE status = 'rate_limited'",
    );
  } catch { /* exists */ }

  // Migration: add crew member fields to agents
  try {
    db.exec("ALTER TABLE agents ADD COLUMN title TEXT NOT NULL DEFAULT ''");
  } catch { /* exists */ }
  try {
    db.exec("ALTER TABLE agents ADD COLUMN avatar_seed TEXT NOT NULL DEFAULT ''");
  } catch { /* exists */ }

  // ─── Providers & Models tables ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      color TEXT NOT NULL,
      bg TEXT NOT NULL,
      cli_command TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1
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
    CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider);
  `);

  // Migration: provider-level execution mode + api key (cli or api)
  try {
    db.exec("ALTER TABLE providers ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'cli'");
  } catch { /* exists */ }
  try {
    db.exec('ALTER TABLE providers ADD COLUMN api_key TEXT');
  } catch { /* exists */ }

  // Migration: map bare provider model keys to specific sub-models
  db.exec(`
    UPDATE tasks SET model = 'claude:sonnet' WHERE model = 'claude';
    UPDATE tasks SET model = 'gemini:2.5-pro' WHERE model = 'gemini';
    UPDATE tasks SET model = 'codex:codex-1' WHERE model = 'codex';
    UPDATE tasks SET model = 'codex:codex-1' WHERE model = 'codex:gpt-4o';
    UPDATE tasks SET model = 'codex:o3' WHERE model = 'codex:o1';
    UPDATE agents SET default_model = 'claude:sonnet' WHERE default_model = 'claude';
    UPDATE agents SET default_model = 'gemini:2.5-pro' WHERE default_model = 'gemini';
    UPDATE agents SET default_model = 'codex:codex-1' WHERE default_model = 'codex';
    UPDATE agents SET default_model = 'codex:codex-1' WHERE default_model = 'codex:gpt-4o';
  `);

  // ─── Attachments table ───
  db.exec(`
    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachments_target ON attachments(target_type, target_id);
    CREATE INDEX IF NOT EXISTS idx_attachments_pipeline ON attachments(pipeline_id);
  `);

  // Seed: interactive question timeout setting
  db.exec(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('interactive_question_timeout_ms', '300000')
  `);

  // Migration: rename task hook setting keys to run hook keys while preserving
  // existing values from older installations.
  db.exec(`
    INSERT OR IGNORE INTO settings (key, value) VALUES ('pre_run_hook', '');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('post_run_hook', '');
    UPDATE settings
    SET value = (
      SELECT value FROM settings legacy WHERE legacy.key = 'pre_task_hook'
    )
    WHERE key = 'pre_run_hook'
      AND value = ''
      AND EXISTS (
        SELECT 1 FROM settings legacy
        WHERE legacy.key = 'pre_task_hook' AND legacy.value != ''
      );
    UPDATE settings
    SET value = (
      SELECT value FROM settings legacy WHERE legacy.key = 'post_task_hook'
    )
    WHERE key = 'post_run_hook'
      AND value = ''
      AND EXISTS (
        SELECT 1 FROM settings legacy
        WHERE legacy.key = 'post_task_hook' AND legacy.value != ''
      );
  `);

  // Migration: add condition column to task_deps for conditional branching
  try {
    db.exec('ALTER TABLE task_deps ADD COLUMN condition TEXT');
  } catch (err) {
    // Ignore "duplicate column" errors, re-throw anything else
    if (!(err instanceof Error) || !err.message.includes('duplicate column')) throw err;
  }

  // Migration: add auto_retry column to tasks for automatic retry with feedback
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN auto_retry INTEGER NOT NULL DEFAULT 0');
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('duplicate column')) throw err;
  }

  // Conflict-fixer fingerprint: the two commit SHAs that produced the conflict.
  // Used to dedupe fixer spawns — re-running merge/rebase with identical tips
  // reuses the existing pending fixer instead of spawning a new one.
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN conflict_base_sha TEXT');
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('duplicate column')) throw err;
  }
  try {
    db.exec('ALTER TABLE tasks ADD COLUMN conflict_branch_sha TEXT');
  } catch (err) {
    if (!(err instanceof Error) || !err.message.includes('duplicate column')) throw err;
  }
  try {
    db.exec(
      'CREATE INDEX IF NOT EXISTS idx_tasks_conflict_fixer ON tasks(source_task_id, task_type, status)',
    );
  } catch { /* exists */ }

  // Migration: add parsed_output to execution_runs for per-run parsed content
  try {
    db.exec('ALTER TABLE execution_runs ADD COLUMN parsed_output TEXT');
  } catch { /* exists */ }

  // Context packet storage for reversible prompt compaction
  db.exec(`
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
    CREATE INDEX IF NOT EXISTS idx_context_packets_task ON context_packets(task_id, source_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_context_packets_cycle ON context_packets(cycle_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_context_packets_hash ON context_packets(content_hash);
  `);

  // Migration: backfill task_cycles and execution_runs.cycle_id for older data.
  try {
    const taskRows = db.prepare('SELECT id, created_at FROM tasks').all() as { id: string; created_at: string | null }[];
    const hasCycleStmt = db.prepare('SELECT id FROM task_cycles WHERE task_id = ? ORDER BY cycle_number DESC LIMIT 1');
    const insertCycleStmt = db.prepare(`
      INSERT INTO task_cycles (id, task_id, cycle_number, status, started_at, started_by, summary)
      VALUES (?, ?, 1, 'legacy', ?, 'migration', '')
    `);
    const updateRunCycleStmt = db.prepare(`
      UPDATE execution_runs
      SET cycle_id = COALESCE(cycle_id, ?),
          attempt_number = COALESCE(attempt_number, attempt),
          provider_session_id = COALESCE(provider_session_id, session_id)
      WHERE task_id = ?
    `);

    for (const task of taskRows) {
      const existingCycle = hasCycleStmt.get(task.id) as { id: string } | undefined;
      const cycleId = existingCycle?.id ?? `cycle_${task.id}_1`;
      if (!existingCycle) {
        insertCycleStmt.run(cycleId, task.id, task.created_at || new Date().toISOString());
      }
      updateRunCycleStmt.run(cycleId, task.id);
    }
  } catch {
    // Non-fatal migration; ignore if partial data blocks backfill.
  }

  try {
    backfillLegacyExecutionConversations(db);
  } catch {
    // Non-fatal migration; ignore if partial data blocks backfill.
  }

  try {
    backfillUsageMetrics(db);
  } catch {
    // Non-fatal migration; ignore if partial data blocks backfill.
  }
}
