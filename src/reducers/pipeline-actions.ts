import type { Pipeline, Task, LogEntry, TaskStatus } from '@/types';

export type PipelineAction =
  | { type: 'ADD_PIPELINE'; payload: Pipeline }
  | { type: 'UPDATE_PIPELINE'; pipelineId: string; update: Partial<Pipeline> }
  | { type: 'ADD_TASK'; pipelineId: string; task: Task }
  | { type: 'UPDATE_TASK'; pipelineId: string; taskId: string; update: Partial<Task> }
  | { type: 'MOVE_TASK'; pipelineId: string; taskId: string; targetStatus: TaskStatus }
  | { type: 'APPROVE_TASK'; pipelineId: string; taskId: string }
  | { type: 'COMPLETE_TASK'; pipelineId: string; taskId: string; output: string; duration: string; tokens: number }
  | { type: 'COMPLETE_AND_CASCADE'; pipelineId: string; taskId: string; output: string; duration: string; tokens: number }
  | { type: 'REJECT_TASK'; pipelineId: string; taskId: string }
  | { type: 'CASCADE_DEPS'; pipelineId: string; completedTaskId: string }
  | { type: 'PUSH_LOG'; pipelineId: string; entry: LogEntry }
  | { type: 'SET_PIPELINES'; pipelines: Pipeline[] };
