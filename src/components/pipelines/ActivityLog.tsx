import { useMemo, useState, type JSX } from 'react';

import { Badge, Input } from '../ui';

export interface ActivityLogEntry {
  id: string;
  message: string;
  model?: string;
  status: string;
  timestamp: string;
}

interface ActivityLogProps {
  entries: ActivityLogEntry[];
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function ActivityLog({ entries }: ActivityLogProps): JSX.Element {
  const [query, setQuery] = useState('');

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return entries;
    }

    return entries.filter((entry) => {
      const haystack = [
        entry.message,
        entry.model ?? '',
        entry.status,
        entry.timestamp,
      ].join(' ').toLowerCase();

      return haystack.includes(normalizedQuery);
    });
  }, [entries, query]);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-text-primary">
          Activity Timeline
        </h3>
        <p className="text-xs text-text-secondary">
          Searchable execution history across recent runs and handoffs.
        </p>
      </div>

      <Input
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search runs"
        value={query}
      />

      {filteredEntries.length === 0 ? (
        <div className="rounded-md border border-border-secondary bg-surface-1 px-3 py-4">
          <p className="text-xs text-text-dim">No timeline entries</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredEntries.map((entry) => (
            <div
              className="flex items-start justify-between gap-3 rounded-md border border-border-secondary bg-surface-1 px-3 py-2"
              key={entry.id}
            >
              <div className="min-w-0 space-y-1">
                <p className="text-xs text-text-primary">{entry.message}</p>
                <div className="flex flex-wrap items-center gap-2 text-micro text-text-dim">
                  <span>{formatTimestamp(entry.timestamp)}</span>
                  {entry.model && <span>{entry.model}</span>}
                </div>
              </div>
              <Badge size="sm" tone="neutral">
                {entry.status.replace(/_/g, ' ')}
              </Badge>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
