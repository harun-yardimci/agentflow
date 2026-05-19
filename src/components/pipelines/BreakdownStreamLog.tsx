import { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface BreakdownStreamLogProps {
  chunks: string[];
  isStreaming: boolean;
  error: string | null;
}

export function BreakdownStreamLog({ chunks, isStreaming, error }: BreakdownStreamLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as new chunks arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chunks.length]);

  if (chunks.length === 0 && !isStreaming && !error) return null;

  return (
    <div className="mt-3 rounded border border-border-secondary bg-surface-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border-secondary px-3 py-1.5">
        {isStreaming && (
          <span className="h-1.5 w-1.5 rounded-full bg-accent-green animate-pulse" />
        )}
        {!isStreaming && !error && chunks.length > 0 && (
          <span className="h-1.5 w-1.5 rounded-full bg-accent-green" />
        )}
        {error && (
          <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        )}
        <span className="font-mono text-[10px] uppercase tracking-widest text-text-muted">
          {isStreaming ? 'Agent Output' : error ? 'Error' : 'Completed'}
        </span>
        {isStreaming && (
          <span className="ml-auto font-mono text-[10px] text-text-dim">
            streaming...
          </span>
        )}
      </div>

      {/* Log content */}
      <div
        ref={scrollRef}
        className={cn(
          'max-h-[200px] overflow-y-auto p-3 font-mono text-[10px] leading-relaxed whitespace-pre-wrap break-all',
          error ? 'text-red-400' : 'text-text-dim',
        )}
      >
        {error ? error : chunks.map((chunk, i) => {
          const isDiag = chunk.startsWith('[claude') || chunk.startsWith('[cli') || chunk.startsWith('[breakdown]');
          return (
            <span key={i} className={isDiag ? 'text-text-dim opacity-60' : 'text-text-secondary'}>
              {chunk}
            </span>
          );
        })}
        {isStreaming && (
          <span className="inline-block w-1.5 h-3.5 bg-accent-orange ml-0.5 animate-blink" />
        )}
      </div>
    </div>
  );
}
