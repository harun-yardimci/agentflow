import type {
  Agent,
  Attachment,
  BreakdownPlan,
  ControlRequest,
  ConversationMessage,
  DependencyCondition,
  ExecutionRun,
  LogEntry,
  Pipeline,
  PipelineStage,
  Task,
  TaskCycle,
  UsageAnalytics,
} from '@/types';

const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

async function parseErrorResponse(res: Response): Promise<Error> {
  const body = await res
    .json()
    .catch(() => ({ error: res.statusText })) as { error?: string };
  return new Error(body.error ?? `HTTP ${res.status}`);
}

// Pipelines
export const fetchPipelines = () => request<Pipeline[]>('/pipelines');
export const fetchPipeline = (id: string) => request<Pipeline>(`/pipelines/${id}`);
export const createPipeline = (data: {
  name: string;
  description?: string;
  rules?: string;
  enabledAgents?: string[];
  workingDir: string;
  gitBranch?: string | null;
  stages?: { name: string; sortOrder: number; color?: string; maxParallel?: number }[];
  tasks?: { name: string; agentId: string; model: string; approval: string; stage: number; dependsOn: string[]; input: string }[];
}) =>
  request<Pipeline>('/pipelines', { method: 'POST', body: JSON.stringify(data) });
export const updatePipeline = (id: string, data: { name?: string; status?: string; description?: string; rules?: string; enabledAgents?: string[]; workingDir?: string; gitBranch?: string | null }) =>
  request<Pipeline>(`/pipelines/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deletePipeline = (id: string) =>
  request<{ deleted: boolean }>(`/pipelines/${id}`, { method: 'DELETE' });

// Pipeline Stages
export const fetchStages = (pipelineId: string) =>
  request<PipelineStage[]>(`/pipelines/${pipelineId}/stages`);
export const createStage = (pipelineId: string, data: { name: string; sortOrder: number; color?: string; maxParallel?: number }) =>
  request<PipelineStage>(`/pipelines/${pipelineId}/stages`, { method: 'POST', body: JSON.stringify(data) });
export const updateStage = (pipelineId: string, stageId: string, data: Partial<PipelineStage>) =>
  request<PipelineStage>(`/pipelines/${pipelineId}/stages/${stageId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteStage = (pipelineId: string, stageId: string) =>
  request<{ deleted: boolean }>(`/pipelines/${pipelineId}/stages/${stageId}`, { method: 'DELETE' });

// Tasks
export const fetchTasks = (pipelineId: string) => request<Task[]>(`/pipelines/${pipelineId}/tasks`);
export const createTask = (
  pipelineId: string,
  data: {
    name: string;
    agentId: string;
    model: string;
    approval: string;
    stage: number;
    dependsOn: (string | { taskId: string; condition: DependencyCondition | null })[];
    input: string;
    priority?: string | null;
    timeoutMs?: number;
    tags?: string[];
    useWorktree?: boolean;
    branch?: string | null;
    autoRetry?: boolean;
  }
) =>
  request<Task>(`/pipelines/${pipelineId}/tasks`, { method: 'POST', body: JSON.stringify(data) });
export const updateTask = (taskId: string, data: Partial<Task>) =>
  request<Task>(`/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteTask = (taskId: string) =>
  request<{ deleted: boolean }>(`/tasks/${taskId}`, { method: 'DELETE' });
export const moveTask = (taskId: string, status: string) =>
  request<{ task: Task; cascaded: string[] }>(`/tasks/${taskId}/move`, { method: 'POST', body: JSON.stringify({ status }) });
export const approveTask = (taskId: string) =>
  request<Task>(`/tasks/${taskId}/approve`, { method: 'POST' });
export const rejectTask = (taskId: string) =>
  request<Task>(`/tasks/${taskId}/reject`, { method: 'POST' });
export const archiveTask = (taskId: string) =>
  request<Task>(`/tasks/${taskId}/archive`, { method: 'POST' });
export const unarchiveTask = (taskId: string) =>
  request<Task>(`/tasks/${taskId}/unarchive`, { method: 'POST' });
export const fetchArchivedTasks = (pipelineId: string) =>
  request<Task[]>(`/pipelines/${pipelineId}/tasks/archived`);
export const archiveAllDone = (pipelineId: string) =>
  request<{ archived: number }>(`/pipelines/${pipelineId}/tasks/archive-all`, { method: 'POST' });

// Breakdown
export interface BreakdownRequest {
  description: string;
  agentIds: string[];
  model?: string;
  attachmentIds?: string[];
  pipelineId?: string;
}

export const generateBreakdown = (data: BreakdownRequest) =>
  request<BreakdownPlan>('/breakdown', { method: 'POST', body: JSON.stringify(data) });
export const batchCreateTasks = (
  pipelineId: string,
  tasks: {
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
  }[]
) =>
  request<Task[]>(`/pipelines/${pipelineId}/tasks/batch`, { method: 'POST', body: JSON.stringify({ tasks }) });

// Streaming Breakdown (SSE)
export interface BreakdownStreamCallbacks {
  onChunk: (text: string) => void;
  onPlan: (plan: BreakdownPlan) => void;
  onError: (message: string) => void;
  onDone: () => void;
}

export async function streamBreakdown(
  data: BreakdownRequest,
  callbacks: BreakdownStreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/breakdown/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    signal,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error('ReadableStream not supported');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let currentEvent = '';
  let dataLines: string[] = [];
  let doneReceived = false;

  const dispatchEvent = () => {
    if (!currentEvent && dataLines.length === 0) return;

    const eventName = currentEvent || 'message';
    const rawData = dataLines.join('\n');

    let payload: Record<string, unknown> = {};
    if (rawData) {
      try {
        payload = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        payload = { text: rawData };
      }
    }

    switch (eventName) {
      case 'chunk':
        callbacks.onChunk(payload.text as string);
        break;
      case 'plan':
        callbacks.onPlan(payload as unknown as BreakdownPlan);
        break;
      case 'error':
        callbacks.onError(payload.message as string);
        break;
      case 'done':
        doneReceived = true;
        callbacks.onDone();
        break;
      default:
        break;
    }

    currentEvent = '';
    dataLines = [];
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      const rawLine = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (line === '') {
        dispatchEvent();
        newlineIndex = buffer.indexOf('\n');
        continue;
      }

      if (line.startsWith(':')) {
        newlineIndex = buffer.indexOf('\n');
        continue;
      }

      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
        newlineIndex = buffer.indexOf('\n');
        continue;
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
        newlineIndex = buffer.indexOf('\n');
        continue;
      }

      newlineIndex = buffer.indexOf('\n');
    }
  }

  if (buffer.trim().length > 0) {
    dataLines.push(buffer.trim());
  }
  dispatchEvent();

  if (!doneReceived) {
    callbacks.onDone();
  }
}

// Attachments
export async function uploadFiles(
  files: File[],
  targetType: 'task' | 'message' | 'pipeline',
  targetId: string,
  pipelineId: string,
): Promise<Attachment[]> {
  const formData = new FormData();
  for (const file of files) {
    formData.append('files', file);
  }
  formData.append('targetType', targetType);
  formData.append('targetId', targetId);
  formData.append('pipelineId', pipelineId);

  const res = await fetch(`${BASE}/uploads`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as { attachments: Attachment[] };
  return data.attachments;
}

export const listAttachments = (targetType: 'task' | 'message' | 'pipeline', targetId: string) =>
  request<{ attachments: Attachment[] }>(`/uploads?targetType=${targetType}&targetId=${encodeURIComponent(targetId)}`).then((r) => r.attachments);

/** List ALL attachments for a pipeline regardless of target_type (task, pipeline, message). */
export const listAllPipelineAttachments = (pipelineId: string) =>
  request<{ attachments: Attachment[] }>(`/pipelines/${encodeURIComponent(pipelineId)}/attachments`).then((r) => r.attachments);

export const deleteAttachment = (id: string) =>
  request<{ ok: boolean }>(`/uploads/${id}`, { method: 'DELETE' });

export const getAttachmentUrl = (id: string, download = false) =>
  `${BASE}/uploads/${id}${download ? '?download=true' : ''}`;

// Task Attachments
export const getTaskAttachments = (taskId: string) =>
  request<{ attachments: Attachment[] }>(
    `/tasks/${taskId}/attachments`,
  ).then((res) => res.attachments);

export async function uploadTaskAttachment(
  taskId: string,
  file: File,
): Promise<Attachment> {
  const formData = new FormData();
  formData.append('files', file);

  const res = await fetch(`${BASE}/tasks/${taskId}/attachments`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    throw await parseErrorResponse(res);
  }

  const data = await res.json() as { attachments: Attachment[] };
  const [attachment] = data.attachments;

  if (!attachment) {
    throw new Error('Upload completed without returning an attachment.');
  }

  return attachment;
}

export const deleteTaskAttachment = (taskId: string, attachmentId: string) =>
  request<{ deleted: boolean }>(
    `/tasks/${taskId}/attachments/${attachmentId}`,
    { method: 'DELETE' },
  );

export const getAttachmentDownloadUrl = (attachmentId: string) =>
  `${BASE}/attachments/${attachmentId}/download`;

// Filesystem
export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface BrowseResult {
  current: string;
  parent: string | null;
  entries: DirEntry[];
}

export interface ValidateResult {
  valid: boolean;
  resolved: string;
  error?: string;
}

export const browseDirectory = (dir?: string) => {
  const params = new URLSearchParams();
  if (dir) params.set('dir', dir);
  const qs = params.toString();
  return request<BrowseResult>(`/filesystem/browse${qs ? `?${qs}` : ''}`);
};

export const validateDirectory = (dir: string) =>
  request<ValidateResult>(`/filesystem/validate?dir=${encodeURIComponent(dir)}`);

// Execution
export const runPipeline = (pipelineId: string) =>
  request<{ started: string[]; pending: string[]; blocked?: string; message: string }>(`/execution/${pipelineId}/run`, { method: 'POST' });
export const pausePipeline = (pipelineId: string) =>
  request<{ paused: number }>(`/execution/${pipelineId}/pause`, { method: 'POST' });
export const completeTask = (taskId: string, output?: string) =>
  request<{ task: Task; cascaded: string[] }>(`/execution/tasks/${taskId}/complete`, { method: 'POST', body: JSON.stringify({ output }) });
export const abortTask = (taskId: string) =>
  request<{ aborted: boolean }>(`/execution/tasks/${taskId}/abort`, { method: 'POST' });
export const retryTask = (taskId: string, followUpPrompt?: string) =>
  request<{ retried: boolean }>(`/execution/tasks/${taskId}/retry`, { method: 'POST', body: JSON.stringify({ followUpPrompt }) });
export const getTaskOutput = (taskId: string) =>
  request<{ taskId: string; runId?: string; status?: string; stream?: string; stdout?: string; stderr?: string; tokens?: number; durationMs?: number; attempt?: number }>(`/execution/tasks/${taskId}/output`);
export const getTaskRuns = (taskId: string) =>
  request<ExecutionRun[]>(`/execution/tasks/${taskId}/runs`);
export const getTaskCycles = (taskId: string) =>
  request<TaskCycle[]>(`/execution/tasks/${taskId}/cycles`);
export const getTaskCycleAttempts = (taskId: string, cycleId: string) =>
  request<ExecutionRun[]>(`/execution/tasks/${taskId}/cycles/${cycleId}/attempts`);
export const getTaskCycleMessages = (taskId: string, cycleId: string) =>
  request<ConversationMessage[]>(`/execution/tasks/${taskId}/cycles/${cycleId}/messages`);
export const updateTaskNote = (taskId: string, note: string) =>
  request<{ ok: boolean }>(`/execution/tasks/${taskId}/note`, { method: 'PUT', body: JSON.stringify({ note }) });
export const getPoolStatus = () =>
  request<{ maxConcurrent: number; running: number; queued: number; jobs: { taskId: string; pipelineId: string; runningForMs: number }[] }>('/execution/pool');
export const startTask = (taskId: string) =>
  request<{ started: boolean; blocked?: string }>(
    `/execution/tasks/${taskId}/start`,
    { method: 'POST' },
  );
export const restartTaskFresh = (taskId: string, model?: string, followUpPrompt?: string) =>
  request<{ restarted: boolean }>(`/execution/tasks/${taskId}/restart-fresh`, {
    method: 'POST',
    body: JSON.stringify({ model, followUpPrompt }),
  });
export const resumeTask = (taskId: string) =>
  request<{ resumed: boolean }>(`/execution/tasks/${taskId}/resume`, { method: 'POST' });

// Control Requests (Interactive Mode)
export const getTaskQuestions = (taskId: string) =>
  request<ControlRequest[]>(`/execution/tasks/${taskId}/questions`);
export const respondToQuestion = (taskId: string, data: {
  requestId: string;
  action: 'allow' | 'deny';
  message?: string;
  updatedInput?: Record<string, unknown>;
}) =>
  request<{ ok: boolean; requestId: string; action: string }>(`/execution/tasks/${taskId}/respond`, {
    method: 'POST',
    body: JSON.stringify(data),
  });

// Git
export interface GitStatus {
  branch: string;
  mainBranch: string;
  exists: boolean;
  commitsAhead: number;
  commitsBehind: number;
  hasUncommitted: boolean;
  isMerged: boolean;
  changedFiles: string[];
  commitLog: { hash: string; message: string; date: string }[];
  worktreePath: string | null;
  worktreeStatus: string | null;
}

export interface GitActionResult {
  ok: boolean;
  message: string;
}

export const fetchGitStatus = (taskId: string) =>
  request<GitStatus>(`/tasks/${taskId}/git-status`);

export const fetchGitDiff = (taskId: string) =>
  request<{ diff: string }>(`/tasks/${taskId}/git-diff`);

export interface GitConflictError {
  error: string;
  conflictFiles: string[];
  fixerTaskId: string | null;
  message: string;
}

export async function performGitAction(
  taskId: string,
  action: 'merge' | 'rebase' | 'cleanup',
): Promise<GitActionResult> {
  const res = await fetch(`${BASE}/tasks/${taskId}/git-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  });

  const body = await res.json();

  if (!res.ok) {
    // Attach conflict details to the error
    const err = new Error(body.message ?? body.error ?? `HTTP ${res.status}`) as Error & { conflict?: GitConflictError };
    if (body.conflictFiles) {
      err.conflict = body as GitConflictError;
    }
    throw err;
  }

  return body as GitActionResult;
}

// Branch listing & switching
export const fetchBranches = (pipelineId: string) =>
  request<{ branches: string[] }>(`/pipelines/${pipelineId}/branches`);

export interface SwitchBranchResult {
  ok?: boolean;
  branch?: string;
  error?: string;
  message?: string;
  files?: string[];
}

export const switchTaskBranch = async (
  taskId: string,
  branch: string,
): Promise<SwitchBranchResult> => {
  const res = await fetch(`${BASE}/tasks/${taskId}/switch-branch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ branch }),
  });
  return res.json() as Promise<SwitchBranchResult>;
};

// Setup / Onboarding
export const getSetupStatus = () =>
  request<{ needsSetup: boolean }>('/setup/status');
export const detectProviders = () =>
  request<Record<string, boolean>>('/setup/detect-providers');
export const submitSetup = (data: Record<string, string>) =>
  request<{ ok: boolean }>('/setup', { method: 'POST', body: JSON.stringify(data) });

// Safety
export const getSafetyRules = () =>
  request<{ id: string; rule_type: string; pattern: string; severity: string; description: string | null; enabled: number }[]>('/safety/rules');
export const toggleSafetyRule = (ruleId: string, enabled: boolean) =>
  request<{ ok: boolean }>(`/safety/rules/${ruleId}`, { method: 'PUT', body: JSON.stringify({ enabled }) });

// Models & Providers
export interface ProviderDef {
  id: string;
  label: string;
  color: string;
  bg: string;
  cliCommand: string;
  sortOrder: number;
  enabled: boolean;
}

export interface ModelDef {
  id: string;
  provider: string;
  label: string;
  color: string;
  bg: string;
  costPer1k: number;
  cliFlag: string | null;
  sortOrder: number;
  enabled: boolean;
}

export const fetchModelsAndProviders = () =>
  request<{ providers: ProviderDef[]; models: ModelDef[] }>('/models');
export const createModelDef = (data: ModelDef) =>
  request<ModelDef>('/models', { method: 'POST', body: JSON.stringify(data) });
export const updateModelDef = (id: string, data: Partial<ModelDef>) =>
  request<ModelDef>(`/models/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteModelDef = (id: string) =>
  request<{ deleted: boolean }>(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' });

export interface DiscoveryResult {
  provider: string;
  added: string[];
  updated: string[];
  removed: string[];
  error?: string;
}

export const discoverModels = (provider?: string) =>
  request<{ results: DiscoveryResult[] }>('/models/discover', {
    method: 'POST',
    body: JSON.stringify(provider ? { provider } : {}),
  });

export const fetchUsageAnalytics = (params?: {
  from?: string;
  model?: string;
  pipelineId?: string;
  provider?: string;
  to?: string;
}) => {
  const search = new URLSearchParams();
  if (params?.from) search.set('from', params.from);
  if (params?.to) search.set('to', params.to);
  if (params?.pipelineId) search.set('pipelineId', params.pipelineId);
  if (params?.provider) search.set('provider', params.provider);
  if (params?.model) search.set('model', params.model);

  const query = search.toString();
  return request<UsageAnalytics>(`/analytics/usage${query ? `?${query}` : ''}`);
};

// Agents
export const fetchAgents = () => request<Agent[]>('/agents');
export const fetchAgent = (id: string) => request<Agent>(`/agents/${id}`);
export const createAgent = (data: Omit<Agent, 'id'>) =>
  request<Agent>('/agents', { method: 'POST', body: JSON.stringify(data) });
export const updateAgent = (id: string, data: Partial<Agent>) =>
  request<Agent>(`/agents/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteAgent = (id: string) =>
  request<{ deleted: boolean }>(`/agents/${id}`, { method: 'DELETE' });

// Logs
export const fetchLogs = (pipelineId: string) => request<LogEntry[]>(`/pipelines/${pipelineId}/logs`);

// Settings
export const fetchSettings = () => request<Record<string, string>>('/settings');
export const updateSettings = (data: Record<string, string>) =>
  request<Record<string, string>>('/settings', { method: 'PUT', body: JSON.stringify(data) });

// Integrations
export const testIntegration = (channel: 'telegram' | 'slack') =>
  request<{ ok: boolean }>('/integrations/test', { method: 'POST', body: JSON.stringify({ channel }) });

// Context
export const fetchContext = (pipelineId: string) =>
  request<{ key: string; value: string; setByTaskId: string | null }[]>(`/pipelines/${pipelineId}/context`);
export const setContext = (pipelineId: string, key: string, value: string, setByTaskId?: string) =>
  request<{ key: string; value: string }>(`/pipelines/${pipelineId}/context`, { method: 'PUT', body: JSON.stringify({ key, value, setByTaskId }) });

// Memory
export interface MemoryEntry {
  id: number;
  pipelineId: string;
  layer: 'short_term' | 'project' | 'artifact' | 'cycle';
  key: string;
  value: string;
  setByTaskId: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export const fetchMemory = (pipelineId: string, layer?: string, key?: string) => {
  const params = new URLSearchParams();
  if (layer) params.set('layer', layer);
  if (key) params.set('key', key);
  const qs = params.toString();
  return request<MemoryEntry[]>(`/pipelines/${pipelineId}/memory${qs ? `?${qs}` : ''}`);
};
export const setMemory = (pipelineId: string, data: { layer: string; key: string; value: string; setByTaskId?: string; expiresAt?: string }) =>
  request<MemoryEntry>(`/pipelines/${pipelineId}/memory`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteMemory = (pipelineId: string, layer: string, key: string) =>
  request<{ deleted: boolean }>(`/pipelines/${pipelineId}/memory/${layer}/${encodeURIComponent(key)}`, { method: 'DELETE' });
export const fetchTaskMessages = (pipelineId: string, taskId: string) =>
  request<MemoryEntry[]>(`/pipelines/${pipelineId}/memory/messages/${taskId}`);

// Breakdown Drafts
export interface BreakdownDraft {
  id: string;
  pipelineId: string;
  description: string;
  selectedAgents: string[];
  plan: BreakdownPlan | null;
  createdAt: string;
  updatedAt: string;
}

export const fetchBreakdownDraft = (pipelineId: string) =>
  request<BreakdownDraft | null>(`/pipelines/${pipelineId}/breakdown-draft`);

export const saveBreakdownDraft = (pipelineId: string, data: {
  description: string;
  selectedAgents: string[];
  plan: BreakdownPlan | null;
}) =>
  request<{ id: string }>(`/pipelines/${pipelineId}/breakdown-draft`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });

export const deleteBreakdownDraft = (pipelineId: string) =>
  request<{ deleted: boolean }>(`/pipelines/${pipelineId}/breakdown-draft`, { method: 'DELETE' });
