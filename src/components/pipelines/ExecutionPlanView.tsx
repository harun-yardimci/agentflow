import { useEffect, useRef, useState } from 'react';
import { AttachmentList } from '@/components/atoms/AttachmentList';
import type { Agent, Attachment, BreakdownTaskPlan } from '@/types';
import { useModels } from '@/context/ModelContext';
import { CrewAvatar } from '@/components/atoms/CrewAvatar';
import { EmptyState } from '@/components/ui';

interface ExecutionPlanViewProps {
  tasks: BreakdownTaskPlan[];
  agents: Agent[];
  contextAttachments?: Attachment[];
}

interface Arrow {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}

export function ExecutionPlanView({
  tasks,
  agents,
  contextAttachments = [],
}: ExecutionPlanViewProps) {
  const { getModel } = useModels();
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [arrows, setArrows] = useState<Arrow[]>([]);

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-border-secondary bg-surface-1 p-4">
        {contextAttachments.length > 0 && (
          <div className="mb-4 rounded-md border border-accent-orange/20 bg-accent-orange/5 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-orange">
                Planner Context
              </p>
              <span className="font-mono text-[10px] text-text-dim">
                {contextAttachments.length} file{contextAttachments.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-text-dim">
              These files were attached to the AI breakdown request and informed the plan below.
            </p>
            <AttachmentList attachments={contextAttachments} className="mt-2" />
          </div>
        )}

        <EmptyState
          description="The planner decided no executable tasks are needed for this request."
          title="No tasks generated"
        />
      </div>
    );
  }

  // Group tasks by stage
  const stageMap = new Map<number, { task: BreakdownTaskPlan; index: number }[]>();
  tasks.forEach((task, index) => {
    const stage = task.stage;
    if (!stageMap.has(stage)) stageMap.set(stage, []);
    stageMap.get(stage)!.push({ task, index });
  });

  const stages = Array.from(stageMap.entries()).sort((a, b) => a[0] - b[0]);
  const hasDeps = tasks.some((t) => t.dependsOn.length > 0);

  // Calculate arrow positions after render
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !hasDeps) return;

    const computeArrows = () => {
      const containerRect = container.getBoundingClientRect();
      const newArrows: Arrow[] = [];

      tasks.forEach((task, index) => {
        if (task.dependsOn.length === 0) return;
        const toEl = cardRefs.current.get(index);
        if (!toEl) return;

        for (const depIdx of task.dependsOn) {
          const fromEl = cardRefs.current.get(depIdx);
          if (!fromEl) continue;

          const fromRect = fromEl.getBoundingClientRect();
          const toRect = toEl.getBoundingClientRect();

          newArrows.push({
            fromX: fromRect.right - containerRect.left,
            fromY: fromRect.top + fromRect.height / 2 - containerRect.top,
            toX: toRect.left - containerRect.left,
            toY: toRect.top + toRect.height / 2 - containerRect.top,
          });
        }
      });

      setArrows(newArrows);
    };

    // Wait for layout
    requestAnimationFrame(computeArrows);
  }, [tasks, hasDeps]);

  return (
    <div className="rounded-lg border border-border-secondary bg-surface-1 p-4">
      {contextAttachments.length > 0 && (
        <div className="mb-4 rounded-md border border-accent-orange/20 bg-accent-orange/5 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-orange">
              Planner Context
            </p>
            <span className="font-mono text-[10px] text-text-dim">
              {contextAttachments.length} file{contextAttachments.length === 1 ? '' : 's'}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-text-dim">
            These files were attached to the AI breakdown request and informed the plan below.
          </p>
          <AttachmentList attachments={contextAttachments} className="mt-2" />
        </div>
      )}

      <div ref={containerRef} className="relative flex items-start gap-3 overflow-x-auto pb-2">
        {/* SVG overlay for dependency arrows */}
        {arrows.length > 0 && (
          <svg
            className="pointer-events-none absolute inset-0 z-10"
            style={{ width: '100%', height: '100%', overflow: 'visible' }}
          >
            <defs>
              <marker
                id="ep-arrowhead"
                markerHeight="6"
                markerWidth="6"
                orient="auto"
                refX="5"
                refY="3"
              >
                <path d="M0,0 L6,3 L0,6" fill="none" stroke="#3b82f6" strokeWidth="1" />
              </marker>
            </defs>
            {arrows.map((arrow, i) => {
              const midX = (arrow.fromX + arrow.toX) / 2;
              return (
                <path
                  d={`M${arrow.fromX},${arrow.fromY} C${midX},${arrow.fromY} ${midX},${arrow.toY} ${arrow.toX},${arrow.toY}`}
                  fill="none"
                  key={i}
                  markerEnd="url(#ep-arrowhead)"
                  opacity={0.6}
                  stroke="#3b82f6"
                  strokeDasharray="4 3"
                  strokeWidth="1.5"
                />
              );
            })}
          </svg>
        )}


        {stages.map(([stageNum, stageTasks], stageIdx) => (
          <div key={stageNum} className="flex items-start gap-3">
            {/* Stage column */}
            <div className="flex min-w-[180px] flex-col gap-2">
              <div className="mb-1 text-center font-mono text-[10px] font-semibold uppercase tracking-widest text-text-muted">
                Stage {stageNum + 1}
              </div>
              {stageTasks.map(({ task, index }) => {
                const agent = agents.find((a) => a.id === task.agentId);
                const modelConf = getModel(task.model);
                const deps = task.dependsOn.length > 0
                  ? task.dependsOn.map((d) => `#${d + 1}`).join(', ')
                  : null;

                return (
                  <div
                    key={index}
                    ref={(el) => {
                      if (el) cardRefs.current.set(index, el);
                      else cardRefs.current.delete(index);
                    }}
                    className="rounded-md border border-border-secondary bg-surface-2 px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-orange/20 font-mono text-[9px] font-bold text-accent-orange">
                        {index + 1}
                      </span>
                      <CrewAvatar seed={agent?.avatarSeed || agent?.name || task.agentId} size="xs" name={agent?.name} title={agent?.title} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-text-primary">
                        {task.name}
                      </span>
                      {modelConf && (
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[8px] font-bold"
                          style={{ color: modelConf.color, backgroundColor: modelConf.bg }}
                        >
                          {modelConf.label}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 font-mono text-[9px] text-text-dim">
                      <span>{task.approval}</span>
                      {deps && (
                        <span className="text-accent-blue">
                          deps: {deps}
                        </span>
                      )}
                    </div>
                    {task.rationale && (
                      <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-text-dim">
                        {task.rationale}
                      </p>
                    )}
                  </div>
                );
              })}
              {stageTasks.length > 1 && (
                <div className="text-center font-mono text-[8px] text-text-dim">
                  parallel
                </div>
              )}
            </div>

            {/* Arrow between stages */}
            {stageIdx < stages.length - 1 && (
              <div className="flex items-center self-center pt-6 text-text-dim">
                <svg width="28" height="14" viewBox="0 0 28 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M0 7H22M22 7L16 1.5M22 7L16 12.5" />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-4 border-t border-border-primary pt-3">
        <span className="font-mono text-[9px] text-text-dim">
          Same stage = parallel execution
        </span>
        <span className="font-mono text-[9px] text-text-dim">
          {tasks.length} tasks across {stages.length} stages
        </span>
        {hasDeps && (
          <span className="flex items-center gap-1.5 font-mono text-[9px] text-accent-blue">
            <svg width="20" height="8" viewBox="0 0 20 8">
              <path d="M0,4 L16,4" fill="none" stroke="#3b82f6" strokeDasharray="4 3" strokeWidth="1.5" />
              <path d="M12,1 L16,4 L12,7" fill="none" stroke="#3b82f6" strokeWidth="1" />
            </svg>
            dependency
          </span>
        )}
      </div>
    </div>
  );
}
