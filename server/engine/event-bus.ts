import { EventEmitter } from 'events';
import { getDb } from '../db/connection.js';

export interface TaskEvent {
  taskId: string;
  pipelineId: string;
  taskName: string;
  status: string;
}

export interface PipelineEvent {
  pipelineId: string;
  pipelineName: string;
  status: string;
}

export interface EventMap {
  'task:started': TaskEvent;
  'task:auto_retry': TaskEvent & { retryCount: number; maxRetries: number };
  'task:completed': TaskEvent & { output: string; tokens: number; durationMs: number };
  'task:failed': TaskEvent & { error: string; attempt: number };
  'task:blocked': TaskEvent & { reason: string };
  'task:approval_needed': TaskEvent;
  'task:hook_failed': TaskEvent & { hook: string; exitCode: number; stderr: string };
  'task:merge_conflict': TaskEvent & { conflictFiles: string[]; fixerTaskId: string };
  'task:question': TaskEvent & { requestId: string; toolName: string; question: string | null };
  'task:spawn_missing': TaskEvent & { message: string };
  'task:spawned': TaskEvent & { sourceTaskId: string; spawnedCount: number };
  'task:rate_limited': TaskEvent & { resumeAt: string };
  'task:rate_limit_resumed': TaskEvent;
  'task:auth_required': TaskEvent & { provider: string; matched: string };
  'pipeline:started': PipelineEvent;
  'pipeline:stage_advanced': PipelineEvent & { stage: number };
  'pipeline:completed': PipelineEvent;
  'pipeline:failed': PipelineEvent;
}

type EventName = keyof EventMap;

class AgentFlowEventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit<K extends EventName>(event: K, data: EventMap[K]): void {
    // Persist to SQLite for audit trail (non-blocking)
    // Truncate large fields to keep events table small
    try {
      const db = getDb();
      let payload = data;
      if (event === 'task:completed') {
        const d = data as EventMap['task:completed'];
        payload = { ...d, output: d.output?.slice(0, 500) ?? '' } as EventMap[K];
      }
      db.prepare(
        'INSERT INTO events (event_type, payload, created_at) VALUES (?, ?, ?)'
      ).run(event, JSON.stringify(payload), new Date().toISOString());
    } catch {
      // DB write failure should not break event flow
    }

    this.emitter.emit(event, data);
  }

  on<K extends EventName>(event: K, listener: (data: EventMap[K]) => void): void {
    this.emitter.on(event, listener);
  }

  off<K extends EventName>(event: K, listener: (data: EventMap[K]) => void): void {
    this.emitter.off(event, listener);
  }

  once<K extends EventName>(event: K, listener: (data: EventMap[K]) => void): void {
    this.emitter.once(event, listener);
  }

  /** Clean up old consumed events (called by cleanup service) */
  pruneEvents(retentionDays: number = 30): number {
    const db = getDb();
    const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();
    const result = db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff);
    return result.changes;
  }
}

// Singleton
export const eventBus = new AgentFlowEventBus();
