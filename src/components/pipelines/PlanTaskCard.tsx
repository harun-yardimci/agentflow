import type { Agent, ApprovalMode, ModelKey, TaskPriority, BreakdownTaskPlan } from '@/types';
import { APPROVAL_MODES, PRIORITIES, PRESET_TAGS, getTagColor } from '@/constants';
import { ModelSelector } from '@/components/atoms/ModelSelector';
import { cn } from '@/lib/utils';

interface PlanTaskCardProps {
  index: number;
  task: BreakdownTaskPlan;
  agents: Agent[];
  totalTasks: number;
  onChange: (index: number, updated: BreakdownTaskPlan) => void;
  onDelete: (index: number) => void;
}

export function PlanTaskCard({ index, task, agents, totalTasks, onChange, onDelete }: PlanTaskCardProps) {
  const agent = agents.find((a) => a.id === task.agentId);

  const update = (partial: Partial<BreakdownTaskPlan>) => {
    onChange(index, { ...task, ...partial });
  };

  return (
    <div className="rounded-lg border border-border-secondary bg-surface-1 p-3">
      {/* Header row */}
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-orange/20 font-mono text-[9px] font-bold text-accent-orange">
          {index + 1}
        </span>
        <input
          value={task.name}
          onChange={(e) => update({ name: e.target.value })}
          className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 font-mono text-xs font-semibold text-text-primary outline-none hover:border-border-secondary focus:border-accent-orange"
        />
        <button
          onClick={() => onDelete(index)}
          className="shrink-0 rounded p-1 text-text-dim transition-colors hover:bg-accent-red-bg hover:text-accent-red"
          title="Remove task"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Agent + Model row */}
      <div className="mb-2 space-y-1.5">
        <select
          value={task.agentId}
          onChange={(e) => {
            const a = agents.find((ag) => ag.id === e.target.value);
            update({ agentId: e.target.value, model: a?.defaultModel ?? task.model });
          }}
          className="rounded border border-border-secondary bg-surface-2 px-2 py-1 font-mono text-[10px] text-text-primary outline-none focus:border-accent-orange"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}{a.title ? ` — ${a.title}` : ''}</option>
          ))}
        </select>

        <ModelSelector
          onChange={(model) => update({ model })}
          size="sm"
          value={task.model}
        />
      </div>

      {/* Stage + Approval row */}
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[9px] text-text-dim">Stage:</span>
          <div className="flex gap-0.5">
            {[0, 1, 2, 3, 4].map((s) => (
              <button
                key={s}
                onClick={() => update({ stage: s })}
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded font-mono text-[9px] font-semibold transition-all',
                  task.stage === s
                    ? 'bg-accent-orange-bg text-accent-orange'
                    : 'text-text-dim hover:bg-surface-2',
                )}
              >
                {s + 1}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <span className="font-mono text-[9px] text-text-dim">Approval:</span>
          <div className="flex gap-0.5">
            {APPROVAL_MODES.map((m) => (
              <button
                key={m}
                onClick={() => update({ approval: m as ApprovalMode })}
                className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[9px] transition-all',
                  task.approval === m
                    ? 'bg-accent-orange-bg text-accent-orange'
                    : 'text-text-dim hover:bg-surface-2',
                )}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Dependencies */}
      {totalTasks > 1 && (
        <div className="mb-2">
          <span className="font-mono text-[9px] text-text-dim">Depends on:</span>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {Array.from({ length: totalTasks }, (_, i) => i)
              .filter((i) => i !== index)
              .map((i) => {
                const checked = task.dependsOn.includes(i);
                return (
                  <button
                    key={i}
                    onClick={() => {
                      update({
                        dependsOn: checked
                          ? task.dependsOn.filter((d) => d !== i)
                          : [...task.dependsOn, i],
                      });
                    }}
                    className={cn(
                      'rounded border px-1.5 py-0.5 font-mono text-[9px] transition-all',
                      checked
                        ? 'border-accent-orange bg-accent-orange-bg text-accent-orange'
                        : 'border-border-secondary text-text-dim hover:border-border-hover',
                    )}
                  >
                    #{i + 1}
                  </button>
                );
              })}
          </div>
        </div>
      )}

      {/* Priority + Tags */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[9px] text-text-dim">Priority:</span>
          {([null, ...PRIORITIES.map((p) => p.key)] as (TaskPriority | null)[]).map((p) => {
            const conf = p ? PRIORITIES.find((pr) => pr.key === p) : null;
            return (
              <button
                key={p ?? 'none'}
                onClick={() => update({ priority: p })}
                className={cn(
                  'rounded px-1.5 py-0.5 font-mono text-[9px] transition-all',
                  task.priority === p
                    ? conf ? 'font-semibold' : 'bg-surface-2 text-text-secondary'
                    : 'text-text-dim hover:bg-surface-2',
                )}
                style={task.priority === p && conf ? { color: conf.color } : undefined}
              >
                {conf?.label ?? '-'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tags */}
      <div className="mb-2 flex flex-wrap gap-1">
        {PRESET_TAGS.map((preset) => {
          const active = task.tags.includes(preset);
          const color = getTagColor(preset);
          return (
            <button
              key={preset}
              onClick={() =>
                update({
                  tags: active
                    ? task.tags.filter((t) => t !== preset)
                    : [...task.tags, preset],
                })
              }
              className={cn(
                'rounded-full border px-1.5 py-0.5 font-mono text-[8px] transition-all',
                active
                  ? 'font-semibold'
                  : 'border-border-secondary text-text-dim hover:border-border-hover',
              )}
              style={
                active
                  ? { color, backgroundColor: color + '1A', borderColor: color + '55' }
                  : undefined
              }
            >
              {preset}
            </button>
          );
        })}
      </div>

      {/* Input prompt */}
      <textarea
        value={task.input}
        onChange={(e) => update({ input: e.target.value })}
        placeholder="Input prompt for this task..."
        rows={2}
        className="mb-1 w-full resize-none rounded border border-border-secondary bg-surface-2 px-2 py-1.5 font-mono text-[10px] text-text-primary placeholder:text-text-dim outline-none focus:border-accent-orange"
      />

      {/* AI Rationale */}
      {task.rationale && (
        <div className="font-mono text-[9px] italic text-text-dim">
          AI: {task.rationale}
        </div>
      )}
    </div>
  );
}
