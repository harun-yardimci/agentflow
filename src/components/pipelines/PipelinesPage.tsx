import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import type { DependencyCondition, LogEntry, Task } from '@/types';
import * as api from '@/lib/api';
import { useAgents } from '@/context/AgentContext';
import { usePipelines } from '@/context/PipelineContext';
import { EmptyState, Skeleton } from '@/components/ui';
import { ConfirmDialog } from '@/components/atoms/ConfirmDialog';
import { NewPipelineModal } from './NewPipelineModal';
import {
  PipelineHeader,
  type PipelineContentView,
  type TaskFilter,
} from './PipelineHeader';
import { PipelineIntegrationPanel } from './PipelineIntegrationPanel';
import { PipelineSidebar } from './PipelineSidebar';
import { PipelineView } from './PipelineView';

const AddTaskDrawer = lazy(async () => {
  const module = await import('./AddTaskDrawer');
  return { default: module.AddTaskDrawer };
});

const ArchivedTasksPanel = lazy(async () => {
  const module = await import('./ArchivedTasksPanel');
  return { default: module.ArchivedTasksPanel };
});

const LogPanel = lazy(async () => {
  const module = await import('./LogPanel');
  return { default: module.LogPanel };
});

const PipelineSettingsDrawer = lazy(async () => {
  const module = await import('./PipelineSettingsDrawer');
  return { default: module.PipelineSettingsDrawer };
});

const TaskDrawer = lazy(async () => {
  const module = await import('./TaskDrawer');
  return { default: module.TaskDrawer };
});

const RoutinesDrawer = lazy(async () => {
  const module = await import('./RoutinesDrawer');
  return { default: module.RoutinesDrawer };
});

interface PipelinesPageProps {
  onNewPipelineOpen: () => void;
  newPipelineOpen: boolean;
  onNewPipelineClose: () => void;
}

export function PipelinesPage({
  onNewPipelineOpen,
  newPipelineOpen,
  onNewPipelineClose,
}: PipelinesPageProps) {
  const {
    pipelines,
    approveTask,
    rejectTask,
    addPipeline,
    addTask,
    batchAddTasks,
    abortTask,
    startTask,
    moveTask,
    retryTask,
    deleteTask,
    runPipeline,
    pausePipeline,
    removePipeline,
    archiveTask,
    unarchiveTask,
    archiveAllDone,
    actionError,
    clearActionError,
  } = usePipelines();
  const { agents, loading: agentsLoading } = useAgents();

  const [selectedPipelineId, setSelectedPipelineId] = useState(() => {
    return localStorage.getItem('agentflow_selected_pipeline') ?? '';
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showRoutines, setShowRoutines] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsPipelineRef = useRef<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [contentView, setContentView] =
    useState<PipelineContentView>('board');
  const [statusFilter, setStatusFilter] = useState<TaskFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [banner, setBanner] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [archiveDoneTargetId, setArchiveDoneTargetId] = useState<string | null>(
    null,
  );
  const [isSwitchingPipeline, startPipelineTransition] = useTransition();

  const pipeline =
    pipelines.find((item) => item.id === selectedPipelineId) ??
    (pipelines.length > 0 ? pipelines[0] : undefined);
  const selectedTask = pipeline?.tasks.find((task) => task.id === selectedTaskId) ?? null;

  useEffect(() => {
    if (!pipeline?.id) return;

    if (pipeline.id !== selectedPipelineId) {
      setSelectedPipelineId(pipeline.id);
    }
  }, [pipeline?.id, selectedPipelineId]);

  useEffect(() => {
    if (!selectedPipelineId) return;
    localStorage.setItem('agentflow_selected_pipeline', selectedPipelineId);
  }, [selectedPipelineId]);

  // Lazy-load logs when panel is opened
  useEffect(() => {
    if (!showLogs || !pipeline?.id) {
      setLogs([]);
      logsPipelineRef.current = null;
      return;
    }

    let cancelled = false;
    const load = async () => {
      try {
        const data = await api.fetchLogs(pipeline.id);
        if (!cancelled) {
          setLogs(data);
          logsPipelineRef.current = pipeline.id;
        }
      } catch {
        // ignore — panel just stays empty
      }
    };

    // Fetch immediately and poll every 5s while open
    load();
    const interval = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [showLogs, pipeline?.id]);

  const filteredTasks = useMemo(() => {
    if (!pipeline) return [];
    let tasks = pipeline.tasks;

    if (statusFilter !== 'all') {
      tasks = tasks.filter((t) => t.status === statusFilter);
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      tasks = tasks.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          (t.input && t.input.toLowerCase().includes(q)),
      );
    }

    return tasks;
  }, [pipeline, statusFilter, searchQuery]);

  const selectPipeline = useCallback((pipelineId: string) => {
    startPipelineTransition(() => {
      setSelectedPipelineId(pipelineId);
      setSelectedTaskId(null);
      setShowAddTask(false);
      setShowSettings(false);
      setContentView('board');
      setStatusFilter('all');
      setSearchQuery('');
    });
  }, []);

  const handleTaskSelect = useCallback((taskId: string) => {
    setSelectedTaskId((current) => (current === taskId ? null : taskId));
    setShowAddTask(false);
    setShowSettings(false);
  }, []);

  const handleOpenTask = useCallback(
    async (taskId: string) => {
      if (!pipeline) return;

      const localTask = pipeline.tasks.find((task) => task.id === taskId);
      if (localTask) {
        setSelectedTaskId(taskId);
        setShowAddTask(false);
        setShowSettings(false);
        return;
      }

      try {
        const archivedTasks = await api.fetchArchivedTasks(pipeline.id);
        const archivedTask = archivedTasks.find((task) => task.id === taskId);

        if (archivedTask) {
          await unarchiveTask(taskId);
          setSelectedTaskId(taskId);
          setShowArchived(false);
          setBanner(
            `Restored archived parent task "${archivedTask.name}".`,
          );
          setTimeout(() => setBanner(null), 8000);
          return;
        }
      } catch {
        // Fall through to the user-facing banner below.
      }

      setBanner('Parent task is no longer available.');
      setTimeout(() => setBanner(null), 8000);
    },
    [pipeline, unarchiveTask],
  );

  const handleApprove = useCallback(
    async (taskId: string) => {
      if (!pipeline) return;
      await approveTask(pipeline.id, taskId);
    },
    [approveTask, pipeline],
  );

  const handleReject = useCallback(
    async (taskId: string) => {
      if (!pipeline) return;
      await rejectTask(pipeline.id, taskId);
    },
    [pipeline, rejectTask],
  );

  const handleAddTask = useCallback(
    async (task: Task, stagedFiles?: File[]) => {
      if (!pipeline) return;

      // Build dependsOn with conditions if any exist
      const dependsOn: (string | { taskId: string; condition: DependencyCondition | null })[] =
        task.dependsOn.map((depId) => {
          const cond = task.dependencyConditions?.[depId];
          return cond ? { taskId: depId, condition: cond } : depId;
        });

      const created = await addTask(pipeline.id, {
        name: task.name,
        agentId: task.agentId,
        model: task.model,
        approval: task.approval,
        stage: task.stage,
        dependsOn,
        input: task.input,
        priority: task.priority,
        timeoutMs: task.timeoutMs,
        tags: task.tags,
        useWorktree: task.useWorktree,
        branch: task.branch ?? null,
        autoRetry: task.autoRetry,
      });
      if (stagedFiles?.length && created) {
        await api.uploadFiles(stagedFiles, 'task', created.id, pipeline.id);
      }
      setShowAddTask(false);
    },
    [addTask, pipeline],
  );

  const handleBatchCreate = useCallback(
    async (batchTasks: Parameters<typeof batchAddTasks>[1]) => {
      if (!pipeline) return;

      await batchAddTasks(pipeline.id, batchTasks);
      setShowAddTask(false);
    },
    [batchAddTasks, pipeline],
  );

  const handleUpdateTask = useCallback(
    async (update: Partial<Task>) => {
      if (!selectedTaskId) return;
      await api.updateTask(selectedTaskId, update);
    },
    [selectedTaskId],
  );

  const handleArchive = useCallback(
    async (taskId: string) => {
      await archiveTask(taskId);
      if (selectedTaskId === taskId) setSelectedTaskId(null);
    },
    [archiveTask, selectedTaskId],
  );

  const handleSkip = useCallback(
    async (taskId: string) => {
      if (!pipeline) return;
      await moveTask(pipeline.id, taskId, 'skipped');
    },
    [moveTask, pipeline],
  );

  const handleDeletePipeline = useCallback(async () => {
    if (!deleteTargetId) return;

    const deletedPipelineId = deleteTargetId;
    setDeleteTargetId(null);

    if (selectedPipelineId === deletedPipelineId) {
      // Pre-select the next available pipeline before deleting
      const remaining = pipelines.filter((p) => p.id !== deletedPipelineId);
      setSelectedPipelineId(remaining.length > 0 ? remaining[0]!.id : '');
      setSelectedTaskId(null);
    }

    await removePipeline(deletedPipelineId);
  }, [deleteTargetId, pipelines, removePipeline, selectedPipelineId]);

  const renderMain = () => {
    if (pipelines.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center px-4">
          <EmptyState
            action={
              <button
                className="inline-flex h-9 items-center justify-center rounded-md border border-accent-orange bg-accent-orange px-4 font-mono text-xs font-medium text-black transition-colors hover:bg-accent-orange/85"
                onClick={onNewPipelineOpen}
                type="button"
              >
                + Create Pipeline
              </button>
            }
            description="Create your first pipeline to orchestrate multi-agent execution."
            title="No pipelines yet"
          />
        </div>
      );
    }

    if (!pipeline || isSwitchingPipeline) {
      return (
        <div className="flex flex-1 flex-col gap-3 p-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-full w-full" />
        </div>
      );
    }

    return (
      <>
        <PipelineHeader
          contentView={contentView}
          onAddTask={() => {
            setShowAddTask(true);
            setSelectedTaskId(null);
            setShowSettings(false);
          }}
          onPause={async () => pausePipeline(pipeline.id)}
          onRun={async () => {
            const blocked = await runPipeline(pipeline.id);
            if (blocked) {
              setBanner(blocked);
              setTimeout(() => setBanner(null), 8000);
            } else {
              setBanner(null);
            }
          }}
          onRoutines={() => {
            setShowRoutines(true);
            setSelectedTaskId(null);
            setShowAddTask(false);
            setShowSettings(false);
          }}
          onSettings={() => {
            setShowSettings(true);
            setSelectedTaskId(null);
            setShowAddTask(false);
          }}
          onToggleLogs={() => setShowLogs((current) => !current)}
          onToggleArchived={() => setShowArchived((current) => !current)}
          onArchiveAllDone={() => setArchiveDoneTargetId(pipeline.id)}
          onViewChange={setContentView}
          pipeline={pipeline}
          showLogs={showLogs}
          showArchived={showArchived}
          statusFilter={statusFilter}
          searchQuery={searchQuery}
          onStatusFilterChange={setStatusFilter}
          onSearchQueryChange={setSearchQuery}
        />

        {!selectedTask && (banner || actionError) && (() => {
          const isWarn = !!actionError;
          const borderColor = isWarn ? 'border-accent-amber/30' : 'border-accent-red/30';
          const bgColor = isWarn ? 'bg-accent-amber/10' : 'bg-accent-red/10';
          const textColor = isWarn ? 'text-accent-amber' : 'text-accent-red';
          return (
            <div className={`mx-4 mt-2 flex items-center gap-2 rounded border ${borderColor} ${bgColor} px-3 py-2`}>
              <span className={`font-mono text-xs ${textColor}`}>{actionError || banner}</span>
              <button
                className="ml-auto font-mono text-xs text-text-dim hover:text-text-primary"
                onClick={() => { setBanner(null); clearActionError(); }}
                type="button"
              >
                x
              </button>
            </div>
          );
        })()}

        {contentView === 'integration' ? (
          <PipelineIntegrationPanel
            onTaskSelect={(taskId) => void handleOpenTask(taskId)}
            pipeline={pipeline}
          />
        ) : (
          <PipelineView
            agents={agents}
            onAbort={abortTask}
            onApprove={handleApprove}
            onReject={handleReject}
            onRetry={retryTask}
            onStart={startTask}
            onSkip={handleSkip}
            onArchive={handleArchive}
            onTaskSelect={handleTaskSelect}
            selectedTaskId={selectedTaskId}
            stages={pipeline.stages}
            tasks={filteredTasks}
          />
        )}

        {showLogs && (
          <Suspense fallback={null}>
            <LogPanel logs={logs} onClose={() => setShowLogs(false)} />
          </Suspense>
        )}
        {showArchived && (
          <Suspense fallback={null}>
            <ArchivedTasksPanel
              pipelineId={pipeline.id}
              agents={agents}
              onClose={() => setShowArchived(false)}
              onUnarchive={async (taskId) => {
                await unarchiveTask(taskId);
              }}
            />
          </Suspense>
        )}
      </>
    );
  };

  return (
    <div className="relative flex flex-1 overflow-hidden">
      <PipelineSidebar
        onDelete={(id) => setDeleteTargetId(id)}
        onNewPipeline={onNewPipelineOpen}
        onPause={(id) => pausePipeline(id)}
        onRun={async (id) => {
          const blocked = await runPipeline(id);
          if (blocked) {
            setBanner(blocked);
            setTimeout(() => setBanner(null), 8000);
          }
        }}
        onSelect={selectPipeline}
        pipelines={pipelines}
        selectedId={selectedPipelineId}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{renderMain()}</div>

      {showAddTask && pipeline && (
        <Suspense fallback={null}>
          <AddTaskDrawer
            agents={agents}
            enabledAgentIds={pipeline.enabledAgents}
            onBatchCreate={handleBatchCreate}
            onClose={() => setShowAddTask(false)}
            onRunPipeline={async () => { await runPipeline(pipeline.id); }}
            onSingleCreate={handleAddTask}
            pipelineId={pipeline.id}
            tasks={pipeline.tasks}
          />
        </Suspense>
      )}

      {selectedTask && pipeline && (
        <Suspense fallback={null}>
          <TaskDrawer
            actionMessage={actionError}
            agents={agents}
            pipelineId={pipeline.id}
            onAbort={abortTask}
            onApprove={handleApprove}
            onArchive={handleArchive}
            onClose={() => setSelectedTaskId(null)}
            onDismissActionMessage={clearActionError}
            onDelete={async (taskId) => {
              await deleteTask(taskId);
              setSelectedTaskId(null);
            }}
            onReject={handleReject}
            onRetry={retryTask}
            onStart={startTask}
            onSkip={handleSkip}
            onOpenTask={(taskId) => void handleOpenTask(taskId)}
            onUpdate={handleUpdateTask}
            task={selectedTask}
            tasks={pipeline.tasks}
          />
        </Suspense>
      )}

      {showRoutines && pipeline && (
        <Suspense fallback={null}>
          <RoutinesDrawer
            agents={agents}
            enabledAgentIds={pipeline.enabledAgents}
            onClose={() => setShowRoutines(false)}
            pipelineId={pipeline.id}
          />
        </Suspense>
      )}

      {showSettings && pipeline && (
        <div className="absolute inset-y-0 right-0 z-50 flex">
          <Suspense fallback={null}>
            <PipelineSettingsDrawer
              onClose={() => setShowSettings(false)}
              onDelete={() => {
                setShowSettings(false);
                setDeleteTargetId(pipeline.id);
              }}
              onUpdated={() => setShowSettings(false)}
              pipeline={pipeline}
            />
          </Suspense>
        </div>
      )}

      {deleteTargetId && (() => {
        const target = pipelines.find((item) => item.id === deleteTargetId);
        if (!target) return null;

        return (
          <ConfirmDialog
            confirmLabel="Delete Pipeline"
            message={`Delete "${target.name}" and all related tasks and logs?`}
            onCancel={() => setDeleteTargetId(null)}
            onConfirm={handleDeletePipeline}
            title="Delete Pipeline"
            variant="danger"
          />
        );
      })()}

      {archiveDoneTargetId && (() => {
        const target = pipelines.find((item) => item.id === archiveDoneTargetId);
        if (!target) return null;

        const archiveableCount = target.tasks.filter(
          (task) =>
            task.status === 'completed'
            || task.status === 'failed'
            || task.status === 'rejected',
        ).length;

        return (
          <ConfirmDialog
            confirmLabel="Archive Done"
            message={`Archive ${archiveableCount} completed, failed, or rejected task(s) in "${target.name}"?`}
            onCancel={() => setArchiveDoneTargetId(null)}
            onConfirm={async () => {
              await archiveAllDone(target.id);
              setArchiveDoneTargetId(null);
            }}
            title="Archive Done Tasks"
            variant="primary"
          />
        );
      })()}

      {newPipelineOpen && (
        <NewPipelineModal
          agents={agentsLoading ? [] : agents}
          onClose={onNewPipelineClose}
          onCreate={async (pipelineData) => {
            const created = await addPipeline({
              name: pipelineData.name,
              description: pipelineData.description,
              rules: pipelineData.rules,
              enabledAgents: pipelineData.enabledAgents,
              workingDir: pipelineData.workingDir,
              gitBranch: pipelineData.gitBranch ?? null,
              stages: pipelineData.stages.map((stage, index) => ({
                name: stage.name,
                sortOrder: index,
                color: stage.color,
                maxParallel: stage.maxParallel,
              })),
              tasks: [],
            });
            // Set selected pipeline BEFORE closing modal to avoid blank state
            setSelectedPipelineId(created.id);
            // Use requestAnimationFrame to let state settle before closing
            requestAnimationFrame(() => {
              onNewPipelineClose();
            });
          }}
        />
      )}
    </div>
  );
}
