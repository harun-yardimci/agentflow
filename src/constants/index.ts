import type { KanbanColumn, TaskStatus, TaskPriority, Agent, RoutingRule } from '@/types';

export const APPROVAL_MODES = ['auto', 'manual', 'on_error'] as const;

export const PRIORITIES: { key: TaskPriority; label: string; color: string; icon: string }[] = [
  { key: 'urgent', label: 'Urgent', color: '#DC2626', icon: '!!!' },
  { key: 'high',   label: 'High',   color: '#D97706', icon: '!!' },
  { key: 'medium', label: 'Medium', color: '#2563EB', icon: '!' },
  { key: 'low',    label: 'Low',    color: '#6B7280', icon: '-' },
];

export const PRESET_TAGS = [
  'frontend',
  'backend',
  'bugfix',
  'feature',
  'refactor',
  'design',
  'test',
  'documentation',
  'research',
];

export const TAG_COLORS = [
  '#8B5CF6', // violet
  '#06B6D4', // cyan
  '#F59E0B', // amber
  '#EC4899', // pink
  '#10B981', // emerald
  '#3B82F6', // blue
  '#EF4444', // red
  '#84CC16', // lime
];

export function getTagColor(tagName: string): string {
  let hash = 0;
  for (let i = 0; i < tagName.length; i++) {
    hash = ((hash << 5) - hash + tagName.charCodeAt(i)) | 0;
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length]!;
}

export const KANBAN_COLS: KanbanColumn[] = [
  { id: 'queued',    label: 'Queued',    color: '#9CA3AF' },
  { id: 'running',   label: 'Running',   color: '#3B82F6' },
  { id: 'completed', label: 'Completed', color: '#22C55E' },
  { id: 'blocked',   label: 'Blocked',   color: '#EF4444' },
];

export const STATUS_COLOR: Record<TaskStatus, string> = {
  queued: '#9CA3AF',
  running: '#3B82F6',
  completed: '#22C55E',
  blocked: '#EF4444',
  awaiting_approval: '#D97706',
  failed: '#EF4444',
  rejected: '#F97316',
  paused: '#F59E0B',
  skipped: '#64748B',
  rate_limited: '#06B6D4',
  auth_required: '#A855F7',
};


export const DEFAULT_PIPELINE_STAGES = [
  { name: 'Research',    color: '#8B5CF6' },
  { name: 'Planning',    color: '#2563EB' },
  { name: 'Development', color: '#16A34A' },
  { name: 'Testing',     color: '#F59E0B' },
  { name: 'Review',      color: '#EC4899' },
  { name: 'Deploy',      color: '#06B6D4' },
];

export const AGENT_TEMPLATES: Agent[] = [
  { id: 'research',  name: 'Scout',     title: 'Research Analyst',   avatarSeed: 'Scout',    defaultModel: 'gemini:2.5-pro', icon: '\uD83D\uDD0D', prompt: 'You are a research specialist. Analyze the given topic, identify market trends, competitors, and key insights. Output structured findings in markdown.' },
  { id: 'product',   name: 'Compass',   title: 'Product Owner',      avatarSeed: 'Compass',  defaultModel: 'claude:sonnet', icon: '\uD83D\uDCCB', prompt: 'You are an experienced product manager. Create a concise PRD with user stories, feature priorities, and success metrics.' },
  { id: 'architect', name: 'Atlas',     title: 'Systems Architect',  avatarSeed: 'Atlas',    defaultModel: 'claude:sonnet', icon: '\uD83C\uDFD7\uFE0F', prompt: 'You are a software architect. Design system architecture, choose appropriate tech stack, define API contracts and database schemas.' },
  { id: 'designer',  name: 'Pixel',     title: 'UI/UX Designer',     avatarSeed: 'Pixel',    defaultModel: 'claude:sonnet', icon: '\uD83C\uDFA8', prompt: 'You are a UI/UX designer. Create detailed design specifications including component hierarchy, color system, and interaction patterns.' },
  { id: 'developer', name: 'Forge',     title: 'Senior Developer',   avatarSeed: 'Forge',    defaultModel: 'codex:gpt-5.6-sol', icon: '\uD83D\uDCBB', prompt: 'You are a senior full-stack developer. Write production-ready code based on the design spec. Include error handling and tests.' },
  { id: 'seo',       name: 'Beacon',    title: 'SEO Specialist',     avatarSeed: 'Beacon',   defaultModel: 'gemini:2.5-pro', icon: '\uD83D\uDCC8', prompt: 'You are an SEO specialist. Optimize content for search engines: meta tags, structured data, keyword placement.' },
  { id: 'content',   name: 'Quill',     title: 'Content Writer',     avatarSeed: 'Quill',    defaultModel: 'gemini:2.5-flash', icon: '\u270D\uFE0F', prompt: 'You are a copywriter. Write compelling, conversion-focused content. Match brand voice and include CTAs.' },
  { id: 'qa',        name: 'Sentinel',  title: 'QA Engineer',        avatarSeed: 'Sentinel', defaultModel: 'claude:sonnet', icon: '\uD83E\uDDEA', prompt: 'You are a QA engineer. Review outputs for quality, consistency, and correctness. Identify issues and suggest improvements.' },
  { id: 'deploy',    name: 'Rocket',    title: 'DevOps Engineer',    avatarSeed: 'Rocket',   defaultModel: 'codex:gpt-5.6-sol', icon: '\uD83D\uDE80', prompt: 'You are a DevOps engineer. Handle deployment pipeline: build, test, deploy to staging then production.' },
];

/** Preset avatar seeds for the avatar picker */
export const AVATAR_SEED_PRESETS = [
  'Scout', 'Compass', 'Atlas', 'Pixel', 'Forge',
  'Beacon', 'Quill', 'Sentinel', 'Rocket', 'Nova',
  'Cipher', 'Orbit', 'Prism', 'Drift', 'Ember',
  'Nexus', 'Vortex', 'Zenith', 'Flux', 'Bolt',
  'Echo', 'Pulse', 'Spark', 'Helix', 'Onyx',
];

export const ROUTING_RULES: RoutingRule[] = [
  { condition: 'Task type: code generation',             model: 'codex:gpt-5.6-sol', reason: 'Latest frontier agentic coding model' },
  { condition: 'Task type: research / web search',       model: 'gemini:2.5-pro',  reason: 'Grounding + current data' },
  { condition: 'Task type: architecture & reasoning',    model: 'claude:sonnet',    reason: 'Long context + deep analysis' },
  { condition: 'Task type: bulk content writing',        model: 'gemini:2.5-flash', reason: 'Cost-effective, fast' },
  { condition: 'Token estimate > 10k',                   model: 'claude:opus',      reason: 'Handles long context reliably' },
  { condition: 'Approval = manual (critical task)',       model: 'claude:opus',      reason: 'Highest accuracy for reviewed steps' },
];

export const EMOJI_OPTIONS = [
  '\uD83D\uDD0D', '\uD83D\uDCCB', '\uD83C\uDFD7\uFE0F', '\uD83C\uDFA8', '\uD83D\uDCBB',
  '\uD83D\uDCC8', '\u270D\uFE0F', '\uD83E\uDDEA', '\uD83D\uDE80', '\uD83E\uDD16',
  '\uD83D\uDCA1', '\uD83D\uDEE0\uFE0F', '\uD83D\uDCCA', '\uD83D\uDCDD', '\u2699\uFE0F',
  '\uD83C\uDF10', '\uD83D\uDD12', '\uD83C\uDFAF',
];
