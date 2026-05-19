import type { Task, TaskStatus } from '@/types';

/**
 * Find tasks that become unblocked after a given task completes.
 * A task is unblocked when ALL its dependencies are "completed".
 */
export function findUnblockedTasks(tasks: Task[], completedTaskId: string): Task[] {
  return tasks.filter((task) => {
    if (task.status !== 'queued') return false;
    if (!task.dependsOn.includes(completedTaskId)) return false;
    return task.dependsOn.every((depId) => {
      const dep = tasks.find((t) => t.id === depId);
      return dep?.status === 'completed';
    });
  });
}

/**
 * Compute the overall pipeline status from its tasks.
 */
export function computePipelineStatus(tasks: Task[]): TaskStatus {
  if (tasks.length === 0) return 'queued';
  if (tasks.every((t) => t.status === 'completed')) return 'completed';
  if (tasks.some((t) => t.status === 'running' || t.status === 'awaiting_approval')) return 'running';
  if (tasks.some((t) => t.status === 'blocked' || t.status === 'failed')) return 'blocked';
  return 'queued';
}

/**
 * Calculate total tokens used in a pipeline.
 */
export function totalTokens(tasks: Task[]): number {
  return tasks.reduce((sum, t) => sum + (t.tokens ?? 0), 0);
}

/**
 * Calculate total cost of a pipeline.
 */
export function totalCost(tasks: Task[], modelCosts: Record<string, number>): number {
  return tasks.reduce((sum, t) => {
    const cost = modelCosts[t.model] ?? 0;
    return sum + ((t.tokens ?? 0) / 1000) * cost;
  }, 0);
}

/**
 * Count completed tasks in a pipeline.
 */
export function completedCount(tasks: Task[]): number {
  return tasks.filter((t) => t.status === 'completed').length;
}
