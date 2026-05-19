import type Database from 'better-sqlite3';
import { backfillUsageMetrics } from '../services/usage-service.js';

const AGENTS = [
  { id: 'research',  name: 'Scout',           title: 'Research Analyst',     icon: '🔍', avatar_seed: 'Scout',     default_model: 'gemini:2.5-pro', prompt: 'You are a research specialist. Analyze the given topic, identify market trends, competitors, and key insights. Output structured findings in markdown.' },
  { id: 'product',   name: 'Compass',         title: 'Product Owner',        icon: '📋', avatar_seed: 'Compass',   default_model: 'claude:sonnet', prompt: 'You are an experienced product manager. Create a concise PRD with user stories, feature priorities, and success metrics.' },
  { id: 'architect', name: 'Atlas',           title: 'Systems Architect',    icon: '🏗️', avatar_seed: 'Atlas',     default_model: 'claude:sonnet', prompt: 'You are a software architect. Design system architecture, choose appropriate tech stack, define API contracts and database schemas.' },
  { id: 'designer',  name: 'Pixel',           title: 'UI/UX Designer',       icon: '🎨', avatar_seed: 'Pixel',     default_model: 'claude:sonnet', prompt: 'You are a UI/UX designer. Create detailed design specifications including component hierarchy, color system, and interaction patterns.' },
  { id: 'developer', name: 'Forge',           title: 'Senior Developer',     icon: '💻', avatar_seed: 'Forge',     default_model: 'codex:codex-1', prompt: 'You are a senior full-stack developer. Write production-ready code based on the design spec. Include error handling and tests.' },
  { id: 'seo',       name: 'Beacon',          title: 'SEO Specialist',       icon: '📈', avatar_seed: 'Beacon',    default_model: 'gemini:2.5-pro', prompt: 'You are an SEO specialist. Optimize content for search engines: meta tags, structured data, keyword placement.' },
  { id: 'content',   name: 'Quill',           title: 'Content Writer',       icon: '✍️', avatar_seed: 'Quill',     default_model: 'gemini:2.5-flash', prompt: 'You are a copywriter. Write compelling, conversion-focused content. Match brand voice and include CTAs.' },
  { id: 'qa',        name: 'Sentinel',        title: 'QA Engineer',          icon: '🧪', avatar_seed: 'Sentinel',  default_model: 'claude:sonnet', prompt: 'You are a QA engineer. Review outputs for quality, consistency, and correctness. Identify issues and suggest improvements.' },
  { id: 'deploy',    name: 'Rocket',          title: 'DevOps Engineer',      icon: '🚀', avatar_seed: 'Rocket',    default_model: 'codex:codex-1', prompt: 'You are a DevOps engineer. Handle deployment pipeline: build, test, deploy to staging then production.' },
];

const PROVIDERS = [
  { id: 'claude', label: 'Claude', color: '#D97706', bg: '#1C1208', cli_command: 'claude', sort_order: 0 },
  { id: 'gemini', label: 'Gemini', color: '#3B82F6', bg: '#08111F', cli_command: 'gemini', sort_order: 1 },
  { id: 'codex',  label: 'Codex',  color: '#22C55E', bg: '#071710', cli_command: 'codex',  sort_order: 2 },
];

const MODEL_DEFS = [
  { id: 'claude:sonnet', provider: 'claude', label: 'Claude Sonnet', color: '#D97706', bg: '#1C1208', cost_per_1k: 0.015, cli_flag: 'claude-sonnet-4-6',           sort_order: 0 },
  { id: 'claude:opus',   provider: 'claude', label: 'Claude Opus',   color: '#D97706', bg: '#1C1208', cost_per_1k: 0.075, cli_flag: 'claude-opus-4-7',             sort_order: 1 },
  { id: 'claude:haiku',  provider: 'claude', label: 'Claude Haiku',  color: '#D97706', bg: '#1C1208', cost_per_1k: 0.001, cli_flag: 'claude-haiku-4-5-20251001',   sort_order: 2 },
  { id: 'gemini:2.5-pro',  provider: 'gemini', label: 'Gemini 2.5 Pro',  color: '#3B82F6', bg: '#08111F', cost_per_1k: 0.00125, cli_flag: 'gemini-2.5-pro',   sort_order: 0 },
  { id: 'gemini:2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash', color: '#3B82F6', bg: '#08111F', cost_per_1k: 0.0003, cli_flag: 'gemini-2.5-flash', sort_order: 1 },
  { id: 'codex:codex-1',  provider: 'codex', label: 'Codex 1',       color: '#22C55E', bg: '#071710', cost_per_1k: 0.020, cli_flag: 'codex-1',  sort_order: 0 },
  { id: 'codex:gpt-5.4', provider: 'codex', label: 'GPT 5.4',      color: '#22C55E', bg: '#071710', cost_per_1k: 0.010, cli_flag: 'gpt-5.4', sort_order: 1 },
  { id: 'codex:o4-mini',  provider: 'codex', label: 'o4 Mini',      color: '#22C55E', bg: '#071710', cost_per_1k: 0.005, cli_flag: 'o4-mini',  sort_order: 2 },
  { id: 'codex:o3',      provider: 'codex', label: 'o3',            color: '#22C55E', bg: '#071710', cost_per_1k: 0.020, cli_flag: 'o3',       sort_order: 3 },
];

const PIPELINES = [
  {
    id: 'p1',
    name: 'SaaS Landing Page',
    status: 'running',
    created: '2025-03-10 09:14',
    logs: [
      { time: '2025-03-10 09:14:02', type: 'info',    msg: 'Pipeline initialized' },
      { time: '2025-03-10 09:14:03', type: 'model',   msg: 'Gemini → Research Agent' },
      { time: '2025-03-10 09:14:17', type: 'success', msg: 'Market Research completed — 3,200 tokens' },
      { time: '2025-03-10 09:14:17', type: 'model',   msg: 'Claude → Product Owner' },
      { time: '2025-03-10 09:14:39', type: 'warning', msg: 'Product Brief awaiting manual approval' },
    ],
    tasks: [
      { id: 't1', name: 'Market Research',  agent_id: 'research',  model: 'gemini', approval: 'auto',   status: 'completed',          stage: 0, input: 'Build a SaaS landing page for a fraud detection tool targeting fintech companies.', output: '3 competitors identified. Target: fintech CTOs. Recommended tone: technical-confident.', tokens: 3200, duration: '14s', depends_on: [] },
      { id: 't2', name: 'Product Brief',    agent_id: 'product',   model: 'claude', approval: 'manual', status: 'awaiting_approval',  stage: 1, input: 'Research output + idea brief', output: 'PRD: Hero, Features, Pricing, CTA. Tone: dark, technical.', tokens: 5100, duration: '22s', depends_on: ['t1'] },
      { id: 't3', name: 'Copywriting',      agent_id: 'content',   model: 'gemini', approval: 'auto',   status: 'queued',             stage: 2, input: 'PRD output', output: null, tokens: null, duration: null, depends_on: ['t2'] },
      { id: 't4', name: 'UI Design Spec',   agent_id: 'designer',  model: 'claude', approval: 'manual', status: 'queued',             stage: 2, input: 'PRD output', output: null, tokens: null, duration: null, depends_on: ['t2'] },
      { id: 't5', name: 'Frontend Code',    agent_id: 'developer', model: 'codex',  approval: 'manual', status: 'queued',             stage: 3, input: 'Design spec + copy', output: null, tokens: null, duration: null, depends_on: ['t3', 't4'] },
      { id: 't6', name: 'SEO Optimization', agent_id: 'seo',       model: 'gemini', approval: 'auto',   status: 'queued',             stage: 4, input: 'HTML output', output: null, tokens: null, duration: null, depends_on: ['t5'] },
      { id: 't7', name: 'Deploy',           agent_id: 'deploy',    model: 'codex',  approval: 'manual', status: 'queued',             stage: 4, input: 'Final build', output: null, tokens: null, duration: null, depends_on: ['t5'] },
    ],
  },
  {
    id: 'p2',
    name: 'Blog Post: AI in Fraud',
    status: 'completed',
    created: '2025-03-09 14:30',
    logs: [
      { time: '2025-03-09 14:30:01', type: 'info',    msg: 'Pipeline initialized' },
      { time: '2025-03-09 14:30:02', type: 'success', msg: 'Topic Research completed' },
      { time: '2025-03-09 14:31:10', type: 'success', msg: 'Draft Article completed' },
      { time: '2025-03-09 14:31:55', type: 'success', msg: 'SEO & Publish completed' },
      { time: '14:31:56', type: 'success', msg: 'Pipeline completed' },
    ],
    tasks: [
      { id: 't8',  name: 'Topic Research', agent_id: 'research', model: 'gemini', approval: 'auto',   status: 'completed', stage: 0, input: 'Blog post on AI fraud detection trends 2025.', output: 'Top trends identified. 5 key sources.', tokens: 2800, duration: '11s', depends_on: [] },
      { id: 't9',  name: 'Draft Article',  agent_id: 'content',  model: 'claude', approval: 'manual', status: 'completed', stage: 1, input: 'Research output', output: '1200-word draft completed.', tokens: 7400, duration: '31s', depends_on: ['t8'] },
      { id: 't10', name: 'SEO & Publish',  agent_id: 'seo',      model: 'gemini', approval: 'auto',   status: 'completed', stage: 2, input: 'Draft article',  output: 'Published to /blog/ai-fraud-2025.', tokens: 1100, duration: '8s', depends_on: ['t9'] },
    ],
  },
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
    'INSERT OR IGNORE INTO models (id, provider, label, color, bg, cost_per_1k, cli_flag, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  for (const m of MODEL_DEFS) {
    insertModel.run(m.id, m.provider, m.label, m.color, m.bg, m.cost_per_1k, m.cli_flag, m.sort_order);
  }

  backfillUsageMetrics(db);

  const agentCount = db.prepare('SELECT COUNT(*) as count FROM agents').get() as { count: number };
  if (agentCount.count > 0) return; // Demo data already seeded

  const insertAgent = db.prepare(
    'INSERT INTO agents (id, name, icon, title, avatar_seed, default_model, prompt) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertPipeline = db.prepare(
    'INSERT INTO pipelines (id, name, status, created) VALUES (?, ?, ?, ?)'
  );
  const insertTask = db.prepare(
    'INSERT INTO tasks (id, pipeline_id, name, agent_id, model, approval, status, stage, input, output, tokens, duration, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const insertDep = db.prepare(
    'INSERT INTO task_deps (task_id, depends_on_task_id) VALUES (?, ?)'
  );
  const insertLog = db.prepare(
    'INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)'
  );

  const seedAll = db.transaction(() => {
    for (const agent of AGENTS) {
      insertAgent.run(agent.id, agent.name, agent.icon, agent.title, agent.avatar_seed, agent.default_model, agent.prompt);
    }

    for (const pipeline of PIPELINES) {
      insertPipeline.run(pipeline.id, pipeline.name, pipeline.status, pipeline.created);

      for (const log of pipeline.logs) {
        insertLog.run(pipeline.id, log.time, log.type, log.msg);
      }

      for (let i = 0; i < pipeline.tasks.length; i++) {
        const task = pipeline.tasks[i]!;
        insertTask.run(
          task.id, pipeline.id, task.name, task.agent_id, task.model,
          task.approval, task.status, task.stage, task.input,
          task.output, task.tokens, task.duration, i
        );
        for (const depId of task.depends_on) {
          insertDep.run(task.id, depId);
        }
      }
    }
  });

  seedAll();
}
