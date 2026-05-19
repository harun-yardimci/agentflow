import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ConversationBlock, ParsedStream } from '@/lib/claude-stream-parser';
import { parseClaudeStream } from '@/lib/claude-stream-parser';

/* ─── Helpers ─── */

const MAX_RESULT_PREVIEW = 300;
const MAX_TOOL_INPUT_PREVIEW = 500;

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function toolIcon(toolName: string): string {
  const name = toolName.toLowerCase();
  if (name === 'edit' || name === 'edit_file') return 'pencil';
  if (name === 'write' || name === 'write_file') return 'plus';
  if (name === 'read' || name === 'read_file') return 'eye';
  if (name === 'bash' || name === 'execute' || name === 'shell' || name === 'execute_command') return 'terminal';
  if (name === 'glob' || name === 'grep' || name === 'search' || name === 'grep_search' || name === 'find_files' || name === 'list_directory') return 'search';
  if (name === 'agent') return 'cpu';
  return 'tool';
}

function ToolIconSvg({ icon }: { icon: string }) {
  const cls = 'w-3 h-3 shrink-0';
  switch (icon) {
    case 'pencil':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'plus':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      );
    case 'eye':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      );
    case 'terminal':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <polyline points="4 17 10 11 4 5" strokeLinecap="round" strokeLinejoin="round" />
          <line strokeLinecap="round" x1="12" x2="20" y1="19" y2="19" />
        </svg>
      );
    case 'search':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" />
          <line strokeLinecap="round" x1="21" x2="16.65" y1="21" y2="16.65" />
        </svg>
      );
    case 'cpu':
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <rect height="16" rx="2" width="16" x="4" y="4" />
          <rect height="6" rx="1" width="6" x="9" y="9" />
          <line x1="9" x2="9" y1="1" y2="4" /><line x1="15" x2="15" y1="1" y2="4" />
          <line x1="9" x2="9" y1="20" y2="23" /><line x1="15" x2="15" y1="20" y2="23" />
          <line x1="20" x2="23" y1="9" y2="9" /><line x1="20" x2="23" y1="14" y2="14" />
          <line x1="1" x2="4" y1="9" y2="9" /><line x1="1" x2="4" y1="14" y2="14" />
        </svg>
      );
    default:
      return (
        <svg className={cls} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </svg>
      );
  }
}

/* ─── Spawn Tasks ─── */

interface SpawnItem {
  name: string;
  agentId: string;
  model?: string;
  approval?: string;
  input: string;
  priority?: string;
}

const SPAWN_RE = /<!-- SPAWN_TASKS\s*([\s\S]*?)\s*SPAWN_TASKS -->/;

function parseSpawnJson(block: string): SpawnItem[] | null {
  try {
    const parsed = JSON.parse(block);
    return Array.isArray(parsed) ? parsed as SpawnItem[] : null;
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

    try {
      const parsed = JSON.parse(repaired);
      return Array.isArray(parsed) ? parsed as SpawnItem[] : null;
    } catch {
      return null;
    }
  }
}

export function parseSpawnBlock(text: string): { items: SpawnItem[]; rest: string } | null {
  const match = SPAWN_RE.exec(text);
  if (!match?.[1]) return null;

  const raw = parseSpawnJson(match[1]);
  if (!raw) return null;

  const items = raw.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];

    const entry = item as Record<string, unknown>;
    if (typeof entry.name !== 'string' || typeof entry.agentId !== 'string' || typeof entry.input !== 'string') {
      return [];
    }

    const normalized: SpawnItem = {
      name: entry.name.trim(),
      agentId: entry.agentId.trim(),
      input: entry.input.trim(),
    };

    if (typeof entry.model === 'string' && entry.model.trim()) {
      normalized.model = entry.model.trim();
    }
    if (typeof entry.approval === 'string' && entry.approval.trim()) {
      normalized.approval = entry.approval.trim();
    }
    if (typeof entry.priority === 'string' && entry.priority.trim()) {
      normalized.priority = entry.priority.trim();
    }

    return normalized.name && normalized.agentId && normalized.input
      ? [normalized]
      : [];
  });
  if (items.length === 0) return null;

  return { items, rest: text.replace(SPAWN_RE, '').trim() };
}

const priorityColors: Record<string, string> = {
  urgent: 'text-accent-red',
  high: 'text-accent-orange',
  medium: 'text-accent-yellow',
  low: 'text-text-dim',
};

export function SpawnTasksView({ items }: { items: SpawnItem[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded border border-accent-orange/30 bg-accent-orange/5">
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2/50"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <span className="font-mono text-[10px] font-semibold text-accent-orange">SPAWN</span>
        <span className="font-mono text-[10px] text-text-secondary">
          {items.length} follow-up task{items.length > 1 ? 's' : ''}
        </span>
        <span className="ml-auto font-mono text-[9px] text-text-dim">
          {expanded ? '[-]' : '[+]'}
        </span>
      </button>
      {expanded && (
        <div className="space-y-1.5 border-t border-accent-orange/20 px-3 py-2">
          {items.map((item, i) => (
            <div key={i} className="rounded bg-surface-0/50 px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] font-semibold text-text-primary">
                  {item.name}
                </span>
                {item.priority && (
                  <span className={`font-mono text-[9px] ${priorityColors[item.priority] ?? 'text-text-dim'}`}>
                    {item.priority}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-2 font-mono text-[9px] text-text-dim">
                <span>{item.agentId}</span>
                {item.model && <span>{item.model}</span>}
                {item.approval && <span>{item.approval}</span>}
              </div>
              <p className="mt-1 line-clamp-2 text-[10px] leading-4 text-text-secondary">
                {item.input}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Block Renderers ─── */

function TextBlockView({ content }: { content: string }) {
  const spawn = useMemo(() => parseSpawnBlock(content), [content]);

  return (
    <>
      {spawn?.rest && (
        <div className="prose-invert prose-xs max-w-none text-[11px] leading-5 text-text-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{spawn.rest}</ReactMarkdown>
        </div>
      )}
      {spawn && <SpawnTasksView items={spawn.items} />}
      {!spawn && (
        <div className="prose-invert prose-xs max-w-none text-[11px] leading-5 text-text-primary">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      )}
    </>
  );
}

export function ToolUseBlockView({
  toolName,
  summary,
  input,
  result,
}: {
  toolName: string;
  summary?: string;
  input: Record<string, unknown>;
  result?: ConversationBlock;
}) {
  const [expanded, setExpanded] = useState(false);
  const icon = toolIcon(toolName);
  const isError = result?.type === 'tool_result' && result.isError;
  const resultText = result?.type === 'tool_result' ? result.content : undefined;

  // Build display label
  const label = summary ?? toolName;

  return (
    <div className="group rounded border border-border-secondary bg-surface-0/50">
      {/* Header */}
      <button
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-surface-2/50"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <ToolIconSvg icon={icon} />
        <span className="font-mono text-[10px] font-semibold text-accent-orange">
          {toolName}
        </span>
        {summary && (
          <span className="truncate font-mono text-[10px] text-text-dim">
            {summary}
          </span>
        )}
        <span className="ml-auto font-mono text-[9px] text-text-dim">
          {expanded ? '[-]' : '[+]'}
        </span>
        {isError && (
          <span className="text-[9px] font-semibold text-accent-red">ERR</span>
        )}
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="space-y-1 border-t border-border-secondary px-2.5 py-2">
          {/* Tool input */}
          <div>
            <p className="font-mono text-[9px] font-semibold uppercase tracking-wider text-text-dim">
              Input
            </p>
            <pre className="mt-0.5 max-h-[200px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 text-text-secondary">
              {truncate(formatToolInput(toolName, input), MAX_TOOL_INPUT_PREVIEW)}
            </pre>
          </div>

          {/* Tool result */}
          {resultText && (
            <div>
              <p className={`font-mono text-[9px] font-semibold uppercase tracking-wider ${isError ? 'text-accent-red' : 'text-text-dim'}`}>
                {isError ? 'Error' : 'Result'}
              </p>
              <pre className={`mt-0.5 max-h-[200px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 ${isError ? 'text-accent-red/80' : 'text-text-dim'}`}>
                {truncate(resultText, MAX_RESULT_PREVIEW)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ToolResultBlockView({
  toolId,
  content,
  isError,
}: {
  toolId: string;
  content: string;
  isError?: boolean;
}) {
  return (
    <div className="rounded border border-border-secondary bg-surface-0/50 px-2.5 py-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] font-semibold text-text-secondary">
          Tool result
        </span>
        {toolId && (
          <span className="truncate font-mono text-[10px] text-text-dim">
            {toolId}
          </span>
        )}
        {isError && (
          <span className="ml-auto text-[9px] font-semibold text-accent-red">
            ERR
          </span>
        )}
      </div>
      <pre
        className={`mt-1 max-h-[200px] overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4 ${
          isError ? 'text-accent-red/80' : 'text-text-dim'
        }`}
      >
        {truncate(content, MAX_RESULT_PREVIEW)}
      </pre>
    </div>
  );
}

/**
 * Format tool input for display — show relevant fields, not raw JSON.
 */
function formatToolInput(toolName: string, input: Record<string, unknown>): string {
  const name = toolName.toLowerCase();

  if (name === 'edit' || name === 'edit_file') {
    const parts: string[] = [];
    if (input.file_path) parts.push(`file: ${input.file_path}`);
    if (input.old_string) parts.push(`old:\n${input.old_string}`);
    if (input.new_string) parts.push(`new:\n${input.new_string}`);
    if (parts.length) return parts.join('\n\n');
  }

  if (name === 'bash' || name === 'execute' || name === 'execute_command') {
    const cmd = input.command ?? input.cmd;
    if (typeof cmd === 'string') return `$ ${cmd}`;
  }

  if (name === 'read' || name === 'read_file') {
    const fp = input.file_path ?? input.path;
    if (fp) return `${fp}`;
  }

  if (name === 'write' || name === 'write_file') {
    const parts: string[] = [];
    if (input.file_path) parts.push(`file: ${input.file_path}`);
    if (typeof input.content === 'string') {
      parts.push(input.content.slice(0, 300) + (input.content.length > 300 ? '...' : ''));
    }
    if (parts.length) return parts.join('\n\n');
  }

  if (name === 'grep_search' || name === 'find_files') {
    const pat = input.pattern ?? input.query;
    if (typeof pat === 'string') return pat;
  }

  if (name === 'list_directory' || name === 'list_dir') {
    const fp = input.dir_path ?? input.path;
    if (fp) return `${fp}`;
  }

  // Fallback: JSON
  return JSON.stringify(input, null, 2);
}

/* ─── Main Component ─── */

interface ConversationViewProps {
  /** Raw stdout from Claude CLI */
  rawOutput: string;
  /** Whether the task is still running */
  isLive?: boolean;
  /** Max height in pixels (undefined = no limit) */
  maxHeight?: number;
}

export function ConversationView({ rawOutput, isLive, maxHeight }: ConversationViewProps) {
  const parsed: ParsedStream = useMemo(
    () => parseClaudeStream(rawOutput),
    [rawOutput]
  );

  if (!parsed.isClaudeStream) return null;

  // Pair tool_use blocks with their tool_result
  const toolResults = new Map<string, ConversationBlock>();
  const toolUseIds = new Set<string>();
  for (const block of parsed.blocks) {
    if (block.type === 'tool_use') {
      toolUseIds.add(block.toolId);
    }
    if (block.type === 'tool_result') {
      toolResults.set(block.toolId, block);
    }
  }

  return (
    <div
      className="space-y-2 overflow-auto"
      style={maxHeight != null ? { maxHeight } : undefined}
    >
      {parsed.blocks.map((block, i) => {
        if (block.type === 'text') {
          return <TextBlockView content={block.content} key={`t-${i}`} />;
        }
        if (block.type === 'tool_use') {
          return (
            <ToolUseBlockView
              input={block.input}
              key={`u-${i}`}
              result={toolResults.get(block.toolId)}
              summary={block.summary}
              toolName={block.toolName}
            />
          );
        }
        if (block.type === 'tool_result' && !toolUseIds.has(block.toolId)) {
          return (
            <ToolResultBlockView
              content={block.content}
              isError={block.isError}
              key={`r-${i}`}
              toolId={block.toolId}
            />
          );
        }
        return null;
      })}

      {isLive && (
        <span className="inline-block animate-pulse font-mono text-xs text-accent-blue">_</span>
      )}
    </div>
  );
}
