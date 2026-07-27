import type Database from 'better-sqlite3';
import { backfillUsageMetrics } from '../services/usage-service.js';

const AGENTS = [
  { id: 'research',  name: 'Scout',           title: 'Research Analyst',     icon: '🔍', avatar_seed: 'Scout',     default_model: 'gemini:2.5-pro', prompt: 'You are a research specialist. Analyze the given topic, identify market trends, competitors, and key insights. Output structured findings in markdown.' },
  { id: 'product',   name: 'Compass',         title: 'Product Owner',        icon: '📋', avatar_seed: 'Compass',   default_model: 'claude:sonnet', prompt: 'You are an experienced product manager. Create a concise PRD with user stories, feature priorities, and success metrics.' },
  { id: 'architect', name: 'Atlas',           title: 'Systems Architect',    icon: '🏗️', avatar_seed: 'Atlas',     default_model: 'claude:sonnet', prompt: 'You are a software architect. Design system architecture, choose appropriate tech stack, define API contracts and database schemas.' },
  { id: 'designer',  name: 'Pixel',           title: 'UI/UX Designer',       icon: '🎨', avatar_seed: 'Pixel',     default_model: 'claude:sonnet', prompt: 'You are a UI/UX designer. Create detailed design specifications including component hierarchy, color system, and interaction patterns.' },
  { id: 'developer', name: 'Forge',           title: 'Senior Developer',     icon: '💻', avatar_seed: 'Forge',     default_model: 'codex:gpt-5.6-sol', prompt: 'You are a senior full-stack developer. Write production-ready code based on the design spec. Include error handling and tests.' },
  { id: 'seo',       name: 'Beacon',          title: 'SEO Specialist',       icon: '📈', avatar_seed: 'Beacon',    default_model: 'gemini:2.5-pro', prompt: 'You are an SEO specialist. Optimize content for search engines: meta tags, structured data, keyword placement.' },
  { id: 'content',   name: 'Quill',           title: 'Content Writer',       icon: '✍️', avatar_seed: 'Quill',     default_model: 'gemini:2.5-flash', prompt: 'You are a copywriter. Write compelling, conversion-focused content. Match brand voice and include CTAs.' },
  { id: 'qa',        name: 'Sentinel',        title: 'QA Engineer',          icon: '🧪', avatar_seed: 'Sentinel',  default_model: 'claude:sonnet', prompt: 'You are a QA engineer. Review outputs for quality, consistency, and correctness. Identify issues and suggest improvements.' },
  { id: 'deploy',    name: 'Rocket',          title: 'DevOps Engineer',      icon: '🚀', avatar_seed: 'Rocket',    default_model: 'codex:gpt-5.6-sol', prompt: 'You are a DevOps engineer. Handle deployment pipeline: build, test, deploy to staging then production.' },
];

const PROVIDERS = [
  { id: 'claude', label: 'Claude', color: '#D97706', bg: '#1C1208', cli_command: 'claude', sort_order: 0 },
  { id: 'gemini', label: 'Gemini', color: '#3B82F6', bg: '#08111F', cli_command: 'gemini', sort_order: 1 },
  { id: 'codex',  label: 'Codex',  color: '#22C55E', bg: '#071710', cli_command: 'codex',  sort_order: 2 },
  { id: 'antigravity', label: 'Antigravity', color: '#8B5CF6', bg: '#120A20', cli_command: 'agy', sort_order: 3 },
];

interface ModelDef {
  id: string;
  provider: string;
  label: string;
  color: string;
  bg: string;
  cost_per_1k: number;
  cli_flag: string;
  sort_order: number;
  // Omitted means selectable. Set to 0 to ship a tier greyed out (e.g. while a
  // provider-side outage makes it unusable).
  enabled?: number;
}

const MODEL_DEFS: ModelDef[] = [
  // Fable 5 is the flagship tier — sits above Opus, for the hardest problems.
  // Announced pricing: $10 / 1M input, $50 / 1M output.
  { id: 'claude:fable',       provider: 'claude', label: 'Claude Fable 5',           color: '#D97706', bg: '#1C1208', cost_per_1k: 0.050, cli_flag: 'claude-fable-5',           sort_order: 0 },
  { id: 'claude:sonnet', provider: 'claude', label: 'Claude Sonnet', color: '#D97706', bg: '#1C1208', cost_per_1k: 0.015, cli_flag: 'claude-sonnet-4-6',           sort_order: 1 },
  { id: 'claude:opus',        provider: 'claude', label: 'Claude Opus 5',            color: '#D97706', bg: '#1C1208', cost_per_1k: 0.075, cli_flag: 'claude-opus-5',             sort_order: 2 },
  { id: 'claude:opus-legacy', provider: 'claude', label: 'Claude Opus 4.8 (Legacy)', color: '#D97706', bg: '#1C1208', cost_per_1k: 0.075, cli_flag: 'claude-opus-4-8',           sort_order: 3 },
  { id: 'claude:haiku',       provider: 'claude', label: 'Claude Haiku',             color: '#D97706', bg: '#1C1208', cost_per_1k: 0.001, cli_flag: 'claude-haiku-4-5-20251001', sort_order: 4 },
  { id: 'gemini:2.5-pro',  provider: 'gemini', label: 'Gemini 2.5 Pro',  color: '#3B82F6', bg: '#08111F', cost_per_1k: 0.00125, cli_flag: 'gemini-2.5-pro',   sort_order: 0 },
  { id: 'gemini:2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash', color: '#3B82F6', bg: '#08111F', cost_per_1k: 0.0003, cli_flag: 'gemini-2.5-flash', sort_order: 1 },
  // The 5.6 variants are Codex product tiers rather than public API SKUs, so no
  // token price is assigned. The public GPT models use their output-token rate.
  { id: 'codex:gpt-5.6-sol',   provider: 'codex', label: 'GPT 5.6 Sol',   color: '#22C55E', bg: '#071710', cost_per_1k: 0,      cli_flag: 'gpt-5.6-sol',   sort_order: 0 },
  { id: 'codex:gpt-5.6-terra', provider: 'codex', label: 'GPT 5.6 Terra', color: '#22C55E', bg: '#071710', cost_per_1k: 0,      cli_flag: 'gpt-5.6-terra', sort_order: 1 },
  { id: 'codex:gpt-5.6-luna',  provider: 'codex', label: 'GPT 5.6 Luna',  color: '#22C55E', bg: '#071710', cost_per_1k: 0,      cli_flag: 'gpt-5.6-luna',  sort_order: 2 },
  { id: 'codex:gpt-5.5',       provider: 'codex', label: 'GPT 5.5',       color: '#22C55E', bg: '#071710', cost_per_1k: 0.030,  cli_flag: 'gpt-5.5',       sort_order: 3 },
  { id: 'codex:gpt-5.4',       provider: 'codex', label: 'GPT 5.4',       color: '#22C55E', bg: '#071710', cost_per_1k: 0.015,  cli_flag: 'gpt-5.4',       sort_order: 4 },
  { id: 'codex:gpt-5.4-mini',  provider: 'codex', label: 'GPT 5.4 Mini',  color: '#22C55E', bg: '#071710', cost_per_1k: 0.0045, cli_flag: 'gpt-5.4-mini',  sort_order: 5 },
  // Antigravity (`agy`) exposes the Gemini 3 family. NOTE: this agy build's `--model`
  // accepts only backend-defined model ids that aren't locally enumerable; unknown
  // flags fall back silently to the account default (Gemini 3.5 Flash). These slugs
  // are best-effort and degrade gracefully until Google stabilizes the `--model` ids.
  { id: 'antigravity:gemini-3.1-pro',   provider: 'antigravity', label: 'Gemini 3.1 Pro',   color: '#8B5CF6', bg: '#120A20', cost_per_1k: 0, cli_flag: 'gemini-3.1-pro',   sort_order: 0 },
  { id: 'antigravity:gemini-3.5-flash', provider: 'antigravity', label: 'Gemini 3.5 Flash', color: '#8B5CF6', bg: '#120A20', cost_per_1k: 0, cli_flag: 'gemini-3.5-flash', sort_order: 1 },
];

const DEFAULT_SETTINGS = [
  { key: 'port', value: '3100' },
  { key: 'execution_mode', value: 'cli' },
  { key: 'max_parallel_tasks', value: '5' },
  { key: 'default_task_timeout_ms', value: '1800000' },
  { key: 'breakdown_timeout_ms', value: '600000' },
  { key: 'cli_skip_permissions', value: 'true' },
  { key: 'log_retention_days', value: '30' },
  { key: 'worktree_isolation', value: 'true' },
  { key: 'max_iterations', value: '3' },
  { key: 'max_retries', value: '2' },
  { key: 'pre_run_hook', value: '' },
  { key: 'post_run_hook', value: '' },
  { key: 'setup_completed', value: 'false' },
  { key: 'working_directory', value: '' },
  { key: 'approval_mode', value: 'manual' },
  { key: 'auto_spawn_follow_ups', value: 'false' },
  { key: 'max_spawned_tasks_per_completion', value: '10' },
];

export function seedDatabase(db: Database.Database): void {
  // Always ensure default settings exist (INSERT OR IGNORE — safe for existing DBs)
  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );
  for (const setting of DEFAULT_SETTINGS) {
    insertSetting.run(setting.key, setting.value);
  }

  // Always seed providers & models (INSERT OR IGNORE — safe for existing DBs)
  const insertProvider = db.prepare(
    'INSERT OR IGNORE INTO providers (id, label, color, bg, cli_command, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const p of PROVIDERS) {
    insertProvider.run(p.id, p.label, p.color, p.bg, p.cli_command, p.sort_order);
  }

  const insertModel = db.prepare(
    'INSERT OR IGNORE INTO models (id, provider, label, color, bg, cost_per_1k, cli_flag, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const m of MODEL_DEFS) {
    insertModel.run(m.id, m.provider, m.label, m.color, m.bg, m.cost_per_1k, m.cli_flag, m.sort_order, m.enabled ?? 1);
  }

  const syncCodexModel = db.prepare(`
    UPDATE models
      SET label = ?, color = ?, bg = ?, cost_per_1k = ?, cli_flag = ?, sort_order = ?
      WHERE id = ? AND provider = 'codex'
  `);
  for (const m of MODEL_DEFS) {
    if (m.provider === 'codex') {
      syncCodexModel.run(m.label, m.color, m.bg, m.cost_per_1k, m.cli_flag, m.sort_order, m.id);
    }
  }

  backfillUsageMetrics(db);

  // Remove only the superseded built-in Codex entries after legacy usage has
  // frozen its historical labels and pricing. User-created models stay intact.
  db.prepare(
    "DELETE FROM models WHERE id IN ('codex:codex-1', 'codex:o4-mini', 'codex:o3')",
  ).run();

  // Seed the starter crew (Scout, Compass, Atlas, ...) on first run only.
  // No demo pipelines — a fresh install opens an empty board.
  const agentCount = db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number };
  if (agentCount.count > 0) return;

  const insertAgent = db.prepare(
    'INSERT INTO agents (id, name, icon, title, avatar_seed, default_model, prompt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );

  const seedAgents = db.transaction(() => {
    for (const agent of AGENTS) {
      insertAgent.run(agent.id, agent.name, agent.icon, agent.title, agent.avatar_seed, agent.default_model, agent.prompt);
    }
  });

  seedAgents();
}
