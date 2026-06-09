import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import type { ModelKey } from '@/types';
import { EMOJI_OPTIONS } from '@/constants';
import { useAgents } from '@/context/AgentContext';
import { usePipelines } from '@/context/PipelineContext';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Skeleton,
} from '@/components/ui';
import { ConfirmDialog } from '@/components/atoms/ConfirmDialog';
import { cn, toErrorMessage } from '@/lib/utils';
import { AgentCard, type AgentMetrics } from './AgentCard';
import { AgentEditModal } from './AgentEditModal';

type AgentFilter = 'all' | 'active' | 'idle' | ModelKey;

const AGENT_FILTERS: { label: string; value: AgentFilter }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Idle', value: 'idle' },
  { label: 'Claude', value: 'claude' },
  { label: 'Gemini', value: 'gemini' },
  { label: 'Codex', value: 'codex' },
  { label: 'Antigravity', value: 'antigravity' },
];

function emptyMetrics(): AgentMetrics {
  return {
    activeTaskCount: 0,
    completedTaskCount: 0,
    failedTaskCount: 0,
    totalTaskCount: 0,
  };
}

function statCard(title: string, value: string, hint?: string): JSX.Element {
  return (
    <Card variant="status-bordered">
      <CardBody className="space-y-1">
        <p className="font-mono text-[10px] uppercase tracking-wider text-text-muted">{title}</p>
        <p className="font-mono text-xl font-semibold text-text-primary">{value}</p>
        {hint && <p className="text-[11px] text-text-secondary">{hint}</p>}
      </CardBody>
    </Card>
  );
}

function AgentsPageSkeleton(): JSX.Element {
  return (
    <div className="flex flex-1 overflow-y-auto bg-surface-0">
      <div className="mx-auto w-full max-w-[1380px] space-y-5 p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-7 w-52" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-9 w-full md:w-64" />
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Card key={index}>
              <CardBody className="space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-3 w-28" />
              </CardBody>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-36" />
          </CardHeader>
          <CardBody className="space-y-3">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton className="h-14 w-full" key={index} />
            ))}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export function AgentsPage(): JSX.Element {
  const { agents, loading, updateAgent, addAgent, deleteAgent } = useAgents();
  const { pipelines } = usePipelines();

  const [filter, setFilter] = useState<AgentFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; tone: 'error' | 'success' } | null>(
    null,
  );
  const prevAgentIdsRef = useRef<Set<string> | null>(null); // null = uninitialized

  const metricsByAgentId = useMemo(() => {
    const result = new Map<string, AgentMetrics>();

    for (const agent of agents) {
      result.set(agent.id, emptyMetrics());
    }

    for (const pipeline of pipelines) {
      for (const task of pipeline.tasks) {
        const current = result.get(task.agentId) ?? emptyMetrics();
        current.totalTaskCount += 1;

        if (task.status === 'running' || task.status === 'awaiting_approval') {
          current.activeTaskCount += 1;
        }

        if (task.status === 'completed') {
          current.completedTaskCount += 1;
        }

        if (
          task.status === 'blocked'
          || task.status === 'failed'
          || task.status === 'rejected'
        ) {
          current.failedTaskCount += 1;
        }

        result.set(task.agentId, current);
      }
    }

    return result;
  }, [agents, pipelines]);

  const stats = useMemo(() => {
    let activeNow = 0;
    let completedTotal = 0;
    let errorTotal = 0;
    let taskTotal = 0;

    for (const agent of agents) {
      const metrics = metricsByAgentId.get(agent.id) ?? emptyMetrics();
      if (metrics.activeTaskCount > 0) {
        activeNow += 1;
      }
      completedTotal += metrics.completedTaskCount;
      errorTotal += metrics.failedTaskCount;
      taskTotal += metrics.totalTaskCount;
    }

    const errorRate = taskTotal > 0 ? (errorTotal / taskTotal) * 100 : 0;

    return {
      activeNow,
      completedTotal,
      errorRate,
      taskTotal,
      totalAgents: agents.length,
    };
  }, [agents, metricsByAgentId]);

  const filteredAgents = useMemo(() => {
    const searchLower = search.trim().toLowerCase();

    return agents.filter((agent) => {
      if (searchLower.length > 0) {
        const searchable = `${agent.name} ${agent.id} ${agent.prompt}`.toLowerCase();
        if (!searchable.includes(searchLower)) {
          return false;
        }
      }

      if (filter === 'all') {
        return true;
      }

      const metrics = metricsByAgentId.get(agent.id) ?? emptyMetrics();
      if (filter === 'active') {
        return metrics.activeTaskCount > 0;
      }
      if (filter === 'idle') {
        return metrics.activeTaskCount === 0;
      }
      return agent.defaultModel === filter;
    });
  }, [agents, filter, metricsByAgentId, search]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedId) ?? null,
    [agents, selectedId],
  );

  useEffect(() => {
    const currentIds = new Set(agents.map((a) => a.id));
    // Skip initial load — only auto-select when a NEW agent is added
    if (prevAgentIdsRef.current === null) {
      prevAgentIdsRef.current = currentIds;
      return;
    }
    // Find the newly added agent by diffing IDs
    const newAgent = agents.find((a) => !prevAgentIdsRef.current!.has(a.id));
    if (newAgent) {
      setSelectedId(newAgent.id);
    }
    prevAgentIdsRef.current = currentIds;
  }, [agents]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 3000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  if (loading) {
    return <AgentsPageSkeleton />;
  }

  const handleCreate = async () => {
    setCreating(true);
    setNotice(null);

    try {
      const emojiIndex = agents.length % EMOJI_OPTIONS.length;
      const icon = EMOJI_OPTIONS[emojiIndex] ?? '🤖';

      const newName = `Crew-${agents.length + 1}`;
      const created = await addAgent({
        defaultModel: 'claude',
        icon,
        title: '',
        avatarSeed: newName,
        name: newName,
        prompt: 'You are an AI assistant. Define role, constraints, and output format.',
      });

      setSelectedId(created.id);
      setNotice({ message: 'Crew member created.', tone: 'success' });
    } catch (error) {
      setNotice({ message: toErrorMessage(error), tone: 'error' });
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async (id: string, draft: { defaultModel: ModelKey; icon: string; title: string; avatarSeed: string; name: string; prompt: string }) => {
    setSaving(true);
    setNotice(null);

    try {
      await updateAgent(id, {
        defaultModel: draft.defaultModel,
        icon: draft.icon,
        title: draft.title,
        avatarSeed: draft.avatarSeed,
        name: draft.name.trim() || 'Unnamed',
        prompt: draft.prompt,
      });
      setNotice({ message: 'Crew member updated.', tone: 'success' });
      setSelectedId('');
    } catch (error) {
      setNotice({ message: toErrorMessage(error), tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteConfirmId) return;

    setDeleting(true);
    setNotice(null);
    setDeleteConfirmId(null);

    try {
      await deleteAgent(deleteConfirmId);
      setNotice({ message: 'Crew member deleted.', tone: 'success' });
      setSelectedId('');
    } catch (error) {
      setNotice({ message: toErrorMessage(error), tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  const handleQuickAssign = async (agentId: string, model: ModelKey) => {
    try {
      await updateAgent(agentId, { defaultModel: model });
      setNotice({ message: 'Default model updated.', tone: 'success' });
    } catch (error) {
      setNotice({ message: toErrorMessage(error), tone: 'error' });
    }
  };

  return (
    <div className="flex flex-1 overflow-y-auto bg-surface-0">
      <div className="mx-auto w-full max-w-[1380px] space-y-5 p-4 md:p-6">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-2xl font-semibold text-text-primary">Crew</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Your AI crew members. Assign roles, avatars, and system prompts.
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search crew members..."
              size="md"
              value={search}
            />
            <Button disabled={creating} onClick={handleCreate} variant="primary">
              {creating ? 'Creating...' : 'New Crew Member'}
            </Button>
          </div>
        </header>

        {notice && (
          <div
            className={cn(
              'rounded-md border px-3 py-2 text-sm',
              notice.tone === 'error'
                ? 'border-accent-red/40 bg-accent-red-bg text-accent-red'
                : 'border-accent-green/40 bg-accent-green-bg text-accent-green',
            )}
            role="status"
          >
            {notice.message}
          </div>
        )}

        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {statCard('Total Crew', stats.totalAgents.toString(), `${stats.taskTotal} assigned tasks`)}
          {statCard('Active Now', stats.activeNow.toString(), 'Running or awaiting approval')}
          {statCard('Tasks Completed', stats.completedTotal.toLocaleString(), 'Across all pipelines')}
          {statCard('Error Rate', `${stats.errorRate.toFixed(1)}%`, 'Blocked / failed / rejected')}
        </section>

        <Card>
          <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Crew Directory</h3>
              <p className="text-xs text-text-secondary">
                Filter by status or model. Open a crew member to edit prompt and defaults.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {AGENT_FILTERS.map((item) => (
                <Button
                  className="h-7 px-2.5"
                  key={item.value}
                  onClick={() => setFilter(item.value)}
                  size="sm"
                  variant={filter === item.value ? 'primary' : 'ghost'}
                >
                  {item.label}
                </Button>
              ))}
            </div>
          </CardHeader>

          <CardBody className="px-0 pb-0">
            {agents.length === 0 ? (
              <EmptyState
                action={<Button onClick={handleCreate}>Add Crew Member</Button>}
                description="Add your first crew member and assign a role."
                icon={<span className="text-xl">🤖</span>}
                title="No crew members yet"
              />
            ) : filteredAgents.length === 0 ? (
              <EmptyState
                description="No crew members match the current search and filter."
                icon={<span className="text-xl">🔎</span>}
                title="No matches"
              />
            ) : (
              <>
                <div className="hidden border-b border-border-primary px-4 py-2 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:gap-3">
                  <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Crew Member</span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Status</span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Model</span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Tasks</span>
                  <span className="font-mono text-[10px] uppercase tracking-wide text-text-muted">Actions</span>
                </div>

                <div className="hidden md:block">
                  {filteredAgents.map((agent) => (
                    <AgentCard
                      agent={agent}
                      isSelected={selectedId === agent.id}
                      key={agent.id}
                      layout="row"
                      metrics={metricsByAgentId.get(agent.id) ?? emptyMetrics()}
                      onEdit={setSelectedId}
                      onQuickAssign={handleQuickAssign}
                    />
                  ))}
                </div>

                <div className="grid gap-3 px-4 pb-4 md:hidden">
                  {filteredAgents.map((agent) => (
                    <AgentCard
                      agent={agent}
                      isSelected={selectedId === agent.id}
                      key={agent.id}
                      layout="card"
                      metrics={metricsByAgentId.get(agent.id) ?? emptyMetrics()}
                      onEdit={setSelectedId}
                    />
                  ))}
                </div>
              </>
            )}
          </CardBody>
        </Card>

        {selectedAgent && (
          <AgentEditModal
            agent={selectedAgent}
            onClose={() => setSelectedId('')}
            onDelete={(id) => {
              setSelectedId('');
              setDeleteConfirmId(id);
            }}
            onSave={handleSave}
            saving={saving}
          />
        )}

        {deleteConfirmId && (() => {
          const target = agents.find((item) => item.id === deleteConfirmId);
          if (!target) return null;

          return (
            <ConfirmDialog
              confirmLabel="Delete"
              message={`Delete "${target.name}"? This action cannot be undone.`}
              onCancel={() => setDeleteConfirmId(null)}
              onConfirm={handleDelete}
              title="Delete Crew Member"
              variant="danger"
            />
          );
        })()}
      </div>
    </div>
  );
}
