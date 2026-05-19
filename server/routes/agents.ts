import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import { CreateAgentSchema, UpdateAgentSchema } from '../types/api.js';
import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';

const router = Router();

interface AgentRow {
  id: string;
  name: string;
  icon: string;
  title: string;
  avatar_seed: string;
  default_model: string;
  prompt: string;
}

function formatAgent(row: AgentRow) {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    title: row.title ?? '',
    avatarSeed: row.avatar_seed ?? '',
    defaultModel: row.default_model,
    prompt: row.prompt,
  };
}

router.get('/', (_req, res) => {
  const db = getDb();
  const agents = db.prepare('SELECT * FROM agents ORDER BY name').all() as AgentRow[];
  res.json(agents.map(formatAgent));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id!) as AgentRow | undefined;
  if (!agent) throw new AppError(404, 'Agent not found');
  res.json(formatAgent(agent));
});

router.post('/', validate(CreateAgentSchema), (req, res) => {
  const db = getDb();
  const id = req.body.id || `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare('INSERT INTO agents (id, name, icon, title, avatar_seed, default_model, prompt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.body.name, req.body.icon, req.body.title ?? '', req.body.avatarSeed ?? '', req.body.defaultModel, req.body.prompt);
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as AgentRow;
  res.status(201).json(formatAgent(agent));
});

router.put('/:id', validate(UpdateAgentSchema), (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id!) as AgentRow | undefined;
  if (!existing) throw new AppError(404, 'Agent not found');

  const fields: string[] = [];
  const values: unknown[] = [];

  if (req.body.name !== undefined) { fields.push('name = ?'); values.push(req.body.name); }
  if (req.body.icon !== undefined) { fields.push('icon = ?'); values.push(req.body.icon); }
  if (req.body.title !== undefined) { fields.push('title = ?'); values.push(req.body.title); }
  if (req.body.avatarSeed !== undefined) { fields.push('avatar_seed = ?'); values.push(req.body.avatarSeed); }
  if (req.body.defaultModel !== undefined) { fields.push('default_model = ?'); values.push(req.body.defaultModel); }
  if (req.body.prompt !== undefined) { fields.push('prompt = ?'); values.push(req.body.prompt); }

  if (fields.length > 0) {
    values.push(req.params.id!);
    db.prepare(`UPDATE agents SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(req.params.id!) as AgentRow;
  res.json(formatAgent(agent));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM agents WHERE id = ?').run(req.params.id!);
  if (result.changes === 0) throw new AppError(404, 'Agent not found');
  res.json({ deleted: true });
});

export default router;
