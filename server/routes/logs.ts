import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';

const router = Router();

router.get('/pipelines/:pid/logs', (req, res) => {
  const db = getDb();
  const pipeline = db.prepare('SELECT id FROM pipelines WHERE id = ?').get(req.params.pid!);
  if (!pipeline) throw new AppError(404, 'Pipeline not found');

  const logs = db.prepare('SELECT * FROM logs WHERE pipeline_id = ? ORDER BY id').all(req.params.pid!) as {
    id: number; pipeline_id: string; time: string; type: string; msg: string;
  }[];

  res.json(logs.map((l) => ({
    id: l.id,
    time: l.time,
    type: l.type,
    msg: l.msg,
  })));
});

export default router;
