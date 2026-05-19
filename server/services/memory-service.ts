import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';

interface MemoryRow {
  id: string;
  pipeline_id: string;
  layer: string;
  key: string;
  value: string;
  created_by_task: string | null;
  created_at: string;
  expires_at: string | null;
}

interface MemoryEntry {
  id: string;
  pipelineId: string;
  layer: string;
  key: string;
  value: string;
  createdByTask: string | null;
  createdAt: string;
  expiresAt: string | null;
}

function toEntry(row: MemoryRow): MemoryEntry {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    layer: row.layer,
    key: row.key,
    value: row.value,
    createdByTask: row.created_by_task,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}

function assertPipelineExists(pipelineId: string): void {
  const db = getDb();
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pipelineId);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');
}

export function getMemory(pipelineId: string, layer?: string, key?: string): MemoryEntry[] {
  assertPipelineExists(pipelineId);
  const db = getDb();

  let sql = 'SELECT * FROM memory WHERE pipeline_id = ?';
  const params: unknown[] = [pipelineId];

  if (layer) {
    sql += ' AND layer = ?';
    params.push(layer);
  }
  if (key) {
    sql += ' AND key = ?';
    params.push(key);
  }

  sql += ' ORDER BY created_at ASC';

  const rows = db.prepare(sql).all(...params) as MemoryRow[];
  return rows.map(toEntry);
}

export function setMemory(
  pipelineId: string,
  layer: string,
  key: string,
  value: string,
  createdByTask?: string,
  expiresAt?: string,
): MemoryEntry {
  assertPipelineExists(pipelineId);
  const db = getDb();

  const existing = db.prepare(
    'SELECT id FROM memory WHERE pipeline_id = ? AND layer = ? AND key = ?'
  ).get(pipelineId, layer, key) as { id: string } | undefined;

  const id = existing?.id ?? randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO memory (id, pipeline_id, layer, key, value, created_by_task, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(pipeline_id, layer, key) DO UPDATE SET
      value = excluded.value,
      created_by_task = excluded.created_by_task,
      expires_at = excluded.expires_at
  `).run(id, pipelineId, layer, key, value, createdByTask ?? null, now, expiresAt ?? null);

  return {
    id,
    pipelineId,
    layer,
    key,
    value,
    createdByTask: createdByTask ?? null,
    createdAt: now,
    expiresAt: expiresAt ?? null,
  };
}

export function deleteMemory(pipelineId: string, layer: string, key: string): { deleted: true } {
  assertPipelineExists(pipelineId);
  const db = getDb();

  const result = db.prepare(
    'DELETE FROM memory WHERE pipeline_id = ? AND layer = ? AND key = ?'
  ).run(pipelineId, layer, key);

  if (result.changes === 0) {
    throw new AppError(404, 'Memory entry not found');
  }

  return { deleted: true };
}

export function getShortTermForTask(pipelineId: string, taskId: string): MemoryEntry[] {
  assertPipelineExists(pipelineId);
  const db = getDb();

  const rows = db.prepare(
    `SELECT * FROM memory
     WHERE pipeline_id = ? AND layer = 'short_term' AND key LIKE ?
     ORDER BY created_at ASC`
  ).all(pipelineId, `msg:%:${taskId}:%`) as MemoryRow[];

  return rows.map(toEntry);
}

export function sendMessage(
  pipelineId: string,
  fromTaskId: string,
  toTaskId: string,
  message: string,
): MemoryEntry {
  assertPipelineExists(pipelineId);

  const timestamp = Date.now();
  const key = `msg:${fromTaskId}:${toTaskId}:${timestamp}`;

  return setMemory(pipelineId, 'short_term', key, message, fromTaskId);
}

export function cleanExpired(pipelineId?: string): { removed: number } {
  const db = getDb();
  const now = new Date().toISOString();

  let sql = `DELETE FROM memory WHERE layer = 'short_term' AND expires_at IS NOT NULL AND expires_at < ?`;
  const params: unknown[] = [now];

  if (pipelineId) {
    sql += ' AND pipeline_id = ?';
    params.push(pipelineId);
  }

  const result = db.prepare(sql).run(...params);
  return { removed: result.changes };
}
