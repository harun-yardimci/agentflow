import { z } from 'zod';

const PIPELINE_DESCRIPTION_MAX = 2000;
const PIPELINE_RULES_MAX = 20000;
const PIPELINE_WORKING_DIR_MAX = 500;

export const TaskStatusEnum = z.enum(['queued', 'running', 'completed', 'blocked', 'awaiting_approval', 'failed', 'rejected', 'skipped', 'rate_limited', 'auth_required']);
export const TaskTypeEnum = z.enum(['seeded', 'spawned', 'planned', 'system', 'routine']);
export const ApprovalModeEnum = z.enum(['auto', 'manual', 'on_error']);
/** Dynamic model key — validated as string, checked against DB at runtime */
export const ModelKeyEnum = z.string().min(1).max(100);
export const TaskPriorityEnum = z.enum(['urgent', 'high', 'medium', 'low']);
export const LogTypeEnum = z.enum(['info', 'success', 'warning', 'error', 'model']);

export const DependencyConditionSchema = z.object({
  type: z.enum(['contains', 'not_contains', 'regex', 'status']),
  value: z.string().min(1).max(500),
});

/** A dependency can be a plain task ID (unconditional) or an object with a condition */
export const DependencyItemSchema = z.union([
  z.string(), // plain task ID — unconditional
  z.object({
    taskId: z.string().min(1),
    condition: DependencyConditionSchema.nullable().default(null),
  }),
]);

export const PipelineStageSchema = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0),
  color: z.string().default('#9CA3AF'),
  maxParallel: z.number().int().min(0).default(0),
});

export const CreatePipelineSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(PIPELINE_DESCRIPTION_MAX).default(''),
  rules: z.string().max(PIPELINE_RULES_MAX).default(''),
  enabledAgents: z.array(z.string()).default([]),
  workingDir: z.string().trim().min(1).max(PIPELINE_WORKING_DIR_MAX),
  gitBranch: z.string().max(200).nullable().default(null),
  stages: z.array(PipelineStageSchema).optional(),
  tasks: z.array(z.object({
    name: z.string().min(1),
    agentId: z.string().min(1),
    model: ModelKeyEnum,
    approval: ApprovalModeEnum,
    stage: z.number().int().min(0),
    dependsOn: z.array(z.string()),
    input: z.string().default(''),
  })).optional(),
});

export const UpdatePipelineSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  status: TaskStatusEnum.optional(),
  description: z.string().max(PIPELINE_DESCRIPTION_MAX).optional(),
  rules: z.string().max(PIPELINE_RULES_MAX).optional(),
  enabledAgents: z.array(z.string()).optional(),
  workingDir: z.string().trim().min(1).max(PIPELINE_WORKING_DIR_MAX).optional(),
  gitBranch: z.string().max(200).nullable().optional(),
});

export const CreateTaskSchema = z.object({
  name: z.string().min(1).max(200),
  agentId: z.string().min(1),
  model: ModelKeyEnum.default('claude:sonnet'),
  approval: ApprovalModeEnum.default('auto'),
  stage: z.number().int().min(0).default(0),
  dependsOn: z.array(DependencyItemSchema).default([]),
  input: z.string().default(''),
  priority: TaskPriorityEnum.nullable().default(null),
  timeoutMs: z.number().int().positive().max(7_200_000).optional(),
  tags: z.array(z.string().min(1).max(50)).default([]),
  useWorktree: z.boolean().default(true),
  branch: z.string().max(200).nullable().default(null),
  autoRetry: z.boolean().default(false),
});

export const UpdateTaskSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  agentId: z.string().min(1).optional(),
  model: ModelKeyEnum.optional(),
  approval: ApprovalModeEnum.optional(),
  stage: z.number().int().min(0).optional(),
  input: z.string().optional(),
  status: TaskStatusEnum.optional(),
  priority: TaskPriorityEnum.nullable().optional(),
  timeoutMs: z.number().int().positive().max(7_200_000).optional(),
  dependsOn: z.array(DependencyItemSchema).optional(),
  tags: z.array(z.string().min(1).max(50)).optional(),
  interactiveMode: z.boolean().optional(),
  useWorktree: z.boolean().optional(),
  branch: z.string().max(200).nullable().optional(),
  autoRetry: z.boolean().optional(),
});

export const MoveTaskSchema = z.object({
  status: TaskStatusEnum,
});

export const GitActionSchema = z.object({
  action: z.enum(['merge', 'rebase', 'cleanup']),
});

export const CreateAgentSchema = z.object({
  id: z.string().min(1).max(50).optional(),
  name: z.string().min(1).max(200),
  icon: z.string().default('🤖'),
  title: z.string().max(200).default(''),
  avatarSeed: z.string().max(100).default(''),
  defaultModel: ModelKeyEnum.default('claude:sonnet'),
  prompt: z.string().default(''),
});

export const UpdateAgentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  icon: z.string().optional(),
  title: z.string().max(200).optional(),
  avatarSeed: z.string().max(100).optional(),
  defaultModel: ModelKeyEnum.optional(),
  prompt: z.string().optional(),
});

// ─── Breakdown ───

export const BreakdownRequestSchema = z.object({
  description: z.string().min(10).max(5000),
  agentIds: z.array(z.string().min(1)).min(1),
  model: ModelKeyEnum.optional(),
  attachmentIds: z.array(z.string().min(1)).optional(),
  pipelineId: z.string().optional(),
});

/** A batch dependency can be a plain index or an object with a condition */
export const BatchDependencyItemSchema = z.union([
  z.number().int().min(0), // plain index — unconditional
  z.object({
    index: z.number().int().min(0),
    condition: DependencyConditionSchema.nullable().default(null),
  }),
]);

export const BatchCreateTaskSchema = z.object({
  name: z.string().min(1).max(200),
  agentId: z.string().min(1),
  model: ModelKeyEnum.default('claude:sonnet'),
  approval: ApprovalModeEnum.default('auto'),
  stage: z.number().int().min(0).default(0),
  dependsOnIndices: z.array(BatchDependencyItemSchema).default([]),
  input: z.string().default(''),
  priority: TaskPriorityEnum.nullable().default(null),
  timeoutMs: z.number().int().positive().max(7_200_000).optional(),
  tags: z.array(z.string().min(1).max(50)).default([]),
  useWorktree: z.boolean().default(true),
  branch: z.string().max(200).nullable().default(null),
  autoRetry: z.boolean().default(false),
});

export const BatchCreateTasksSchema = z.object({
  tasks: z.array(BatchCreateTaskSchema).min(1).max(50),
});

// ─── Routines ───

export const ScheduleKindEnum = z.enum(['hourly', 'daily', 'weekly']);

export const CreateRoutineSchema = z.object({
  name: z.string().min(1).max(200),
  agentId: z.string().min(1),
  model: ModelKeyEnum.default('claude:sonnet'),
  approval: ApprovalModeEnum.default('auto'),
  input: z.string().default(''),
  scheduleKind: ScheduleKindEnum.default('daily'),
  scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).default('09:00'),
  scheduleWeekday: z.number().int().min(0).max(6).default(1),
  useWorktree: z.boolean().default(true),
  branch: z.string().max(200).nullable().default(null),
  timeoutMs: z.number().int().positive().max(7_200_000).nullable().default(null),
  priority: TaskPriorityEnum.nullable().default(null),
  enabled: z.boolean().default(true),
});

export const UpdateRoutineSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  agentId: z.string().min(1).optional(),
  model: ModelKeyEnum.optional(),
  approval: ApprovalModeEnum.optional(),
  input: z.string().optional(),
  scheduleKind: ScheduleKindEnum.optional(),
  scheduleTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  scheduleWeekday: z.number().int().min(0).max(6).optional(),
  useWorktree: z.boolean().optional(),
  branch: z.string().max(200).nullable().optional(),
  timeoutMs: z.number().int().positive().max(7_200_000).nullable().optional(),
  priority: TaskPriorityEnum.nullable().optional(),
  enabled: z.boolean().optional(),
});

// ─── Provider & Model CRUD ───

export const ExecutionModeEnum = z.enum(['cli', 'api']);

export const CreateProviderSchema = z.object({
  id: z.string().min(1).max(50),
  label: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  bg: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  cliCommand: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
  executionMode: ExecutionModeEnum.default('cli'),
  apiKey: z.string().max(500).nullable().default(null),
});

export const UpdateProviderSchema = CreateProviderSchema.partial().omit({ id: true });

export const CreateModelSchema = z.object({
  id: z.string().min(1).max(100),
  provider: z.string().min(1).max(50),
  label: z.string().min(1).max(200),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  bg: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  costPer1k: z.number().min(0).default(0),
  cliFlag: z.string().max(100).nullable().default(null),
  sortOrder: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
});

export const UpdateModelSchema = CreateModelSchema.partial().omit({ id: true });

export const UpdateSettingsSchema = z.record(z.string(), z.string());

// ─── Attachments ───

export const UploadQuerySchema = z.object({
  targetType: z.enum(['task', 'message', 'pipeline']),
  targetId: z.string().min(1),
  pipelineId: z.string().min(1),
});

export const ListAttachmentsSchema = z.object({
  targetType: z.enum(['task', 'message', 'pipeline']),
  targetId: z.string().min(1),
});

export const SetContextSchema = z.object({
  key: z.string().min(1),
  value: z.string(),
  setByTaskId: z.string().optional(),
});

export const MemoryLayerEnum = z.enum(['short_term', 'project', 'artifact', 'cycle']);

export const SetMemorySchema = z.object({
  layer: MemoryLayerEnum,
  key: z.string().min(1),
  value: z.string(),
  createdByTask: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
});
