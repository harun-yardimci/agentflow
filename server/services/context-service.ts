import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';

interface ContextRow {
  id: number;
  pipeline_id: string;
  key: string;
  value: string;
  set_by_task_id: string | null;
}

export function getContext(pipelineId: string) {
  const db = getDb();
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pipelineId);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');

  const rows = db.prepare('SELECT * FROM pipeline_ctx WHERE pipeline_id = ? ORDER BY id').all(pipelineId) as ContextRow[];
  return rows.map((r) => ({
    key: r.key,
    value: r.value,
    setByTaskId: r.set_by_task_id,
  }));
}

export function setContext(pipelineId: string, key: string, value: string, setByTaskId?: string) {
  const db = getDb();
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(pipelineId);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');

  db.prepare(
    'INSERT OR REPLACE INTO pipeline_ctx (pipeline_id, key, value, set_by_task_id) VALUES (?, ?, ?, ?)'
  ).run(pipelineId, key, value, setByTaskId ?? null);

  return { key, value, setByTaskId: setByTaskId ?? null };
}

export function deleteContext(pipelineId: string, key: string) {
  const db = getDb();
  const result = db.prepare('DELETE FROM pipeline_ctx WHERE pipeline_id = ? AND key = ?').run(pipelineId, key);
  if (result.changes === 0) throw new AppError(404, 'Context key not found');
  return { deleted: true };
}
