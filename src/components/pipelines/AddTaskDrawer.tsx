import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import type {
  Agent,
  Attachment,
  ApprovalMode,
  BreakdownPlan,
  BreakdownTaskPlan,
  DependencyCondition,
  ModelKey,
  Task,
  TaskPriority,
} from '@/types';
import { APPROVAL_MODES, PRESET_TAGS, PRIORITIES } from '@/constants';
import { useModels } from '@/context/ModelContext';
import * as api from '@/lib/api';
import { FileDropZone } from '@/components/atoms/FileDropZone';
import { AttachmentList } from '@/components/atoms/AttachmentList';
import { StagedFileChip } from '@/components/atoms/AttachmentChip';
import { ModelSelector } from '@/components/atoms/ModelSelector';
import {
  Badge,
  Button,
  Drawer,
  Input,
  Modal,
  Select,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@/components/ui';
import { ExecutionPlanView } from './ExecutionPlanView';
import { PlannerAttachments } from './PlannerAttachments';

interface AddTaskDrawerProps {
  agents: Agent[];
  enabledAgentIds: string[];
  tasks: Task[];
  pipelineId: string;
  onClose: () => void;
  onSingleCreate: (task: Task, stagedFiles?: File[]) => void;
  onBatchCreate: (tasks: {
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
  onRunPipeline?: () => Promise<void>;
}

const DEFAULT_TIMEOUT_MINUTES = 30;
type ManualWorkspaceMode = 'isolated_auto' | 'continue_task' | 'shared';

function StageSelect({
  onChange,
  value,
}: {
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {Array.from({ length: 8 }).map((_, index) => {
        const stage = index + 1;
        const isActive = value === index;

        return (
          <Button
            className="h-8 w-8 px-0"
            key={stage}
            onClick={() => onChange(index)}
            size="sm"
            variant={isActive ? 'primary' : 'secondary'}
          >
            {stage}
          </Button>
        );
      })}
    </div>
  );
}

function PlanTaskCard({
  task,
  index,
  availableAgents,
  allTasks,
  onUpdate,
  onRemove,
}: {
  task: BreakdownTaskPlan;
  index: number;
  availableAgents: Agent[];
  allTasks: BreakdownTaskPlan[];
  onUpdate: (index: number, updates: Partial<BreakdownTaskPlan>) => void;
  onRemove: (index: number) => void;
}) {
  const { getModel } = useModels();
  const [expanded, setExpanded] = useState(false);
  const agent = availableAgents.find((a) => a.id === task.agentId);
  const modelConf = getModel(task.model);

  return (
    <div className="rounded-md border border-border-secondary bg-surface-1">
      {/* Compact header — always visible */}
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((prev) => !prev)}
        type="button"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-orange/20 font-mono text-micro font-bold text-accent-orange">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
          {task.name}
        </span>
        <Badge size="sm" tone="neutral">S{task.stage + 1}</Badge>
        {modelConf && (
          <span
            className="shrink-0 rounded px-1.5 py-0.5 font-mono text-micro font-bold"
            style={{ color: modelConf.color, backgroundColor: modelConf.bg }}
          >
            {modelConf.label}
          </span>
        )}
        <Badge size="sm" tone="neutral">{agent?.name ?? '?'}</Badge>
        <span className="text-micro text-text-dim">{expanded ? '−' : '+'}</span>
      </button>

      {/* Expanded edit panel */}
      {expanded && (
        <div className="space-y-2 border-t border-border-primary px-3 py-2.5">
          {/* Name */}
          <Input
            aria-label="Task name"
            onChange={(e) => onUpdate(index, { name: e.target.value })}
            value={task.name}
          />

          {/* Agent + Model row */}
          <div className="grid grid-cols-2 gap-2">
            <Select
              aria-label="Agent"
              onChange={(e) => onUpdate(index, { agentId: e.target.value })}
              value={task.agentId}
            >
              {availableAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}{a.title ? ` — ${a.title}` : ''}
                </option>
              ))}
            </Select>
            <ModelSelector
              onChange={(model) => onUpdate(index, { model })}
              value={task.model}
            />
          </div>

          {/* Approval + Priority + Stage row */}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="mb-0.5 block font-mono text-micro uppercase text-text-muted">Approval</label>
              <Select
                aria-label="Approval"
                onChange={(e) => onUpdate(index, { approval: e.target.value as ApprovalMode })}
                value={task.approval}
              >
                {APPROVAL_MODES.map((mode) => (
                  <option key={mode} value={mode}>{mode.replace(/_/g, ' ')}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-0.5 block font-mono text-micro uppercase text-text-muted">Priority</label>
              <Select
                aria-label="Priority"
                onChange={(e) => {
                  const v = e.target.value;
                  onUpdate(index, { priority: v ? v as TaskPriority : null });
                }}
                value={task.priority ?? ''}
              >
                <option value="">None</option>
                {PRIORITIES.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </Select>
            </div>
            <div>
              <label className="mb-0.5 block font-mono text-micro uppercase text-text-muted">Stage</label>
              <Select
                aria-label="Stage"
                onChange={(e) => onUpdate(index, { stage: Number(e.target.value) })}
                value={String(task.stage)}
              >
                {Array.from({ length: 8 }).map((_, i) => (
                  <option key={i} value={String(i)}>Stage {i + 1}</option>
                ))}
              </Select>
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="mb-0.5 block font-mono text-micro uppercase text-text-muted">Tags</label>
            <div className="flex flex-wrap gap-1">
              {PRESET_TAGS.map((tag) => {
                const selected = task.tags.includes(tag);
                return (
                  <Button
                    className="h-5 px-1.5 text-micro"
                    key={tag}
                    onClick={() => {
                      const next = selected
                        ? task.tags.filter((t) => t !== tag)
                        : [...task.tags, tag];
                      onUpdate(index, { tags: next });
                    }}
                    size="sm"
                    variant={selected ? 'primary' : 'secondary'}
                  >
                    {tag}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Dependencies */}
          {allTasks.length > 1 && (
            <div>
              <label className="mb-0.5 block font-mono text-micro uppercase text-text-muted">Depends on</label>
              <div className="flex flex-wrap gap-1">
                {allTasks.map((other, otherIdx) => {
                  if (otherIdx === index) return null;
                  const selected = task.dependsOn.includes(otherIdx);
                  return (
                    <Button
                      className="h-5 px-1.5 text-micro"
                      key={otherIdx}
                      onClick={() => {
                        const next = selected
                          ? task.dependsOn.filter((d) => d !== otherIdx)
                          : [...task.dependsOn, otherIdx];
                        onUpdate(index, { dependsOn: next });
                      }}
                      size="sm"
                      variant={selected ? 'primary' : 'secondary'}
                    >
                      {otherIdx + 1}. {other.name || `Task ${otherIdx + 1}`}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Input prompt */}
          <div>
            <label className="mb-0.5 block font-mono text-micro uppercase text-text-muted">Input prompt</label>
            <Textarea
              onChange={(e) => onUpdate(index, { input: e.target.value })}
              rows={4}
              value={task.input}
            />
          </div>

          {/* Rationale (read-only) */}
          {task.rationale && (
            <p className="text-micro italic leading-relaxed text-text-dim">
              {task.rationale}
            </p>
          )}

          {/* Remove */}
          <div className="flex justify-end">
            <Button
              className="h-6 px-2 text-micro"
              onClick={() => onRemove(index)}
              size="sm"
              variant="danger"
            >
              Remove Task
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function AddTaskDrawer({
  agents,
  enabledAgentIds,
  tasks,
  pipelineId,
  onClose,
  onSingleCreate,
  onBatchCreate,
  onRunPipeline,
}: AddTaskDrawerProps) {
  const [activeTab, setActiveTab] = useState<'manual' | 'planner'>('planner');
  const availableAgents = useMemo(() => {
    if (enabledAgentIds.length === 0) return agents;

    return agents.filter((agent) => enabledAgentIds.includes(agent.id));
  }, [agents, enabledAgentIds]);

  const [isPending, startTransition] = useTransition();
  const [manualName, setManualName] = useState('');
  const [manualAgentId, setManualAgentId] = useState(availableAgents[0]?.id ?? '');
  const [manualModel, setManualModel] = useState<ModelKey>(availableAgents[0]?.defaultModel ?? 'claude');
  const [manualApproval, setManualApproval] = useState<ApprovalMode>('auto');
  const [manualStage, setManualStage] = useState(0);
  const [manualPriority, setManualPriority] = useState<TaskPriority | null>(null);
  const [manualInput, setManualInput] = useState('');
  const [manualTags, setManualTags] = useState<string[]>([]);
  const [manualAutoRetry, setManualAutoRetry] = useState(true);
  const [manualWorkspaceMode, setManualWorkspaceMode] =
    useState<ManualWorkspaceMode>('isolated_auto');
  const [manualStartFromTaskId, setManualStartFromTaskId] = useState('');
  const [manualDependsOn, setManualDependsOn] = useState<string[]>([]);
  const [manualDepConditions, setManualDepConditions] = useState<Record<string, DependencyCondition | null>>({});
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  const [plannerAttachments, setPlannerAttachments] = useState<Attachment[]>([]);
  const [plannerAttachmentIds, setPlannerAttachmentIds] = useState<string[]>([]);
  const [plannerDescription, setPlannerDescription] = useState('');
  const [plannerAgents, setPlannerAgents] = useState<string[]>(() => {
    return availableAgents.map((agent) => agent.id);
  });
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerError, setPlannerError] = useState<string | null>(null);
  const [plannerPlan, setPlannerPlan] = useState<BreakdownPlan | null>(null);
  const [plannerPlanAttachmentIds, setPlannerPlanAttachmentIds] = useState<string[]>([]);
  const [plannerAutoRun, setPlannerAutoRun] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [plannerStream, setPlannerStream] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const streamEndRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const plannedContextAttachments = useMemo(
    () =>
      plannerPlanAttachmentIds
        .map((attachmentId) =>
          plannerAttachments.find((attachment) => attachment.id === attachmentId),
        )
        .filter((attachment): attachment is Attachment => Boolean(attachment)),
    [plannerAttachments, plannerPlanAttachmentIds],
  );

  // Load draft on mount
  useEffect(() => {
    let cancelled = false;
    api.fetchBreakdownDraft(pipelineId).then((draft) => {
      if (cancelled || !draft) return;
      setPlannerDescription(draft.description);
      setPlannerAgents(draft.selectedAgents);
      if (draft.plan) setPlannerPlan(draft.plan);
      setDraftLoaded(true);
      setActiveTab('planner');
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [pipelineId]);

  // Load all pipeline attachments (task + pipeline scoped) on mount
  useEffect(() => {
    let cancelled = false;
    api.listAllPipelineAttachments(pipelineId).then((atts) => {
      if (cancelled) return;
      setPlannerAttachments(atts);
      setPlannerAttachmentIds((prev) =>
        prev.filter((attachmentId) => atts.some((attachment) => attachment.id === attachmentId)),
      );
    }).catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [pipelineId]);

  // Save draft after plan changes
  const saveDraft = useCallback((plan: BreakdownPlan | null, description: string, agents: string[]) => {
    api.saveBreakdownDraft(pipelineId, {
      description,
      selectedAgents: agents,
      plan,
    }).catch(() => { /* ignore */ });
  }, [pipelineId]);

  useEffect(() => {
    if (availableAgents.length === 0) return;

    setManualAgentId((prev) => {
      if (!prev || !availableAgents.some((agent) => agent.id === prev)) {
        return availableAgents[0]?.id ?? '';
      }

      return prev;
    });

    setPlannerAgents((prev) => {
      if (prev.length > 0) {
        return prev.filter((agentId) => availableAgents.some((agent) => agent.id === agentId));
      }

      return availableAgents.map((agent) => agent.id);
    });
  }, [availableAgents]);

  useEffect(() => {
    const selectedAgent = availableAgents.find((agent) => agent.id === manualAgentId);
    if (!selectedAgent) return;

    setManualModel(selectedAgent.defaultModel);
  }, [availableAgents, manualAgentId]);

  useEffect(() => {
    if (
      manualStartFromTaskId &&
      !tasks.some((task) => task.id === manualStartFromTaskId)
    ) {
      setManualStartFromTaskId('');
    }
  }, [manualStartFromTaskId, tasks]);

  const togglePlannerAgent = (agentId: string) => {
    setPlannerAgents((prev) => {
      if (prev.includes(agentId)) {
        return prev.filter((id) => id !== agentId);
      }

      return [...prev, agentId];
    });
  };

  const handleManualSubmit = () => {
    // Auto-generate name from input if not provided
    let finalName = manualName.trim();
    if (!finalName && manualInput.trim()) {
      finalName = manualInput.trim()
        .slice(0, 60)
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .toLowerCase()
        .replace(/-+$/, '');
    }

    if (!finalName) {
      setFormError('Task name or input is required.');
      return;
    }

    if (!manualAgentId) {
      setFormError('Select an agent.');
      return;
    }

    if (
      manualWorkspaceMode === 'continue_task' &&
      !manualStartFromTaskId
    ) {
      setFormError('Choose which task this work should continue from.');
      return;
    }

    setFormError(null);

    const finalDependsOn = [...manualDependsOn];
    if (
      manualWorkspaceMode === 'continue_task' &&
      manualStartFromTaskId &&
      !finalDependsOn.includes(manualStartFromTaskId)
    ) {
      finalDependsOn.push(manualStartFromTaskId);
    }

    const useWorktree = manualWorkspaceMode !== 'shared';
    const branch = manualWorkspaceMode === 'continue_task' &&
      manualStartFromTaskId
      ? `task/${manualStartFromTaskId}`
      : null;

    // Build dependency conditions map (only entries with actual conditions)
    const depConditions: Record<string, DependencyCondition> = {};
    for (const depId of finalDependsOn) {
      const cond = manualDepConditions[depId];
      if (cond) {
        depConditions[depId] = cond;
      }
    }

    startTransition(() => {
      onSingleCreate(
        {
          id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: finalName,
          agentId: manualAgentId,
          model: manualModel,
          approval: manualApproval,
          status: 'queued',
          stage: manualStage,
          dependsOn: finalDependsOn,
          ...(Object.keys(depConditions).length > 0 && { dependencyConditions: depConditions }),
          input: manualInput,
          output: null,
          tokens: null,
          duration: null,
          priority: manualPriority,
          timeoutMs: DEFAULT_TIMEOUT_MINUTES * 60_000,
          tags: manualTags,
          taskType: 'seeded',
          sourceTaskId: null,
          stageId: null,
          createdAt: null,
          worktreePath: null,
          worktreeStatus: null,
          useWorktree,
          branch,
          autoRetry: manualAutoRetry || undefined,
        },
        stagedFiles.length > 0 ? stagedFiles : undefined,
      );
      // Reset form state for next open
      setManualDependsOn([]);
      setManualDepConditions({});
      setManualAutoRetry(false);
      setManualWorkspaceMode('isolated_auto');
      setManualStartFromTaskId('');
      onClose();
    });
  };

  const handlePlannerGenerate = async () => {
    if (!plannerDescription.trim()) {
      setPlannerError('Describe what you need first.');
      return;
    }

    if (plannerAgents.length === 0) {
      setPlannerError('Select at least one agent for planning.');
      return;
    }

    setPlannerError(null);
    setPlannerPlan(null);
    setPlannerPlanAttachmentIds([]);
    setPlannerStream('');
    setPlannerLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const attachmentIdsForPlan = [...plannerAttachmentIds];

    try {
      await api.streamBreakdown(
        {
          description: plannerDescription.trim(),
          agentIds: plannerAgents,
          pipelineId,
          ...(attachmentIdsForPlan.length > 0 && { attachmentIds: attachmentIdsForPlan }),
        },
        {
          onChunk: (text) => {
            setPlannerStream((prev) => prev + text);
            // Auto-scroll to bottom
            requestAnimationFrame(() => {
              streamEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            });
          },
          onPlan: (plan) => {
            setPlannerPlan(plan);
            setPlannerPlanAttachmentIds(attachmentIdsForPlan);
            saveDraft(plan, plannerDescription.trim(), plannerAgents);
          },
          onError: (message) => {
            setPlannerError(message);
          },
          onDone: () => {
            setPlannerLoading(false);
          },
        },
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      setPlannerError(error instanceof Error ? error.message : 'Failed to generate plan');
    } finally {
      setPlannerLoading(false);
      abortRef.current = null;
    }
  };

  const handlePlannerAbort = () => {
    abortRef.current?.abort();
    setPlannerLoading(false);
  };

  const handlePlannerCreate = async () => {
    if (!plannerPlan || plannerPlan.tasks.length === 0) {
      setPlannerError('The planner did not generate any tasks to create.');
      return;
    }

    setPlannerError(null);

    try {
      await onBatchCreate(
        plannerPlan.tasks.map((task) => ({
          name: task.name,
          agentId: task.agentId,
          model: task.model,
          approval: task.approval,
          stage: task.stage,
          dependsOnIndices: task.dependsOn,
          input: task.input,
          priority: task.priority,
          timeoutMs: DEFAULT_TIMEOUT_MINUTES * 60_000,
          tags: task.tags,
        })),
      );

      await api.deleteBreakdownDraft(pipelineId).catch(() => { /* ignore */ });

      if (plannerAutoRun && onRunPipeline) {
        await onRunPipeline();
      }

      onClose();
    } catch (error) {
      setPlannerError(error instanceof Error ? error.message : 'Failed to create plan tasks');
    }
  };

  return (
    <Drawer
      description={`Pipeline ID: ${pipelineId}`}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
      title="Add Task"
      widthClassName="w-[640px] max-w-[96vw]"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose} variant="ghost">
            Cancel
          </Button>
          {activeTab === 'manual' && (
            <Button disabled={isPending} onClick={handleManualSubmit} variant="primary">
              {isPending ? 'Adding...' : 'Add Task'}
            </Button>
          )}
        </div>
      }
    >
      <Tabs
        onValueChange={(value) => {
          if (value === 'manual' || value === 'planner') {
            setActiveTab(value);
          }
        }}
        value={activeTab}
      >
        <TabsList className="mb-4">
          <TabsTrigger value="planner">AI Planner</TabsTrigger>
          <TabsTrigger value="manual">Manual</TabsTrigger>
        </TabsList>

        <TabsContent value="manual">
          <div className="space-y-4">
            {formError && (
              <div className="rounded-md border border-accent-red/40 bg-accent-red-bg px-3 py-2 text-xs text-accent-red">
                {formError}
              </div>
            )}

            <section aria-labelledby="add-task-details" className="space-y-2">
              <h3 className="font-mono text-caption font-semibold tracking-[0.1em] text-text-secondary uppercase" id="add-task-details">
                Task Details
              </h3>
              <Input
                aria-label="Task name"
                onChange={(event) => setManualName(event.target.value)}
                placeholder="e.g. Implement pipeline redesign"
                value={manualName}
              />

              <div className="overflow-hidden rounded-md border border-border-secondary focus-within:border-accent-orange/60">
                <Textarea
                  aria-label="Task input"
                  className="rounded-none border-0 focus:ring-0"
                  onChange={(event) => setManualInput(event.target.value)}
                  placeholder="What should this task do?"
                  rows={6}
                  value={manualInput}
                />
                <div className="flex min-h-[32px] flex-wrap items-center gap-1.5 border-t border-border-secondary bg-surface-1 px-2 py-1">
                  <FileDropZone
                    compact
                    onFiles={(files) => setStagedFiles((prev) => [...prev, ...files])}
                  />
                  {stagedFiles.map((file, idx) => (
                    <StagedFileChip
                      key={`${file.name}-${idx}`}
                      file={file}
                      onRemove={() => setStagedFiles((prev) => prev.filter((_, i) => i !== idx))}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {PRESET_TAGS.map((tag) => {
                  const selected = manualTags.includes(tag);
                  return (
                    <Button
                      className="h-7 px-2 text-micro"
                      key={tag}
                      onClick={() => {
                        setManualTags((prev) => {
                          if (selected) return prev.filter((item) => item !== tag);
                          return [...prev, tag];
                        });
                      }}
                      variant={selected ? 'primary' : 'secondary'}
                    >
                      {tag}
                    </Button>
                  );
                })}
              </div>

              <Select
                aria-label="Agent"
                onChange={(event) => setManualAgentId(event.target.value)}
                value={manualAgentId}
              >
                {availableAgents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}{agent.title ? ` — ${agent.title}` : ''}
                  </option>
                ))}
              </Select>

              <ModelSelector
                onChange={(model) => setManualModel(model)}
                value={manualModel}
              />

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block font-mono text-micro uppercase tracking-wide text-text-muted">
                    Approval
                  </label>
                  <Select
                    aria-label="Approval mode"
                    onChange={(event) => setManualApproval(event.target.value as ApprovalMode)}
                    value={manualApproval}
                  >
                    {APPROVAL_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block font-mono text-micro uppercase tracking-wide text-text-muted">
                    Priority
                  </label>
                  <Select
                    aria-label="Priority"
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setManualPriority(nextValue ? (nextValue as TaskPriority) : null);
                    }}
                    value={manualPriority ?? ''}
                  >
                    <option value="">No priority</option>
                    {PRIORITIES.map((priority) => (
                      <option key={priority.key} value={priority.key}>
                        {priority.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block font-mono text-micro uppercase tracking-wide text-text-muted">
                    Work mode
                  </label>
                  <Select
                    aria-label="Workspace mode"
                    onChange={(event) => {
                      setManualWorkspaceMode(
                        event.target.value as ManualWorkspaceMode,
                      );
                    }}
                    value={manualWorkspaceMode}
                  >
                    <option value="isolated_auto">Isolated (auto)</option>
                    <option value="continue_task">Continue another task</option>
                    <option value="shared">Shared workspace</option>
                  </Select>
                  <p className="mt-1 text-micro text-text-dim">
                    Choose whether this task starts fresh, continues another
                    code line, or runs in the shared project workspace.
                  </p>
                </div>

                {manualWorkspaceMode === 'continue_task' && (
                  <div>
                    <label className="mb-1 block font-mono text-micro uppercase tracking-wide text-text-muted">
                      Starts from
                    </label>
                    <Select
                      aria-label="Start from task"
                      onChange={(event) =>
                        setManualStartFromTaskId(event.target.value)
                      }
                      value={manualStartFromTaskId}
                    >
                      <option value="">Select task</option>
                      {tasks.map((task) => (
                        <option key={task.id} value={task.id}>
                          {task.name}
                        </option>
                      ))}
                    </Select>
                    <p className="mt-1 text-micro text-text-dim">
                      This also adds the selected task as a dependency if needed.
                    </p>
                  </div>
                )}
              </div>

              <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                <input
                  checked={manualAutoRetry}
                  className="accent-accent-orange"
                  onChange={(event) => setManualAutoRetry(event.target.checked)}
                  type="checkbox"
                />
                <span>Retry on failure <span className="text-text-dim">(auto-retry with error feedback)</span></span>
              </label>
            </section>

            {/* Dependencies — collapsible */}
            {tasks.length > 0 && (
              <details className="group rounded-md border border-border-secondary">
                <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 font-mono text-caption font-semibold uppercase tracking-[0.1em] text-text-secondary select-none">
                  <span className="text-micro text-text-dim transition-transform group-open:rotate-90">&#9654;</span>
                  Dependencies
                  {manualDependsOn.length > 0 && (
                    <span className="rounded-full bg-accent-orange/20 px-1.5 py-0.5 font-mono text-micro font-bold text-accent-orange">
                      {manualDependsOn.length}
                    </span>
                  )}
                </summary>
                <div className="max-h-[200px] space-y-2 overflow-y-auto border-t border-border-secondary px-3 py-2">
                  {tasks.map((t) => {
                    const selected = manualDependsOn.includes(t.id);
                    return (
                      <div key={t.id} className="space-y-1.5">
                        <label className="flex items-center gap-2 text-xs text-text-secondary">
                          <input
                            checked={selected}
                            className="accent-accent-orange"
                            onChange={() => {
                              setManualDependsOn((prev) => {
                                if (selected) {
                                  setManualDepConditions((c) => {
                                    const next = { ...c };
                                    delete next[t.id];
                                    return next;
                                  });
                                  return prev.filter((id) => id !== t.id);
                                }
                                return [...prev, t.id];
                              });
                            }}
                            type="checkbox"
                          />
                          <span className="truncate">{t.name}</span>
                        </label>
                        {selected && (
                          <div className="ml-6 flex flex-wrap items-center gap-2">
                            <select
                              aria-label={`Condition for ${t.name}`}
                              className="h-7 rounded border border-border-default bg-surface-2 px-2 text-caption text-text-base"
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === 'none') {
                                  setManualDepConditions((c) => {
                                    const next = { ...c };
                                    delete next[t.id];
                                    return next;
                                  });
                                } else if (v === 'status') {
                                  setManualDepConditions((c) => ({
                                    ...c,
                                    [t.id]: { type: 'status', value: 'completed' },
                                  }));
                                } else {
                                  setManualDepConditions((c) => ({
                                    ...c,
                                    [t.id]: { type: v as DependencyCondition['type'], value: '' },
                                  }));
                                }
                              }}
                              value={manualDepConditions[t.id]?.type ?? 'none'}
                            >
                              <option value="none">No condition</option>
                              <option value="contains">Output contains</option>
                              <option value="not_contains">Output doesn't contain</option>
                              <option value="regex">Output matches regex</option>
                              <option value="status">Only if succeeded</option>
                            </select>
                            {manualDepConditions[t.id] &&
                              manualDepConditions[t.id]!.type !== 'status' && (
                              <input
                                aria-label={`Condition value for ${t.name}`}
                                className="h-7 flex-1 rounded border border-border-default bg-surface-2 px-2 text-caption text-text-base"
                                onChange={(e) => {
                                  setManualDepConditions((c) => ({
                                    ...c,
                                    [t.id]: { ...c[t.id]!, value: e.target.value },
                                  }));
                                }}
                                placeholder={
                                  manualDepConditions[t.id]!.type === 'regex'
                                    ? 'e.g. success|done'
                                    : 'e.g. success'
                                }
                                value={manualDepConditions[t.id]!.value}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

          </div>
        </TabsContent>

        <TabsContent value="planner">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <h3 className="font-mono text-caption font-semibold tracking-[0.1em] text-text-secondary uppercase">
                AI Plan
              </h3>
              {draftLoaded && (
                <Badge size="sm" tone="warning">Draft restored</Badge>
              )}
            </div>
            <Textarea
              disabled={plannerLoading}
              onBlur={() => {
                if (plannerDescription.trim()) {
                  saveDraft(plannerPlan, plannerDescription.trim(), plannerAgents);
                }
              }}
              onChange={(event) => setPlannerDescription(event.target.value)}
              placeholder="Describe what should be split into multiple tasks..."
              rows={10}
              value={plannerDescription}
            />

            <PlannerAttachments
              attachments={plannerAttachments}
              disabled={plannerLoading}
              onAttachmentsChange={setPlannerAttachments}
              onSelectedAttachmentIdsChange={setPlannerAttachmentIds}
              pipelineId={pipelineId}
              selectedAttachmentIds={plannerAttachmentIds}
            />

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {availableAgents.map((agent) => {
                const selected = plannerAgents.includes(agent.id);
                return (
                  <button
                    aria-pressed={selected}
                    className={`rounded-md border px-2.5 py-2 text-left text-xs transition-colors ${
                      selected
                        ? 'border-accent-orange/45 bg-accent-orange-bg text-accent-orange'
                        : 'border-border-secondary bg-surface-1 text-text-secondary hover:border-border-hover'
                    }`}
                    disabled={plannerLoading}
                    key={agent.id}
                    onClick={() => togglePlannerAgent(agent.id)}
                    type="button"
                  >
                    {agent.name}{agent.title ? ` — ${agent.title}` : ''}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              {plannerLoading ? (
                <Button onClick={handlePlannerAbort} variant="danger">
                  Stop
                </Button>
              ) : (
                <Button onClick={handlePlannerGenerate} variant="primary">
                  Generate Plan
                </Button>
              )}
              {plannerPlan && (
                <label className="inline-flex items-center gap-2 text-xs text-text-secondary">
                  <input
                    checked={plannerAutoRun}
                    className="accent-accent-orange"
                    onChange={(event) => setPlannerAutoRun(event.target.checked)}
                    type="checkbox"
                  />
                  Auto-run after create
                </label>
              )}
            </div>

            {plannerError && (
              <div className="rounded-md border border-accent-red/40 bg-accent-red-bg px-3 py-2 text-xs text-accent-red">
                {plannerError}
              </div>
            )}

            {/* Live stream output */}
            {(plannerLoading || plannerStream) && !plannerPlan && (
              <div className="rounded-md border border-border-secondary bg-surface-1 p-3">
                <p className="mb-2 font-mono text-micro text-text-dim uppercase">
                  {plannerLoading ? 'Generating execution plan...' : 'Stream output'}
                </p>
                <div className="max-h-[200px] overflow-auto rounded bg-surface-0 p-2">
                  <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-5 text-text-secondary">
                    {plannerStream || 'Waiting for response...'}
                    {plannerLoading && (
                      <span className="ml-1 inline-block animate-pulse text-accent-blue">_</span>
                    )}
                  </pre>
                  <div ref={streamEndRef} />
                </div>
              </div>
            )}

            {plannerPlan && (
              <>
                {/* Plan summary */}
                <div className="rounded-md border border-border-secondary bg-surface-1 p-3">
                  <p className="font-mono text-micro text-text-dim uppercase">Plan Summary</p>
                  <p className="mt-1 text-xs text-text-secondary">{plannerPlan.summary}</p>
                  {plannerPlan.reasoning && (
                    <p className="mt-2 text-caption text-text-dim">{plannerPlan.reasoning}</p>
                  )}
                  {plannedContextAttachments.length > 0 && (
                    <div className="mt-3 border-t border-border-primary pt-3">
                      <p className="font-mono text-micro uppercase text-text-dim">
                        Planner Context
                      </p>
                      <p className="mt-1 text-micro text-text-dim">
                        These files were included with the breakdown request.
                      </p>
                      <AttachmentList
                        attachments={plannedContextAttachments}
                        className="mt-2"
                      />
                    </div>
                  )}
                </div>

                {/* Editable task cards */}
                <div className="space-y-2">
                  <p className="font-mono text-micro text-text-dim uppercase">
                    {plannerPlan.tasks.length === 0
                      ? 'No Tasks Generated'
                      : `${plannerPlan.tasks.length} Tasks — click to configure`}
                  </p>
                  {plannerPlan.tasks.length === 0 && (
                    <div className="rounded-md border border-dashed border-border-secondary bg-surface-0/45 px-3 py-4 text-center">
                      <p className="font-mono text-[11px] uppercase tracking-wide text-text-dim">
                        Planner returned an informational plan only.
                      </p>
                      <p className="mt-1 text-xs text-text-secondary">
                        You can adjust the prompt and regenerate, or add a task manually below.
                      </p>
                    </div>
                  )}
                  {plannerPlan.tasks.map((task, index) => (
                    <PlanTaskCard
                      allTasks={plannerPlan.tasks}
                      availableAgents={availableAgents}
                      index={index}
                      key={`${task.name}-${index}`}
                      onRemove={(i) => {
                        setPlannerPlan((prev) => {
                          if (!prev) return prev;
                          const next = [...prev.tasks];
                          next.splice(i, 1);
                          // Re-index dependsOn references
                          const remapped = next.map((t) => ({
                            ...t,
                            dependsOn: t.dependsOn
                              .map((d) => (d > i ? d - 1 : d === i ? -1 : d))
                              .filter((d) => d >= 0),
                          }));
                          return { ...prev, tasks: remapped };
                        });
                      }}
                      onUpdate={(i, updates) => {
                        setPlannerPlan((prev) => {
                          if (!prev) return prev;
                          const next = [...prev.tasks];
                          next[i] = { ...next[i]!, ...updates };
                          return { ...prev, tasks: next };
                        });
                      }}
                      task={task}
                    />
                  ))}
                  <Button
                    className="w-full border border-dashed border-border-secondary text-text-dim hover:border-accent-orange hover:text-accent-orange"
                    onClick={() => {
                      setPlannerPlan((prev) => {
                        if (!prev) return prev;
                        const newTask: BreakdownTaskPlan = {
                          name: '',
                          agentId: availableAgents[0]?.id ?? '',
                          model: availableAgents[0]?.defaultModel ?? 'claude',
                          approval: 'auto',
                          stage: prev.tasks.length > 0
                            ? prev.tasks[prev.tasks.length - 1]!.stage
                            : 0,
                          dependsOn: [],
                          input: '',
                          rationale: '',
                          priority: null,
                          tags: [],
                          taskType: 'seeded',
                        };
                        return { ...prev, tasks: [...prev.tasks, newTask] };
                      });
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    + Add Task
                  </Button>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between">
                  <Button
                    className="h-7 px-2 text-micro"
                    onClick={() => setShowPlanModal(true)}
                    variant="secondary"
                  >
                    View Execution Plan
                  </Button>
                  <Button
                    disabled={plannerPlan.tasks.length === 0}
                    onClick={handlePlannerCreate}
                    variant="primary"
                  >
                    {plannerPlan.tasks.length === 0
                      ? 'No Tasks To Create'
                      : `Create ${plannerPlan.tasks.length} Tasks`}
                  </Button>
                </div>

                <Modal
                  className="max-w-[90vw] sm:max-w-[800px]"
                  onOpenChange={setShowPlanModal}
                  open={showPlanModal}
                  title="Execution Plan"
                  description={plannerPlan.tasks.length === 0
                    ? 'No executable tasks were generated for this request.'
                    : `${plannerPlan.tasks.length} tasks across ${new Set(plannerPlan.tasks.map((t) => t.stage)).size} stages`}
                >
                  <ExecutionPlanView
                    agents={availableAgents}
                    contextAttachments={plannedContextAttachments}
                    tasks={plannerPlan.tasks}
                  />
                </Modal>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </Drawer>
  );
}
