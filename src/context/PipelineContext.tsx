import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import type { Pipeline, Task } from '@/types';
import * as api from '@/lib/api';

/* ─── Native Browser Notification Helper ─── */

function shouldNotify(): boolean {
  if (typeof window === 'undefined' || !('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;
  // Check localStorage setting (fast, avoids API call)
  try {
    return localStorage.getItem('agentflow_native_notifications') === 'true';
  } catch {
    return false;
  }
}

function showNativeNotification(title: string, body: string): void {
  if (!shouldNotify()) return;
  try {
    new Notification(title, {
      body,
      icon: '/icon-192.png',
      tag: `agentflow-${Date.now()}`,
    });
  } catch {
    // Silently ignore — notifications might be blocked
  }
}

/** Detect task status changes between polls and fire native notifications */
function detectAndNotify(
  prev: Map<string, string>,
  next: Pipeline[],
): Map<string, string> {
  const nextMap = new Map<string, string>();

  for (const pipeline of next) {
    if (!pipeline.tasks) continue;
    for (const task of pipeline.tasks) {
      nextMap.set(task.id, task.status);
      const prevStatus = prev.get(task.id);

      // Skip if first load or no change
      if (prev.size === 0 || !prevStatus || prevStatus === task.status) continue;

      // Notify on specific transitions
      if (task.status === 'completed' && prevStatus === 'running') {
        showNativeNotification(
          'Task Completed',
          `"${task.name}" finished successfully`,
        );
      } else if ((task.status === 'blocked' || task.status === 'failed') && prevStatus !== 'blocked' && prevStatus !== 'failed') {
        showNativeNotification(
          'Task Blocked',
          `"${task.name}" was blocked`,
        );
      } else if (task.status === 'awaiting_approval') {
        showNativeNotification(
          'Approval Needed',
          `"${task.name}" is waiting for your approval`,
        );
      }
    }
  }

  return nextMap;
}

interface PipelineContextValue {
  pipelines: Pipeline[];
  loading: boolean;
  error: string | null;
  actionError: string | null;
  clearActionError: () => void;
  refresh: () => Promise<void>;
  addPipeline: (data: Parameters<typeof api.createPipeline>[0]) => Promise<Pipeline>;
  removePipeline: (id: string) => Promise<void>;
  addTask: (pipelineId: string, task: Parameters<typeof api.createTask>[1]) => Promise<Task>;
  batchAddTasks: (pipelineId: string, tasks: {
    name: string;
    agentId: string;
    model: string;
    approval: string;
    stage: number;
    dependsOnIndices: number[];
    input: string;
    priority?: string | null;
    timeoutMs?: number;
    tags?: string[];
  }[]) => Promise<void>;
  approveTask: (pipelineId: string, taskId: string) => Promise<void>;
  rejectTask: (pipelineId: string, taskId: string) => Promise<void>;
  moveTask: (pipelineId: string, taskId: string, status: string) => Promise<void>;
  runPipeline: (pipelineId: string) => Promise<string | undefined>;
  pausePipeline: (pipelineId: string) => Promise<void>;
  abortTask: (taskId: string) => Promise<void>;
  startTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string, followUpPrompt?: string) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  archiveTask: (taskId: string) => Promise<void>;
  unarchiveTask: (taskId: string) => Promise<void>;
  archiveAllDone: (pipelineId: string) => Promise<void>;
}

const PipelineContext = createContext<PipelineContextValue | null>(null);

const POLL_INTERVAL = 2000;

export function PipelineProvider({ children }: { children: ReactNode }) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionErrorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pollRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const prevTaskStatusRef = useRef<Map<string, string>>(new Map());

  const showActionError = useCallback((msg: string) => {
    setActionError(msg);
    if (actionErrorTimer.current) clearTimeout(actionErrorTimer.current);
    actionErrorTimer.current = setTimeout(() => setActionError(null), 6000);
  }, []);

  const clearActionError = useCallback(() => {
    setActionError(null);
    if (actionErrorTimer.current) clearTimeout(actionErrorTimer.current);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await api.fetchPipelines();
      // Detect status changes and fire native notifications
      prevTaskStatusRef.current = detectAndNotify(prevTaskStatusRef.current, data);
      setPipelines(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch pipelines');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, POLL_INTERVAL);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [refresh]);

  const addPipeline = useCallback(async (data: Parameters<typeof api.createPipeline>[0]) => {
    const created = await api.createPipeline(data);
    await refresh();
    return created;
  }, [refresh]);

  const removePipeline = useCallback(async (id: string) => {
    await api.deletePipeline(id);
    await refresh();
  }, [refresh]);

  const addTask = useCallback(async (pipelineId: string, task: Parameters<typeof api.createTask>[1]) => {
    const created = await api.createTask(pipelineId, task);
    await refresh();
    return created;
  }, [refresh]);

  const batchAddTasks = useCallback(async (pipelineId: string, tasks: Parameters<typeof api.batchCreateTasks>[1]) => {
    await api.batchCreateTasks(pipelineId, tasks);
    await refresh();
  }, [refresh]);

  const approveTaskFn = useCallback(async (_pipelineId: string, taskId: string) => {
    try {
      await api.approveTask(taskId);
    } catch (err) {
      showActionError(err instanceof Error ? err.message : 'Failed to approve task');
      return;
    }
    await refresh();
  }, [refresh, showActionError]);

  const rejectTaskFn = useCallback(async (_pipelineId: string, taskId: string) => {
    await api.rejectTask(taskId);
    await refresh();
  }, [refresh]);

  const moveTaskFn = useCallback(async (_pipelineId: string, taskId: string, status: string) => {
    try {
      await api.moveTask(taskId, status);
    } catch (err) {
      showActionError(err instanceof Error ? err.message : 'Failed to move task');
      return;
    }
    await refresh();
  }, [refresh, showActionError]);

  const runPipelineFn = useCallback(async (pipelineId: string) => {
    const result = await api.runPipeline(pipelineId);
    await refresh();
    return result.blocked;
  }, [refresh]);

  const pausePipelineFn = useCallback(async (pipelineId: string) => {
    await api.pausePipeline(pipelineId);
    await refresh();
  }, [refresh]);

  const abortTaskFn = useCallback(async (taskId: string) => {
    await api.abortTask(taskId);
    await refresh();
  }, [refresh]);

  const startTaskFn = useCallback(async (taskId: string) => {
    try {
      const result = await api.startTask(taskId);
      if (result.blocked) {
        showActionError(result.blocked);
      }
    } catch (err) {
      showActionError(err instanceof Error ? err.message : 'Failed to start task');
      return;
    }
    await refresh();
  }, [refresh, showActionError]);

  const retryTaskFn = useCallback(async (taskId: string, followUpPrompt?: string) => {
    try {
      await api.retryTask(taskId, followUpPrompt);
    } catch (err) {
      showActionError(err instanceof Error ? err.message : 'Failed to retry task');
      return;
    }
    await refresh();
  }, [refresh, showActionError]);

  const deleteTaskFn = useCallback(async (taskId: string) => {
    await api.deleteTask(taskId);
    await refresh();
  }, [refresh]);

  const archiveTaskFn = useCallback(async (taskId: string) => {
    await api.archiveTask(taskId);
    await refresh();
  }, [refresh]);

  const unarchiveTaskFn = useCallback(async (taskId: string) => {
    await api.unarchiveTask(taskId);
    await refresh();
  }, [refresh]);

  const archiveAllDoneFn = useCallback(async (pipelineId: string) => {
    await api.archiveAllDone(pipelineId);
    await refresh();
  }, [refresh]);

  return (
    <PipelineContext.Provider value={{
      pipelines,
      loading,
      error,
      actionError,
      clearActionError,
      refresh,
      addPipeline,
      removePipeline,
      addTask,
      batchAddTasks,
      approveTask: approveTaskFn,
      rejectTask: rejectTaskFn,
      moveTask: moveTaskFn,
      runPipeline: runPipelineFn,
      pausePipeline: pausePipelineFn,
      abortTask: abortTaskFn,
      startTask: startTaskFn,
      retryTask: retryTaskFn,
      deleteTask: deleteTaskFn,
      archiveTask: archiveTaskFn,
      unarchiveTask: unarchiveTaskFn,
      archiveAllDone: archiveAllDoneFn,
    }}>
      {children}
    </PipelineContext.Provider>
  );
}

export function usePipelines() {
  const ctx = useContext(PipelineContext);
  if (!ctx) throw new Error('usePipelines must be used within PipelineProvider');
  return ctx;
}
