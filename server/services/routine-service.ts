import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';
import { logTimestamp } from '../lib/log-timestamp.js';
import { computeNextTrigger, type ScheduleKind } from '../engine/routine-schedule.js';

/**
 * The host timezone the scheduler interprets routine times in. Sent to clients
 * so they render "Next run" in the same zone as the schedule the user set,
 * instead of the viewing browser's zone.
 */
const SERVER_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

interface RoutineRow {
  id: string;
  pipeline_id: string;
  name: string;
  agent_id: string;
  model: string;
  approval: string;
  input: string;
  schedule_kind: string;
  schedule_time: string;
  schedule_weekday: number;
  use_worktree: number;
  branch: string | null;
  timeout_ms: number | null;
  priority: string | null;
  enabled: number;
  last_triggered_at: string | null;
  next_trigger_at: string | null;
  created_at: string;
}

export interface Routine {
  id: string;
  pipelineId: string;
  name: string;
  agentId: string;
  model: string;
  approval: string;
  input: string;
  scheduleKind: ScheduleKind;
  scheduleTime: string;
  scheduleWeekday: number;
  useWorktree: boolean;
  branch: string | null;
  timeoutMs: number | null;
  priority: string | null;
  enabled: boolean;
  lastTriggeredAt: string | null;
  nextTriggerAt: string | null;
  createdAt: string;
  /** IANA timezone the server interprets schedule times in. */
  serverTimeZone: string;
}

export interface RoutineInput {
  name: string;
  agentId: string;
  model: string;
  approval: string;
  input: string;
  scheduleKind: ScheduleKind;
  scheduleTime: string;
  scheduleWeekday: number;
  useWorktree: boolean;
  branch: string | null;
  timeoutMs: number | null;
  priority: string | null;
  enabled: boolean;
}

function mapRoutine(row: RoutineRow): Routine {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    name: row.name,
    agentId: row.agent_id,
    model: row.model,
    approval: row.approval,
    input: row.input,
    scheduleKind: row.schedule_kind as ScheduleKind,
    scheduleTime: row.schedule_time,
    scheduleWeekday: row.schedule_weekday,
    useWorktree: row.use_worktree === 1,
    branch: row.branch,
    timeoutMs: row.timeout_ms,
    priority: row.priority,
    enabled: row.enabled === 1,
    lastTriggeredAt: row.last_triggered_at,
    nextTriggerAt: row.next_trigger_at,
    createdAt: row.created_at,
    serverTimeZone: SERVER_TIME_ZONE,
  };
}

function getRow(id: string): RoutineRow {
  const row = getDb().prepare('SELECT * FROM routines WHERE id = ?').get(id) as RoutineRow | undefined;
  if (!row) throw new AppError(404, 'Routine not found');
  return row;
}

function assertAgentExists(agentId: string): void {
  const agent = getDb().prepare('SELECT id FROM agents WHERE id = ?').get(agentId);
  if (!agent) throw new AppError(400, `Agent '${agentId}' not found`);
}

export function listRoutines(pipelineId: string): Routine[] {
  const rows = getDb()
    .prepare('SELECT * FROM routines WHERE pipeline_id = ? ORDER BY created_at ASC')
    .all(pipelineId) as RoutineRow[];
  return rows.map(mapRoutine);
}

export function getRoutine(id: string): Routine {
  return mapRoutine(getRow(id));
}

export function createRoutine(pipelineId: string, data: RoutineInput): Routine {
  const db = getDb();
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pipelineId);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');
  assertAgentExists(data.agentId);

  const id = `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = new Date();
  const nextTrigger = data.enabled
    ? computeNextTrigger(
        { scheduleKind: data.scheduleKind, scheduleTime: data.scheduleTime, scheduleWeekday: data.scheduleWeekday },
        now,
      ).toISOString()
    : null;

  db.prepare(
    `INSERT INTO routines (
      id, pipeline_id, name, agent_id, model, approval, input,
      schedule_kind, schedule_time, schedule_weekday,
      use_worktree, branch, timeout_ms, priority, enabled,
      last_triggered_at, next_trigger_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, pipelineId, data.name, data.agentId, data.model, data.approval, data.input,
    data.scheduleKind, data.scheduleTime, data.scheduleWeekday,
    data.useWorktree ? 1 : 0, data.branch, data.timeoutMs, data.priority, data.enabled ? 1 : 0,
    null, nextTrigger, now.toISOString(),
  );

  db.prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)').run(
    pipelineId, logTimestamp(), 'info', `Routine '${data.name}' created`,
  );

  return getRoutine(id);
}

export function updateRoutine(id: string, data: Partial<RoutineInput>): Routine {
  const db = getDb();
  const existing = getRow(id);
  if (data.agentId !== undefined) assertAgentExists(data.agentId);

  const merged = {
    name: data.name ?? existing.name,
    agentId: data.agentId ?? existing.agent_id,
    model: data.model ?? existing.model,
    approval: data.approval ?? existing.approval,
    input: data.input ?? existing.input,
    scheduleKind: (data.scheduleKind ?? existing.schedule_kind) as ScheduleKind,
    scheduleTime: data.scheduleTime ?? existing.schedule_time,
    scheduleWeekday: data.scheduleWeekday ?? existing.schedule_weekday,
    useWorktree: data.useWorktree ?? existing.use_worktree === 1,
    branch: data.branch !== undefined ? data.branch : existing.branch,
    timeoutMs: data.timeoutMs !== undefined ? data.timeoutMs : existing.timeout_ms,
    priority: data.priority !== undefined ? data.priority : existing.priority,
    enabled: data.enabled ?? existing.enabled === 1,
  };

  // Recompute next trigger when schedule/enabled changed; clear when disabled.
  const scheduleChanged =
    merged.scheduleKind !== existing.schedule_kind ||
    merged.scheduleTime !== existing.schedule_time ||
    merged.scheduleWeekday !== existing.schedule_weekday ||
    merged.enabled !== (existing.enabled === 1);

  let nextTrigger = existing.next_trigger_at;
  if (!merged.enabled) {
    nextTrigger = null;
  } else if (scheduleChanged) {
    nextTrigger = computeNextTrigger(
      { scheduleKind: merged.scheduleKind, scheduleTime: merged.scheduleTime, scheduleWeekday: merged.scheduleWeekday },
      new Date(),
    ).toISOString();
  }

  db.prepare(
    `UPDATE routines SET
      name = ?, agent_id = ?, model = ?, approval = ?, input = ?,
      schedule_kind = ?, schedule_time = ?, schedule_weekday = ?,
      use_worktree = ?, branch = ?, timeout_ms = ?, priority = ?, enabled = ?,
      next_trigger_at = ?
    WHERE id = ?`,
  ).run(
    merged.name, merged.agentId, merged.model, merged.approval, merged.input,
    merged.scheduleKind, merged.scheduleTime, merged.scheduleWeekday,
    merged.useWorktree ? 1 : 0, merged.branch, merged.timeoutMs, merged.priority, merged.enabled ? 1 : 0,
    nextTrigger, id,
  );

  return getRoutine(id);
}

export function deleteRoutine(id: string): { ok: true } {
  const row = getRow(id);
  getDb().prepare('DELETE FROM routines WHERE id = ?').run(id);
  getDb().prepare('INSERT INTO logs (pipeline_id, time, type, msg) VALUES (?, ?, ?, ?)').run(
    row.pipeline_id, logTimestamp(), 'info', `Routine '${row.name}' deleted`,
  );
  return { ok: true };
}

/**
 * Stamp a routine as fired: bump last_triggered_at and, when advancing the
 * schedule, recompute next_trigger_at from now. Manual run-now passes
 * advanceSchedule=false so the recurring cadence is left untouched. Takes the
 * already-loaded Routine (the scheduler holds it) to avoid a re-SELECT.
 */
export function markRoutineTriggered(routine: Routine, advanceSchedule: boolean): void {
  const now = new Date();
  const nextTrigger = advanceSchedule && routine.enabled
    ? computeNextTrigger(
        { scheduleKind: routine.scheduleKind, scheduleTime: routine.scheduleTime, scheduleWeekday: routine.scheduleWeekday },
        now,
      ).toISOString()
    : routine.nextTriggerAt;

  getDb().prepare('UPDATE routines SET last_triggered_at = ?, next_trigger_at = ? WHERE id = ?').run(
    now.toISOString(), nextTrigger, routine.id,
  );
}

/** Routines whose next_trigger_at is due — used by the scheduler poller. */
export function listDueRoutines(nowIso: string): Routine[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM routines
       WHERE enabled = 1 AND next_trigger_at IS NOT NULL AND next_trigger_at <= ?`,
    )
    .all(nowIso) as RoutineRow[];
  return rows.map(mapRoutine);
}
