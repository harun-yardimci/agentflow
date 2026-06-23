import type { TaskStatus } from '@/types';
import { STATUS_COLOR } from '@/constants';
import { cn } from '@/lib/utils';

export type ExtendedStatus = TaskStatus | 'failed' | 'pending' | 'approved' | 'rejected';

interface StatusPillProps {
  status: ExtendedStatus;
}

export function StatusPill({ status }: StatusPillProps) {
  const styles: Record<ExtendedStatus, { label: string; color: string; bg: string; border: string }> = {
    queued: { label: 'queued', color: '#9CA3AF', bg: '#171717', border: '#2B2B2B' },
    running: { label: 'running', color: '#2563EB', bg: '#0A1628', border: '#1D4ED8' },
    completed: { label: 'completed', color: '#16A34A', bg: '#0A1A11', border: '#15803D' },
    blocked: { label: 'blocked', color: '#DC2626', bg: '#230C0C', border: '#B91C1C' },
    awaiting_approval: { label: 'pending', color: '#D97706', bg: '#261905', border: '#D97706' },
    failed: { label: 'failed', color: '#EF4444', bg: '#230C0C', border: '#B91C1C' },
    rejected: { label: 'rejected', color: '#F97316', bg: '#230C0C', border: '#B91C1C' },
    paused: { label: 'paused', color: '#F59E0B', bg: '#261905', border: '#D97706' },
    skipped: { label: 'skipped', color: '#64748B', bg: '#111318', border: '#334155' },
    rate_limited: { label: 'rate limit', color: '#06B6D4', bg: '#081A1E', border: '#0891B2' },
    auth_required: { label: 'auth', color: '#A855F7', bg: '#160B1F', border: '#7E22CE' },
    pending: { label: 'pending', color: '#D97706', bg: '#261905', border: '#D97706' },
    approved: { label: 'approved', color: '#16A34A', bg: '#0A1A11', border: '#15803D' },
  };
  const config = styles[status];
  const dotColor = STATUS_COLOR[(status as TaskStatus)] ?? config.color;

  return (
    <span
      className="inline-flex items-center gap-1 rounded border px-1.5 py-[3px] font-mono text-[10px] leading-none whitespace-nowrap"
      style={{ color: config.color, backgroundColor: config.bg, borderColor: config.border }}
    >
      <span
        data-testid="status-pill-dot"
        className={cn(
          'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
          status === 'running' && 'animate-blink',
        )}
        style={{ backgroundColor: dotColor }}
      />
      {config.label}
    </span>
  );
}
