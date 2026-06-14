import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Agent, ApprovalMode, ModelKey, Routine, ScheduleKind, TaskPriority } from '@/types';
import { APPROVAL_MODES, PRIORITIES } from '@/constants';
import * as api from '@/lib/api';
import { ModelSelector } from '@/components/atoms/ModelSelector';
import { Badge, Button, Drawer, Input, Select, Textarea } from '@/components/ui';

interface RoutinesDrawerProps {
  pipelineId: string;
  agents: Agent[];
  enabledAgentIds: string[];
  onClose: () => void;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SCHEDULE_KINDS: { value: ScheduleKind; label: string }[] = [
  { value: 'hourly', label: 'Every hour' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
];

interface FormState {
  name: string;
  agentId: string;
  model: ModelKey;
  approval: ApprovalMode;
  input: string;
  scheduleKind: ScheduleKind;
  scheduleTime: string;
  scheduleWeekday: number;
  priority: TaskPriority | null;
  enabled: boolean;
}

function scheduleSummary(r: Routine): string {
  if (r.scheduleKind === 'hourly') return 'Every hour (on the hour)';
  if (r.scheduleKind === 'daily') return `Daily at ${r.scheduleTime}`;
  return `Weekly on ${WEEKDAYS[r.scheduleWeekday] ?? '?'} at ${r.scheduleTime}`;
}

function formatNextRun(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  // Render in the SERVER's timezone so it matches the schedule the user set
  // ("Daily at 09:00"), not the viewing browser's zone.
  return date.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    timeZone: timeZone || undefined,
  });
}

export function RoutinesDrawer({ pipelineId, agents, enabledAgentIds, onClose }: RoutinesDrawerProps) {
  const availableAgents = useMemo(() => {
    if (enabledAgentIds.length === 0) return agents;
    return agents.filter((agent) => enabledAgentIds.includes(agent.id));
  }, [agents, enabledAgentIds]);

  const blankForm = useCallback((): FormState => ({
    name: '',
    agentId: availableAgents[0]?.id ?? '',
    model: availableAgents[0]?.defaultModel ?? 'claude:sonnet',
    approval: 'auto',
    input: '',
    scheduleKind: 'daily',
    scheduleTime: '09:00',
    scheduleWeekday: 1,
    priority: null,
    enabled: true,
  }), [availableAgents]);

  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null); // routine id or '__new__'
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    api.fetchRoutines(pipelineId)
      .then(setRoutines)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load routines'))
      .finally(() => setLoading(false));
  }, [pipelineId]);

  useEffect(() => { reload(); }, [reload]);

  const startCreate = () => {
    setForm(blankForm());
    setEditingId('__new__');
    setError(null);
  };

  const startEdit = (r: Routine) => {
    setForm({
      name: r.name,
      agentId: r.agentId,
      model: r.model,
      approval: r.approval,
      input: r.input,
      scheduleKind: r.scheduleKind,
      scheduleTime: r.scheduleTime,
      scheduleWeekday: r.scheduleWeekday,
      priority: r.priority,
      enabled: r.enabled,
    });
    setEditingId(r.id);
    setError(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError(null);
  };

  const handleSave = async () => {
    const name = form.name.trim();
    if (!name) { setError('Routine name is required.'); return; }
    if (!form.agentId) { setError('Select an agent.'); return; }

    setSaving(true);
    setError(null);
    const payload = {
      name,
      agentId: form.agentId,
      model: form.model,
      approval: form.approval,
      input: form.input,
      scheduleKind: form.scheduleKind,
      scheduleTime: form.scheduleTime,
      scheduleWeekday: form.scheduleWeekday,
      useWorktree: true,
      branch: null,
      timeoutMs: null,
      priority: form.priority,
      enabled: form.enabled,
    };

    try {
      if (editingId === '__new__') {
        await api.createRoutine(pipelineId, payload);
      } else if (editingId) {
        await api.updateRoutine(editingId, payload);
      }
      setEditingId(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save routine');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (r: Routine) => {
    try {
      await api.updateRoutine(r.id, { enabled: !r.enabled });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to toggle routine');
    }
  };

  const handleDelete = async (r: Routine) => {
    try {
      await api.deleteRoutine(r.id);
      if (editingId === r.id) setEditingId(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete routine');
    }
  };

  const handleRunNow = async (r: Routine) => {
    try {
      await api.runRoutine(r.id);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run routine');
    }
  };

  const isEditing = editingId !== null;

  return (
    <Drawer
      description={`Pipeline ID: ${pipelineId}`}
      onOpenChange={(open) => { if (!open) onClose(); }}
      open
      title="Routines"
      widthClassName="w-[560px] max-w-[96vw]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} variant="ghost">Close</Button>
          {!isEditing && (
            <Button onClick={startCreate} variant="primary">+ New Routine</Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <p className="font-mono text-caption text-text-dim">
          Routines spawn a fresh task into this pipeline on a recurring schedule
          (server local time). Manual-approval routines wait for approval each run.
        </p>

        {error && (
          <div className="rounded-md border border-accent-red/40 bg-accent-red-bg px-3 py-2 text-xs text-accent-red">
            {error}
          </div>
        )}

        {/* Editor form */}
        {isEditing && (
          <section className="space-y-3 rounded-md border border-border-secondary bg-surface-1 p-3">
            <h3 className="font-mono text-caption font-semibold uppercase tracking-[0.1em] text-text-secondary">
              {editingId === '__new__' ? 'New Routine' : 'Edit Routine'}
            </h3>

            <Input
              aria-label="Routine name"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Daily dependency audit"
              value={form.name}
            />

            <Textarea
              aria-label="Task prompt"
              onChange={(e) => setForm((f) => ({ ...f, input: e.target.value }))}
              placeholder="What should this task do each run?"
              rows={5}
              value={form.input}
            />

            <Select
              aria-label="Agent"
              onChange={(e) => {
                const agentId = e.target.value;
                const agent = availableAgents.find((a) => a.id === agentId);
                setForm((f) => ({ ...f, agentId, model: agent?.defaultModel ?? f.model }));
              }}
              value={form.agentId}
            >
              {availableAgents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}{agent.title ? ` — ${agent.title}` : ''}
                </option>
              ))}
            </Select>

            <ModelSelector onChange={(model) => setForm((f) => ({ ...f, model }))} value={form.model} />

            {/* Schedule */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-mono text-micro uppercase tracking-wide text-text-muted">
                  Repeats
                </label>
                <Select
                  aria-label="Schedule kind"
                  onChange={(e) => setForm((f) => ({ ...f, scheduleKind: e.target.value as ScheduleKind }))}
                  value={form.scheduleKind}
                >
                  {SCHEDULE_KINDS.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </Select>
              </div>
              {form.scheduleKind !== 'hourly' && (
                <div>
                  <label className="mb-1 block font-mono text-micro uppercase tracking-wide text-text-muted">
                    Time
                  </label>
                  <Input
                    aria-label="Schedule time"
                    onChange={(e) => setForm((f) => ({ ...f, scheduleTime: e.target.value }))}
                    type="time"
                    value={form.scheduleTime}
                  />
                </div>
              )}
            </div>

            {form.scheduleKind === 'weekly' && (
              <div>
                <label className="mb-1 block font-mono text-micro uppercase tracking-wide text-text-muted">
                  Day of week
                </label>
                <Select
                  aria-label="Weekday"
                  onChange={(e) => setForm((f) => ({ ...f, scheduleWeekday: Number(e.target.value) }))}
                  value={String(form.scheduleWeekday)}
                >
                  {WEEKDAYS.map((day, idx) => (
                    <option key={day} value={String(idx)}>{day}</option>
                  ))}
                </Select>
              </div>
            )}

            {/* Approval + Priority */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-mono text-micro uppercase tracking-wide text-text-muted">
                  Approval
                </label>
                <Select
                  aria-label="Approval mode"
                  onChange={(e) => setForm((f) => ({ ...f, approval: e.target.value as ApprovalMode }))}
                  value={form.approval}
                >
                  {APPROVAL_MODES.map((mode) => (
                    <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>
                  ))}
                </Select>
              </div>
              <div>
                <label className="mb-1 block font-mono text-micro uppercase tracking-wide text-text-muted">
                  Priority
                </label>
                <Select
                  aria-label="Priority"
                  onChange={(e) => {
                    const v = e.target.value;
                    setForm((f) => ({ ...f, priority: v ? (v as TaskPriority) : null }));
                  }}
                  value={form.priority ?? ''}
                >
                  <option value="">No priority</option>
                  {PRIORITIES.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </Select>
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
              <input
                checked={form.enabled}
                className="accent-accent-orange"
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                type="checkbox"
              />
              <span>Enabled <span className="text-text-dim">(schedule active)</span></span>
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button onClick={cancelEdit} size="sm" variant="ghost">Cancel</Button>
              <Button disabled={saving} onClick={handleSave} size="sm" variant="primary">
                {saving ? 'Saving…' : 'Save Routine'}
              </Button>
            </div>
          </section>
        )}

        {/* Routine list */}
        {!isEditing && (
          <section className="space-y-2">
            {loading ? (
              <p className="font-mono text-caption text-text-dim">Loading…</p>
            ) : routines.length === 0 ? (
              <div className="rounded-md border border-dashed border-border-secondary bg-surface-0/45 px-3 py-6 text-center">
                <p className="font-mono text-[11px] uppercase tracking-wide text-text-dim">No routines yet</p>
                <p className="mt-1 text-xs text-text-secondary">
                  Create a routine to run a task on a recurring schedule.
                </p>
              </div>
            ) : (
              routines.map((r) => (
                <div key={r.id} className="rounded-md border border-border-secondary bg-surface-1 p-3">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-xs font-semibold text-text-primary">{r.name}</span>
                        <Badge size="sm" tone={r.enabled ? 'success' : 'neutral'}>
                          {r.enabled ? 'On' : 'Off'}
                        </Badge>
                      </div>
                      <p className="mt-1 font-mono text-micro text-text-dim">{scheduleSummary(r)}</p>
                      <p className="mt-0.5 font-mono text-micro text-text-dim">
                        Next: {r.enabled ? formatNextRun(r.nextTriggerAt, r.serverTimeZone) : 'paused'}
                        {r.lastTriggeredAt && ` · Last: ${formatNextRun(r.lastTriggeredAt, r.serverTimeZone)}`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
                    {r.enabled && (
                      <Button className="h-6 px-2 text-micro" onClick={() => handleRunNow(r)} size="sm" variant="secondary">
                        Run now
                      </Button>
                    )}
                    <Button className="h-6 px-2 text-micro" onClick={() => handleToggle(r)} size="sm" variant="ghost">
                      {r.enabled ? 'Disable' : 'Enable'}
                    </Button>
                    <Button className="h-6 px-2 text-micro" onClick={() => startEdit(r)} size="sm" variant="ghost">
                      Edit
                    </Button>
                    <Button className="h-6 px-2 text-micro" onClick={() => handleDelete(r)} size="sm" variant="danger">
                      Delete
                    </Button>
                  </div>
                </div>
              ))
            )}
          </section>
        )}
      </div>
    </Drawer>
  );
}
