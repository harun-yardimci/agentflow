import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createAvatar } from '@dicebear/core';
import { bottts } from '@dicebear/collection';
import { cn } from '@/lib/utils';

interface CrewAvatarProps {
  className?: string;
  name?: string;
  onClick?: () => void;
  seed: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  title?: string;
}

const SIZE_MAP: Record<string, number> = {
  xs: 20,
  sm: 28,
  md: 40,
  lg: 56,
};

const SIZE_CLASSES: Record<string, string> = {
  xs: 'h-5 w-5',
  sm: 'h-7 w-7',
  md: 'h-10 w-10',
  lg: 'h-14 w-14',
};

interface TooltipPos {
  x: number;
  y: number;
}

export function CrewAvatar({ className, name, onClick, seed, size = 'md', title }: CrewAvatarProps) {
  const [tooltipPos, setTooltipPos] = useState<TooltipPos | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const svgDataUri = useMemo(() => {
    if (!seed) return '';
    const avatar = createAvatar(bottts, {
      seed,
      size: SIZE_MAP[size] ?? 40,
      backgroundColor: ['1a1a2e', '16213e', '0f3460', '1b1b2f', '162447'],
      backgroundType: ['solid'],
    });
    return avatar.toDataUri();
  }, [seed, size]);

  const hasTooltip = !!(name || title);
  const isClickable = !!onClick;

  const handleMouseEnter = useCallback(() => {
    if (!hasTooltip || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setTooltipPos({
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, [hasTooltip]);

  const handleMouseLeave = useCallback(() => {
    setTooltipPos(null);
  }, []);

  if (!seed) {
    return (
      <div
        className={cn(
          'flex items-center justify-center rounded-full bg-surface-3 text-text-muted',
          SIZE_CLASSES[size],
          className,
        )}
      >
        ?
      </div>
    );
  }

  const img = (
    <img
      alt={`${name || seed} avatar`}
      className={cn(
        'rounded-full',
        SIZE_CLASSES[size],
        isClickable && 'cursor-pointer transition-opacity hover:opacity-80',
        className,
      )}
      src={svgDataUri}
    />
  );

  if (!hasTooltip && !isClickable) {
    return img;
  }

  return (
    <span
      ref={anchorRef}
      className="relative inline-flex"
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={isClickable ? (e) => { if (e.key === 'Enter') onClick?.(); } : undefined}
    >
      {img}
      {hasTooltip && tooltipPos && createPortal(
        <span
          className={cn(
            'pointer-events-none fixed z-[2147483647]',
            'whitespace-nowrap rounded-md border border-border-hover bg-surface-1 px-2.5 py-1.5',
            'shadow-2xl shadow-black/60 ring-1 ring-white/5',
          )}
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y,
            transform: 'translate(-50%, -100%) translateY(-6px)',
          }}
        >
          {name && (
            <span className="block font-mono text-[10px] font-semibold text-text-primary">
              {name}
            </span>
          )}
          {title && (
            <span className="block font-mono text-[9px] text-accent-orange">
              {title}
            </span>
          )}
        </span>,
        document.body,
      )}
    </span>
  );
}
