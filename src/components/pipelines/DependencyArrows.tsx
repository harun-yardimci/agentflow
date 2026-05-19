import { useEffect, useRef, useState, useCallback } from 'react';
import type { Task } from '@/types';

interface Arrow {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  dashed: boolean;
  opacity: number;
}

interface DependencyArrowsProps {
  tasks: Task[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function DependencyArrows({ tasks, containerRef }: DependencyArrowsProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const recalculate = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    setSize({ w: container.scrollWidth, h: container.scrollHeight });

    const newArrows: Arrow[] = [];

    for (const task of tasks) {
      if (task.dependsOn.length === 0) continue;

      const taskEl = container.querySelector(`[data-task-id="${task.id}"]`);
      if (!taskEl) continue;
      const taskRect = taskEl.getBoundingClientRect();

      for (const depId of task.dependsOn) {
        const depTask = tasks.find((t) => t.id === depId);
        if (!depTask) continue;

        // Only draw cross-stage arrows (reduces visual clutter)
        if (depTask.stage === task.stage) continue;

        const depEl = container.querySelector(`[data-task-id="${depId}"]`);
        if (!depEl) continue;
        const depRect = depEl.getBoundingClientRect();

        const isCompleted = depTask.status === 'completed';
        const isActive = depTask.status === 'running' || depTask.status === 'awaiting_approval';
        const isSkipped = task.status === 'skipped';
        const isConditional = task.dependencyConditions?.[depId] !== undefined;

        let color: string;
        let dashed: boolean;
        let opacity: number;

        if (isSkipped) {
          color = 'var(--color-text-dim)';
          dashed = true;
          opacity = 0.4;
        } else if (isConditional) {
          color = 'var(--color-accent-orange)';
          dashed = true;
          opacity = 0.5;
        } else {
          color = isCompleted
            ? 'var(--color-accent-green)'
            : isActive
              ? 'var(--color-accent-blue)'
              : 'var(--color-text-dim)';
          dashed = !isCompleted;
          opacity = 0.5;
        }

        newArrows.push({
          x1: depRect.right - rect.left + container.scrollLeft,
          y1: depRect.top + depRect.height / 2 - rect.top + container.scrollTop,
          x2: taskRect.left - rect.left + container.scrollLeft,
          y2: taskRect.top + taskRect.height / 2 - rect.top + container.scrollTop,
          color,
          dashed,
          opacity,
        });
      }
    }

    setArrows(newArrows);
  }, [tasks, containerRef]);

  useEffect(() => {
    recalculate();

    const container = containerRef.current;
    if (!container) return;

    // Recalculate on scroll & resize
    const handleScroll = () => recalculate();
    container.addEventListener('scroll', handleScroll);
    window.addEventListener('resize', recalculate);

    // MutationObserver for dynamic DOM changes
    const observer = new MutationObserver(recalculate);
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', recalculate);
      observer.disconnect();
    };
  }, [recalculate]);

  if (arrows.length === 0) return null;

  return (
    <svg
      ref={svgRef}
      className="pointer-events-none absolute left-0 top-0"
      width={size.w}
      height={size.h}
      style={{ overflow: 'visible' }}
    >
      <defs>
        {arrows.map((_, i) => (
          <marker
            key={`arrow-${i}`}
            id={`arrowhead-${i}`}
            markerWidth="8"
            markerHeight="6"
            refX="7"
            refY="3"
            orient="auto"
          >
            <polygon
              points="0 0, 8 3, 0 6"
              fill={arrows[i]!.color}
              opacity={arrows[i]!.opacity + 0.1}
            />
          </marker>
        ))}
      </defs>
      {arrows.map((arrow, i) => {
        const midX = (arrow.x1 + arrow.x2) / 2;
        const path = `M ${arrow.x1} ${arrow.y1} C ${midX} ${arrow.y1}, ${midX} ${arrow.y2}, ${arrow.x2} ${arrow.y2}`;
        return (
          <path
            key={i}
            d={path}
            fill="none"
            stroke={arrow.color}
            strokeWidth="1.5"
            strokeDasharray={arrow.dashed ? '4 3' : undefined}
            opacity={arrow.opacity}
            markerEnd={`url(#arrowhead-${i})`}
          />
        );
      })}
    </svg>
  );
}
