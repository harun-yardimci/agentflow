import type { Pipeline } from '@/types';
import type { PipelineAction } from './pipeline-actions';
import { computePipelineStatus } from '@/lib/pipeline-engine';

function updatePipelineTasks(state: Pipeline[], pipelineId: string, updater: (p: Pipeline) => Pipeline): Pipeline[] {
  return state.map((p) => {
    if (p.id !== pipelineId) return p;
    const updated = updater(p);
    return { ...updated, status: computePipelineStatus(updated.tasks) };
  });
}

export function pipelineReducer(state: Pipeline[], action: PipelineAction): Pipeline[] {
  switch (action.type) {
    case 'SET_PIPELINES':
      return action.pipelines;

    case 'ADD_PIPELINE':
      return [...state, action.payload];

    case 'UPDATE_PIPELINE':
      return state.map((p) =>
        p.id === action.pipelineId ? { ...p, ...action.update } : p
      );

    // BUG #1 FIX: scoped to pipelineId only
    case 'UPDATE_TASK':
      return updatePipelineTasks(state, action.pipelineId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === action.taskId ? { ...t, ...action.update } : t
        ),
      }));

    case 'ADD_TASK':
      return updatePipelineTasks(state, action.pipelineId, (p) => ({
        ...p,
        tasks: [...p.tasks, action.task],
      }));

    case 'MOVE_TASK':
      return updatePipelineTasks(state, action.pipelineId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === action.taskId ? { ...t, status: action.targetStatus } : t
        ),
      }));

    case 'APPROVE_TASK':
      return updatePipelineTasks(state, action.pipelineId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === action.taskId ? { ...t, status: 'running' } : t
        ),
      }));

    case 'COMPLETE_TASK':
      return updatePipelineTasks(state, action.pipelineId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === action.taskId
            ? { ...t, status: 'completed', output: action.output, duration: action.duration, tokens: action.tokens }
            : t
        ),
      }));

    case 'REJECT_TASK':
      return updatePipelineTasks(state, action.pipelineId, (p) => ({
        ...p,
        tasks: p.tasks.map((t) =>
          t.id === action.taskId ? { ...t, status: 'blocked' } : t
        ),
      }));

    // BUG #2 FIX: complete task + cascade deps in single atomic action
    case 'COMPLETE_AND_CASCADE':
      return updatePipelineTasks(state, action.pipelineId, (p) => {
        const tasksAfterComplete = p.tasks.map((t) =>
          t.id === action.taskId
            ? { ...t, status: 'completed' as const, output: action.output, duration: action.duration, tokens: action.tokens }
            : t
        );
        const tasksAfterCascade = tasksAfterComplete.map((task) => {
          if (task.status !== 'queued') return task;
          if (!task.dependsOn.includes(action.taskId)) return task;

          const allDepsDone = task.dependsOn.every((depId) => {
            const dep = tasksAfterComplete.find((t) => t.id === depId);
            return dep?.status === 'completed';
          });
          if (!allDepsDone) return task;

          if (task.approval === 'auto') {
            return { ...task, status: 'running' as const };
          }
          return { ...task, status: 'awaiting_approval' as const };
        });

        return { ...p, tasks: tasksAfterCascade };
      });

    // Legacy: standalone cascade (kept for manual triggers)
    case 'CASCADE_DEPS':
      return updatePipelineTasks(state, action.pipelineId, (p) => ({
        ...p,
        tasks: p.tasks.map((task) => {
          if (task.status !== 'queued') return task;
          if (!task.dependsOn.includes(action.completedTaskId)) return task;

          const allDepsDone = task.dependsOn.every((depId) => {
            const dep = p.tasks.find((t) => t.id === depId);
            return dep?.status === 'completed';
          });

          if (!allDepsDone) return task;

          if (task.approval === 'auto') {
            return { ...task, status: 'running' as const };
          }
          return { ...task, status: 'awaiting_approval' as const };
        }),
      }));

    case 'PUSH_LOG':
      return state.map((p) =>
        p.id === action.pipelineId
          ? { ...p, logs: [...p.logs, action.entry] }
          : p
      );

    default:
      return state;
  }
}
