import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';

export type ContextPacketSourceType =
  | 'cycle_history'
  | 'cycle_summary'
  | 'dependency_output'
  | 'previous_run'
  | 'project_context'
  | 'shared_memory'
  | 'sibling_output';

export type ContextPacketContentType =
  | 'code'
  | 'json'
  | 'log'
  | 'markdown'
  | 'text';

export type ContextPacketStrategy =
  | 'code_outline'
  | 'json_outline'
  | 'log_focus'
  | 'markdown_focus'
  | 'passthrough'
  | 'text_focus';

interface ContextPacketRow {
  id: string;
  pipeline_id: string;
  task_id: string;
  cycle_id: string;
  source_type: string;
  source_key: string;
  title: string;
  content_type: string;
  strategy: string;
  original_content: string;
  compact_content: string;
  content_hash: string;
  original_tokens: number;
  compact_tokens: number;
  created_at: string;
  last_accessed_at: string;
}

interface CompactContextInput {
  allowCompaction?: boolean;
  cycleId?: string | null;
  maxLines?: number;
  maxTokens?: number;
  minTokensToStore?: number;
  pipelineId: string;
  sourceKey: string;
  sourceType: ContextPacketSourceType;
  taskId: string;
  title: string;
  content: string;
}

export interface PromptContextBlock {
  compacted: boolean;
  compactTokens: number;
  contentType: ContextPacketContentType;
  originalTokens: number;
  packetId: string | null;
  rendered: string;
  savingsPercent: number;
  strategy: ContextPacketStrategy;
}

export interface ContextPacketRecord {
  compactContent: string;
  compactTokens: number;
  contentType: ContextPacketContentType;
  createdAt: string;
  id: string;
  lastAccessedAt: string;
  originalContent: string;
  originalTokens: number;
  pipelineId: string;
  savingsPercent: number;
  sourceKey: string;
  sourceType: ContextPacketSourceType;
  strategy: ContextPacketStrategy;
  taskId: string;
  title: string;
  cycleId: string | null;
}

const DEFAULT_MIN_TOKENS_TO_STORE = 220;
const DEFAULT_MAX_LINES = 24;
const DEFAULT_MAX_TOKENS = 420;
const MIN_RENDER_TOKEN_SAVINGS = 24;
export const CONTEXT_PACKET_DIR = '.agentflow/context-packets';

const PRIORITY_LINE_RE =
  /\b(api|contract|decision|endpoint|error|fail|failure|file|fixme|important|interface|migration|next|note|path|schema|summary|table|todo|warn|warning)\b/i;
const LOG_SIGNAL_RE =
  /\b(assert|denied|error|exception|fatal|fail|panic|refused|stack|timeout|traceback|warn|warning)\b/i;
const CODE_DECL_RE =
  /^\s*(export\s+)?(async\s+)?(class|const|def|enum|function|if|import|interface|type)\b/;

function nowIso(): string {
  return new Date().toISOString();
}

function estimateTokens(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;
  return Math.max(1, Math.ceil(trimmed.length / 4));
}

function makePacketId(seed: string): string {
  return `ctxpkt_${hashContent(seed).slice(0, 20)}`;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export function getContextPacketRelativePath(packetId: string): string {
  return `${CONTEXT_PACKET_DIR}/${packetId}.md`;
}

function detectContentType(content: string): ContextPacketContentType {
  const trimmed = content.trim();
  if (!trimmed) return 'text';

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return 'json';
    }
  } catch {
    // Not JSON.
  }

  const lines = trimmed.split(/\r?\n/);
  const logLikeLines = lines.filter((line) => LOG_SIGNAL_RE.test(line)).length;
  if (lines.length >= 8 && (logLikeLines >= 2 || /^(\[?\d{2}:?\d{2}|\d{4}-\d{2}-\d{2})/.test(trimmed))) {
    return 'log';
  }

  if (
    trimmed.includes('```')
    || lines.some((line) => CODE_DECL_RE.test(line))
    || (trimmed.includes('{') && trimmed.includes('}') && lines.some((line) => /;\s*$/.test(line)))
  ) {
    return 'code';
  }

  if (
    lines.some((line) => /^#{1,6}\s/.test(line))
    || lines.some((line) => /^[-*+]\s/.test(line))
    || lines.some((line) => /^\d+\.\s/.test(line))
  ) {
    return 'markdown';
  }

  return 'text';
}

function uniqueOrderedLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines) {
    const normalized = line.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(line);
  }
  return unique;
}

function takeSpans(lines: string[], indices: number[]): string[] {
  return indices
    .filter((index) => index >= 0 && index < lines.length)
    .map((index) => lines[index]!);
}

function clipLines(lines: string[], maxLines: number): string[] {
  if (lines.length <= maxLines) return lines;
  const head = lines.slice(0, Math.max(1, Math.floor(maxLines / 2)));
  const tailCount = Math.max(1, maxLines - head.length);
  const tail = lines.slice(-tailCount);
  return uniqueOrderedLines([...head, ...tail]);
}

function compactLog(content: string, maxLines: number): string {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const priority = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => LOG_SIGNAL_RE.test(line))
    .map(({ index }) => index);
  const selected = uniqueOrderedLines([
    ...takeSpans(lines, [0, 1, 2, 3]),
    ...takeSpans(lines, priority.slice(0, Math.max(6, maxLines - 10))),
    ...lines.slice(-6),
  ]);
  const clipped = clipLines(selected, maxLines);
  const omitted = Math.max(0, lines.length - clipped.length);
  const prefix = omitted > 0
    ? `[log focus: kept ${clipped.length}/${lines.length} lines, omitted ${omitted}]`
    : '[log focus]';
  return `${prefix}\n${clipped.join('\n')}`;
}

function compactCode(content: string, maxLines: number): string {
  const lines = content.split(/\r?\n/);
  const kept: string[] = [];
  let omittedCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    const keep =
      trimmed.startsWith('```')
      || trimmed.startsWith('//')
      || trimmed.startsWith('/*')
      || CODE_DECL_RE.test(line)
      || PRIORITY_LINE_RE.test(line);
    if (keep) {
      if (omittedCount > 0) {
        kept.push(`// ... ${omittedCount} line(s) omitted ...`);
        omittedCount = 0;
      }
      kept.push(line);
    } else if (trimmed) {
      omittedCount += 1;
    }
  }

  if (omittedCount > 0) {
    kept.push(`// ... ${omittedCount} line(s) omitted ...`);
  }

  const clipped = clipLines(uniqueOrderedLines(kept), maxLines);
  return clipped.join('\n');
}

function compactJson(content: string, maxLines: number): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (Array.isArray(parsed)) {
      const head = parsed.slice(0, 3);
      const tail = parsed.slice(-2);
      const selection = parsed.length <= 5 ? parsed : [...head, ...tail];
      const summary = {
        type: 'array',
        items: parsed.length,
        sample: selection,
      };
      return JSON.stringify(summary, null, 2)
        .split(/\r?\n/)
        .slice(0, maxLines)
        .join('\n');
    }

    if (parsed && typeof parsed === 'object') {
      const entries = Object.entries(parsed as Record<string, unknown>);
      const important = entries.filter(([key]) => PRIORITY_LINE_RE.test(key));
      const selected = (important.length > 0 ? important : entries).slice(0, 8);
      const summary = Object.fromEntries(selected);
      return JSON.stringify(
        {
          type: 'object',
          keys: entries.map(([key]) => key),
          summary,
        },
        null,
        2,
      )
        .split(/\r?\n/)
        .slice(0, maxLines)
        .join('\n');
    }
  } catch {
    // Fallback to text compaction below.
  }

  return compactText(content, maxLines, 'text_focus');
}

function compactText(
  content: string,
  maxLines: number,
  strategy: 'markdown_focus' | 'text_focus',
): string {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const priority = lines.filter((line) => {
    return /^#{1,6}\s/.test(line)
      || /^[-*+]\s/.test(line)
      || /^\d+\.\s/.test(line)
      || PRIORITY_LINE_RE.test(line);
  });
  const selected = uniqueOrderedLines([
    ...lines.slice(0, 5),
    ...priority.slice(0, Math.max(8, maxLines - 10)),
    ...lines.slice(-5),
  ]);
  const clipped = clipLines(selected, maxLines);
  const omitted = Math.max(0, lines.length - clipped.length);
  const prefix = omitted > 0
    ? `[${strategy}: kept ${clipped.length}/${lines.length} lines, omitted ${omitted}]`
    : `[${strategy}]`;
  return `${prefix}\n${clipped.join('\n')}`;
}

function compressContent(
  content: string,
  contentType: ContextPacketContentType,
  maxLines: number,
): { compactContent: string; strategy: ContextPacketStrategy } {
  switch (contentType) {
    case 'json':
      return {
        compactContent: compactJson(content, maxLines),
        strategy: 'json_outline',
      };
    case 'log':
      return {
        compactContent: compactLog(content, maxLines),
        strategy: 'log_focus',
      };
    case 'code':
      return {
        compactContent: compactCode(content, maxLines),
        strategy: 'code_outline',
      };
    case 'markdown':
      return {
        compactContent: compactText(content, maxLines, 'markdown_focus'),
        strategy: 'markdown_focus',
      };
    default:
      return {
        compactContent: compactText(content, maxLines, 'text_focus'),
        strategy: 'text_focus',
      };
  }
}

function toRecord(row: ContextPacketRow): ContextPacketRecord {
  const originalTokens = row.original_tokens ?? estimateTokens(row.original_content);
  const compactTokens = row.compact_tokens ?? estimateTokens(row.compact_content);
  const tokensSaved = Math.max(0, originalTokens - compactTokens);
  const savingsPercent = originalTokens > 0
    ? Math.round((tokensSaved / originalTokens) * 100)
    : 0;

  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    taskId: row.task_id,
    cycleId: row.cycle_id || null,
    sourceType: row.source_type as ContextPacketSourceType,
    sourceKey: row.source_key,
    title: row.title,
    contentType: row.content_type as ContextPacketContentType,
    strategy: row.strategy as ContextPacketStrategy,
    originalContent: row.original_content,
    compactContent: row.compact_content,
    originalTokens,
    compactTokens,
    savingsPercent,
    createdAt: row.created_at,
    lastAccessedAt: row.last_accessed_at,
  };
}

function upsertStoredPacket(input: {
  compactContent: string;
  compactTokens: number;
  contentHash: string;
  contentType: ContextPacketContentType;
  cycleId: string | null;
  originalContent: string;
  originalTokens: number;
  pipelineId: string;
  sourceKey: string;
  sourceType: ContextPacketSourceType;
  strategy: ContextPacketStrategy;
  taskId: string;
  title: string;
}): ContextPacketRecord {
  const db = getDb();
  const cycleId = input.cycleId ?? '';
  const existing = db.prepare(`
    SELECT *
    FROM context_packets
    WHERE pipeline_id = ?
      AND task_id = ?
      AND cycle_id = ?
      AND source_type = ?
      AND source_key = ?
      AND content_hash = ?
    LIMIT 1
  `).get(
    input.pipelineId,
    input.taskId,
    cycleId,
    input.sourceType,
    input.sourceKey,
    input.contentHash,
  ) as ContextPacketRow | undefined;

  const accessedAt = nowIso();

  if (existing) {
    db.prepare(`
      UPDATE context_packets
      SET last_accessed_at = ?,
          title = ?,
          compact_content = ?,
          compact_tokens = ?,
          strategy = ?,
          content_type = ?
      WHERE id = ?
    `).run(
      accessedAt,
      input.title,
      input.compactContent,
      input.compactTokens,
      input.strategy,
      input.contentType,
      existing.id,
    );
    return toRecord({
      ...existing,
      last_accessed_at: accessedAt,
      title: input.title,
      compact_content: input.compactContent,
      compact_tokens: input.compactTokens,
      strategy: input.strategy,
      content_type: input.contentType,
    });
  }

  const id = makePacketId([
    input.pipelineId,
    input.taskId,
    cycleId,
    input.sourceType,
    input.sourceKey,
    input.contentHash,
  ].join(':'));
  db.prepare(`
    INSERT INTO context_packets (
      id,
      pipeline_id,
      task_id,
      cycle_id,
      source_type,
      source_key,
      title,
      content_type,
      strategy,
      original_content,
      compact_content,
      content_hash,
      original_tokens,
      compact_tokens,
      created_at,
      last_accessed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.pipelineId,
    input.taskId,
    cycleId,
    input.sourceType,
    input.sourceKey,
    input.title,
    input.contentType,
    input.strategy,
    input.originalContent,
    input.compactContent,
    input.contentHash,
    input.originalTokens,
    input.compactTokens,
    accessedAt,
    accessedAt,
  );

  return {
    id,
    pipelineId: input.pipelineId,
    taskId: input.taskId,
    cycleId: input.cycleId ?? null,
    sourceType: input.sourceType,
    sourceKey: input.sourceKey,
    title: input.title,
    contentType: input.contentType,
    strategy: input.strategy,
    originalContent: input.originalContent,
    compactContent: input.compactContent,
    originalTokens: input.originalTokens,
    compactTokens: input.compactTokens,
    savingsPercent: input.originalTokens > 0
      ? Math.round(((input.originalTokens - input.compactTokens) / input.originalTokens) * 100)
      : 0,
    createdAt: accessedAt,
    lastAccessedAt: accessedAt,
  };
}

export function buildPromptContextBlock(input: CompactContextInput): PromptContextBlock {
  const content = input.content.trim();
  const passthroughRendered = `### ${input.title}\n${content}`;
  const originalTokens = estimateTokens(content);
  const contentType = detectContentType(content);
  const allowCompaction = input.allowCompaction ?? true;
  const minTokensToStore = input.minTokensToStore ?? DEFAULT_MIN_TOKENS_TO_STORE;
  const maxLines = input.maxLines ?? DEFAULT_MAX_LINES;
  const maxTokens = input.maxTokens ?? DEFAULT_MAX_TOKENS;

  if (!content) {
    return {
      compacted: false,
      compactTokens: 0,
      contentType,
      originalTokens: 0,
      packetId: null,
      rendered: `### ${input.title}\n`,
      savingsPercent: 0,
      strategy: 'passthrough',
    };
  }

  if (!allowCompaction || originalTokens < minTokensToStore) {
    return {
      compacted: false,
      compactTokens: originalTokens,
      contentType,
      originalTokens,
      packetId: null,
      rendered: passthroughRendered,
      savingsPercent: 0,
      strategy: 'passthrough',
    };
  }

  const { compactContent, strategy } = compressContent(content, contentType, maxLines);
  let boundedContent = compactContent.trim();

  if (estimateTokens(boundedContent) > maxTokens) {
    const lines = boundedContent.split(/\r?\n/);
    while (lines.length > 4 && estimateTokens(lines.join('\n')) > maxTokens) {
      lines.splice(Math.max(1, lines.length - 2), 1);
    }
    boundedContent = lines.join('\n').trim();
  }

  const compactTokens = estimateTokens(boundedContent);
  if (compactTokens >= originalTokens) {
    return {
      compacted: false,
      compactTokens: originalTokens,
      contentType,
      originalTokens,
      packetId: null,
      rendered: passthroughRendered,
      savingsPercent: 0,
      strategy: 'passthrough',
    };
  }

  const contentHash = hashContent(content);
  const previewPacketId = makePacketId([
    input.pipelineId,
    input.taskId,
    input.cycleId ?? '',
    input.sourceType,
    input.sourceKey,
    contentHash,
  ].join(':'));
  const packetPath = getContextPacketRelativePath(previewPacketId);
  const renderedCompacted = [
    `### ${input.title}`,
    `If you need the full source context, read \`${packetPath}\` in the task worktree.`,
    boundedContent,
  ].join('\n');
  const renderedCompactTokens = estimateTokens(renderedCompacted);
  const renderedPassthroughTokens = estimateTokens(passthroughRendered);

  if (renderedCompactTokens + MIN_RENDER_TOKEN_SAVINGS > renderedPassthroughTokens) {
    return {
      compacted: false,
      compactTokens: originalTokens,
      contentType,
      originalTokens,
      packetId: null,
      rendered: passthroughRendered,
      savingsPercent: 0,
      strategy: 'passthrough',
    };
  }

  const packet = upsertStoredPacket({
    compactContent: boundedContent,
    compactTokens,
    contentHash,
    contentType,
    cycleId: input.cycleId ?? null,
    originalContent: content,
    originalTokens,
    pipelineId: input.pipelineId,
    sourceKey: input.sourceKey,
    sourceType: input.sourceType,
    strategy,
    taskId: input.taskId,
    title: input.title,
  });

  const finalPacketPath = getContextPacketRelativePath(packet.id);
  const rendered = [
    `### ${input.title}`,
    `If you need the full source context, read \`${finalPacketPath}\` in the task worktree.`,
    boundedContent,
  ].join('\n');

  return {
    compacted: true,
    compactTokens: renderedCompactTokens,
    contentType,
    originalTokens,
    packetId: packet.id,
    rendered,
    savingsPercent: packet.savingsPercent,
    strategy,
  };
}

export function buildCycleSummary(input: {
  attemptNumber: number;
  output: string;
}): string {
  const content = input.output.trim();
  if (!content) {
    return `Latest completed attempt #${input.attemptNumber}`;
  }

  const contentType = detectContentType(content);
  const { compactContent } = compressContent(content, contentType, 12);
  const summaryBody = compactContent.trim();
  return `Latest completed attempt #${input.attemptNumber}\n${summaryBody}`;
}

export function getContextPacket(packetId: string): ContextPacketRecord {
  const db = getDb();
  const row = db.prepare('SELECT * FROM context_packets WHERE id = ?')
    .get(packetId) as ContextPacketRow | undefined;

  if (!row) {
    throw new AppError(404, 'Context packet not found');
  }

  const accessedAt = nowIso();
  db.prepare('UPDATE context_packets SET last_accessed_at = ? WHERE id = ?')
    .run(accessedAt, packetId);

  return toRecord({
    ...row,
    last_accessed_at: accessedAt,
  });
}

export function materializeContextPacketFiles(prompt: string, workingDir: string): string[] {
  const packetIds = Array.from(
    new Set(
      Array.from(prompt.matchAll(/\b(ctxpkt_[a-f0-9]+)\.md\b/g)).map((match) => match[1] ?? '')
    ),
  ).filter((packetId) => packetId.length > 0);

  if (packetIds.length === 0) return [];

  const db = getDb();
  const packetDir = join(workingDir, CONTEXT_PACKET_DIR);
  mkdirSync(packetDir, { recursive: true });

  const writtenPaths: string[] = [];

  for (const packetId of packetIds) {
    const row = db.prepare('SELECT * FROM context_packets WHERE id = ?')
      .get(packetId) as ContextPacketRow | undefined;
    if (!row) continue;

    const relativePath = getContextPacketRelativePath(packetId);
    const absolutePath = join(workingDir, relativePath);
    const fileContent = [
      `# Context Packet ${packetId}`,
      '',
      `- Title: ${row.title}`,
      `- Source Type: ${row.source_type}`,
      `- Source Key: ${row.source_key}`,
      `- Content Type: ${row.content_type}`,
      `- Strategy: ${row.strategy}`,
      `- Original Tokens: ${row.original_tokens}`,
      `- Compact Tokens: ${row.compact_tokens}`,
      '',
      '## Original Content',
      row.original_content,
      '',
    ].join('\n');

    writeFileSync(absolutePath, fileContent, 'utf-8');
    db.prepare('UPDATE context_packets SET last_accessed_at = ? WHERE id = ?')
      .run(nowIso(), packetId);
    writtenPaths.push(relativePath);
  }

  return writtenPaths;
}
