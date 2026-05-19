import type { PageId } from '@/types';
import { Badge, Button, StatusDot } from '@/components/ui';
import { cn } from '@/lib/utils';

interface TopBarProps {
  page: PageId;
  setPage: (page: PageId) => void;
  pendingCount: number;
}

const NAV_ITEMS: { id: PageId; label: string; shortLabel: string }[] = [
  { id: 'pipelines', label: 'Pipelines', shortLabel: 'Pipelines' },
  { id: 'agents', label: 'Crew', shortLabel: 'Crew' },
  { id: 'models', label: 'Model Config', shortLabel: 'Models' },
  { id: 'settings', label: 'Settings', shortLabel: 'Settings' },
];

export function TopBar({ page, setPage, pendingCount }: TopBarProps) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border-primary bg-surface-0 px-3 sm:px-4">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="flex h-7 w-7 items-center justify-center rounded-md bg-accent-orange text-[10px] font-bold text-black"
        >
          ■
        </span>
        <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-text-primary uppercase">
          AgentFlow
        </span>
      </div>

      <nav aria-label="Main navigation" className="min-w-0 flex-1 overflow-x-auto">
        <ul className="flex min-w-max items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = page === item.id;

            return (
              <li key={item.id}>
                <Button
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'h-8 px-2.5 text-[11px] sm:px-3',
                    isActive && 'border-border-hover bg-surface-3 text-text-primary',
                  )}
                  onClick={() => setPage(item.id)}
                  size="sm"
                  variant={isActive ? 'secondary' : 'ghost'}
                >
                  <span className="hidden sm:inline">{item.label}</span>
                  <span className="sm:hidden">{item.shortLabel}</span>
                  {item.id === 'pipelines' && pendingCount > 0 && (
                    <Badge size="sm" tone="warning">
                      {pendingCount}
                    </Badge>
                  )}
                </Button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="ml-auto flex items-center gap-2">
        {pendingCount > 0 && (
          <Badge className="hidden sm:inline-flex" tone="warning">
            {pendingCount} pending
          </Badge>
        )}
        <span className="inline-flex items-center gap-1 font-mono text-[10px] text-accent-green">
          <StatusDot size="sm" tone="success" />
          online
        </span>
      </div>
    </header>
  );
}
