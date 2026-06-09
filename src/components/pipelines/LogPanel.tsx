import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { LogEntry, LogType } from '@/types';
import { Badge, Button, Input } from '@/components/ui';
import { cn } from '@/lib/utils';

interface LogPanelProps {
  logs: LogEntry[];
  onClose: () => void;
}

type LogFilter = 'all' | LogType;

const LOG_FILTERS: { label: string; value: LogFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Info', value: 'info' },
  { label: 'Success', value: 'success' },
  { label: 'Warning', value: 'warning' },
  { label: 'Error', value: 'error' },
  { label: 'Model', value: 'model' },
];

const TYPE_TONE: Record<LogType, 'accent' | 'error' | 'info' | 'success' | 'warning'> = {
  error: 'error',
  info: 'info',
  model: 'accent',
  success: 'success',
  warning: 'warning',
};

const ROW_STYLE: Record<LogType, string> = {
  error: 'border-l-accent-red/70 bg-accent-red-bg/40',
  info: 'border-l-accent-blue/60 bg-surface-1',
  model: 'border-l-accent-orange/70 bg-accent-orange-bg/30',
  success: 'border-l-accent-green/70 bg-accent-green-bg/35',
  warning: 'border-l-accent-amber/70 bg-accent-amber-bg/35',
};

const PAGE_SIZE = 100;

function formatLogDateTime(time: string): { date: string; time: string } {
  const parsed = new Date(time);
  if (!Number.isNaN(parsed.getTime())) {
    return {
      date: parsed.toLocaleDateString([], { month: 'short', day: 'numeric' }),
      time: parsed.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };
  }

  const hhmmss = time.match(/\d{2}:\d{2}:\d{2}/);
  return { date: '', time: hhmmss?.[0] ?? time };
}

function splitHighlightedTokens(message: string): string[] {
  return message.split(/(Claude|Gemini|Codex|Antigravity|claude|gemini|codex|antigravity|\d+[\d,]*(?:\.\d+)?\s*(?:tokens?|ms|s|m))/g);
}

function messageTokenClass(token: string): string {
  const normalized = token.toLowerCase();

  if (normalized.includes('claude')) {
    return 'text-model-claude';
  }
  if (normalized.includes('gemini')) {
    return 'text-model-gemini';
  }
  if (normalized.includes('codex')) {
    return 'text-model-codex';
  }
  if (normalized.includes('antigravity')) {
    return 'text-model-antigravity';
  }

  if (/\d/.test(token)) {
    return 'text-text-primary';
  }

  return 'text-text-secondary';
}

export function LogPanel({ logs, onClose }: LogPanelProps): JSX.Element {
  const [filter, setFilter] = useState<LogFilter>('all');
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevLogCountRef = useRef(0);

  const filteredLogs = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return logs.filter((log) => {
      if (filter !== 'all' && log.type !== filter) {
        return false;
      }

      if (normalizedQuery.length === 0) {
        return true;
      }

      const searchable = `${log.time} ${log.type} ${log.msg}`.toLowerCase();
      return searchable.includes(normalizedQuery);
    });
  }, [filter, logs, query]);

  // Show last PAGE_SIZE logs by default (newest at bottom)
  const displayedLogs = useMemo(() => {
    const total = filteredLogs.length;
    if (total <= visibleCount) return filteredLogs;
    return filteredLogs.slice(total - visibleCount);
  }, [filteredLogs, visibleCount]);

  const hasMore = filteredLogs.length > visibleCount;

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logs.length > prevLogCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevLogCountRef.current = logs.length;
  }, [logs.length]);

  // Initial scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // Reset visible count when filter/query changes
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filter, query]);

  const handleLoadMore = () => {
    setVisibleCount((prev) => prev + PAGE_SIZE);
  };

  return (
    <div className="animate-fade-in shrink-0 border-t border-border-primary bg-surface-0">
      <div className="flex flex-col gap-2 border-b border-border-subtle px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold tracking-wider text-text-primary uppercase">
              Activity Log
            </span>
            <Badge size="sm" tone="neutral">
              {displayedLogs.length}/{filteredLogs.length}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-1">
            {LOG_FILTERS.map((item) => (
              <Button
                className="h-6 px-2 text-[10px]"
                key={item.value}
                onClick={() => setFilter(item.value)}
                size="sm"
                variant={filter === item.value ? 'primary' : 'ghost'}
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Input
            className="w-full lg:w-56"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search logs"
            size="sm"
            value={query}
          />
          <Button
            onClick={() => {
              setFilter('all');
              setQuery('');
            }}
            size="sm"
            variant="ghost"
          >
            Clear
          </Button>
          <Button onClick={onClose} size="sm" variant="ghost">
            Hide
          </Button>
        </div>
      </div>

      <div className="max-h-[280px] overflow-y-auto px-4 py-3" ref={scrollRef}>
        {filteredLogs.length === 0 ? (
          <div className="rounded-md border border-dashed border-border-secondary bg-surface-1/50 px-4 py-6 text-center">
            <p className="font-mono text-xs text-text-secondary">No logs match the current filter.</p>
          </div>
        ) : (
          <div className="space-y-1.5 font-mono text-[11px]">
            {hasMore && (
              <div className="mb-2 flex justify-center">
                <Button
                  className="h-7 px-3 text-[10px]"
                  onClick={handleLoadMore}
                  size="sm"
                  variant="ghost"
                >
                  Load {Math.min(PAGE_SIZE, filteredLogs.length - visibleCount)} more logs
                </Button>
              </div>
            )}
            {displayedLogs.map((log) => {
              const dt = formatLogDateTime(log.time);
              return (
                <div
                  className={cn(
                    'flex items-start gap-2 rounded-md border border-border-subtle border-l-2 px-2.5 py-2',
                    ROW_STYLE[log.type],
                  )}
                  key={log.id}
                >
                  <div className="w-[100px] shrink-0 text-[10px] text-text-muted">
                    {dt.date && <span className="mr-1.5 text-text-dim">{dt.date}</span>}
                    <span>{dt.time}</span>
                  </div>

                  <Badge size="sm" tone={TYPE_TONE[log.type]}>
                    {log.type.toUpperCase()}
                  </Badge>

                  <p className="min-w-0 flex-1 break-words text-[11px] leading-relaxed text-text-secondary">
                    {splitHighlightedTokens(log.msg).map((token, index) => {
                      const isKnownToken = token.length > 0
                        && (token.includes('Claude')
                          || token.includes('Gemini')
                          || token.includes('Codex')
                          || /\d/.test(token));

                      if (!isKnownToken) {
                        return <span key={`${log.id}-${index}`}>{token}</span>;
                      }

                      return (
                        <span className={messageTokenClass(token)} key={`${log.id}-${index}`}>
                          {token}
                        </span>
                      );
                    })}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
