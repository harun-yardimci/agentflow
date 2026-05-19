import { Router } from 'express';
import { validate } from '../middleware/validate.js';
import {
  CreateProviderSchema,
  UpdateProviderSchema,
  CreateModelSchema,
  UpdateModelSchema,
} from '../types/api.js';
import { getDb } from '../db/connection.js';
import { AppError } from '../middleware/error-handler.js';
import { discoverModels } from '../services/model-discovery.js';

const router = Router();

// ─── Row types ───

interface ProviderRow {
  id: string;
  label: string;
  color: string;
  bg: string;
  cli_command: string;
  sort_order: number;
  enabled: number;
  execution_mode: string;
  api_key: string | null;
}

interface ModelRow {
  id: string;
  provider: string;
  label: string;
  color: string;
  bg: string;
  cost_per_1k: number;
  cli_flag: string | null;
  sort_order: number;
  enabled: number;
}

function formatProvider(row: ProviderRow) {
  return {
    id: row.id,
    label: row.label,
    color: row.color,
    bg: row.bg,
    cliCommand: row.cli_command,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
    executionMode: (row.execution_mode === 'api' ? 'api' : 'cli') as 'cli' | 'api',
    hasApiKey: !!row.api_key,
  };
}

function formatModel(row: ModelRow) {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    color: row.color,
    bg: row.bg,
    costPer1k: row.cost_per_1k,
    cliFlag: row.cli_flag,
    sortOrder: row.sort_order,
    enabled: row.enabled === 1,
  };
}

// ─── Combined endpoint ───

router.get('/', (_req, res) => {
  const db = getDb();
  const providers = db.prepare('SELECT * FROM providers ORDER BY sort_order').all() as ProviderRow[];
  const models = db.prepare('SELECT * FROM models ORDER BY provider, sort_order').all() as ModelRow[];
  res.json({
    providers: providers.map(formatProvider),
    models: models.map(formatModel),
  });
});

// ─── Model Discovery ───

router.post('/discover', async (req, res, next) => {
  try {
    const provider = typeof req.body?.provider === 'string' ? req.body.provider : undefined;
    const results = await discoverModels(provider);
    res.json({ results });
  } catch (err) {
    next(err);
  }
});

// ─── Provider CRUD ───

router.get('/providers', (_req, res) => {
  const db = getDb();
  const providers = db.prepare('SELECT * FROM providers ORDER BY sort_order').all() as ProviderRow[];
  res.json(providers.map(formatProvider));
});

router.post('/providers', validate(CreateProviderSchema), (req, res) => {
  const db = getDb();
  db.prepare(
    'INSERT INTO providers (id, label, color, bg, cli_command, sort_order, enabled, execution_mode, api_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    req.body.id,
    req.body.label,
    req.body.color,
    req.body.bg,
    req.body.cliCommand,
    req.body.sortOrder ?? 0,
    req.body.enabled !== false ? 1 : 0,
    req.body.executionMode ?? 'cli',
    req.body.apiKey ?? null,
  );
  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.body.id) as ProviderRow;
  res.status(201).json(formatProvider(row));
});

router.put('/providers/:id', validate(UpdateProviderSchema), (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id!) as ProviderRow | undefined;
  if (!existing) throw new AppError(404, 'Provider not found');

  const fields: string[] = [];
  const values: unknown[] = [];

  if (req.body.label !== undefined) { fields.push('label = ?'); values.push(req.body.label); }
  if (req.body.color !== undefined) { fields.push('color = ?'); values.push(req.body.color); }
  if (req.body.bg !== undefined) { fields.push('bg = ?'); values.push(req.body.bg); }
  if (req.body.cliCommand !== undefined) { fields.push('cli_command = ?'); values.push(req.body.cliCommand); }
  if (req.body.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(req.body.sortOrder); }
  if (req.body.enabled !== undefined) { fields.push('enabled = ?'); values.push(req.body.enabled ? 1 : 0); }
  if (req.body.executionMode !== undefined) { fields.push('execution_mode = ?'); values.push(req.body.executionMode); }
  if (req.body.apiKey !== undefined) { fields.push('api_key = ?'); values.push(req.body.apiKey); }

  if (fields.length > 0) {
    values.push(req.params.id!);
    db.prepare(`UPDATE providers SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  const row = db.prepare('SELECT * FROM providers WHERE id = ?').get(req.params.id!) as ProviderRow;
  res.json(formatProvider(row));
});

router.delete('/providers/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM providers WHERE id = ?').run(req.params.id!);
  if (result.changes === 0) throw new AppError(404, 'Provider not found');
  res.json({ deleted: true });
});

// ─── Model CRUD ───

router.get('/list', (_req, res) => {
  const db = getDb();
  const models = db.prepare('SELECT * FROM models ORDER BY provider, sort_order').all() as ModelRow[];
  res.json(models.map(formatModel));
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const model = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id!) as ModelRow | undefined;
  if (!model) throw new AppError(404, 'Model not found');
  res.json(formatModel(model));
});

router.post('/', validate(CreateModelSchema), (req, res) => {
  const db = getDb();
  // Verify provider exists
  const provider = db.prepare('SELECT id FROM providers WHERE id = ?').get(req.body.provider);
  if (!provider) throw new AppError(400, `Provider '${req.body.provider}' not found`);

  db.prepare(
    'INSERT INTO models (id, provider, label, color, bg, cost_per_1k, cli_flag, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(
    req.body.id, req.body.provider, req.body.label, req.body.color, req.body.bg,
    req.body.costPer1k ?? 0, req.body.cliFlag ?? null, req.body.sortOrder ?? 0,
    req.body.enabled !== false ? 1 : 0,
  );
  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(req.body.id) as ModelRow;
  res.status(201).json(formatModel(row));
});

router.put('/:id', validate(UpdateModelSchema), (req, res) => {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id!) as ModelRow | undefined;
  if (!existing) throw new AppError(404, 'Model not found');

  const fields: string[] = [];
  const values: unknown[] = [];

  if (req.body.provider !== undefined) { fields.push('provider = ?'); values.push(req.body.provider); }
  if (req.body.label !== undefined) { fields.push('label = ?'); values.push(req.body.label); }
  if (req.body.color !== undefined) { fields.push('color = ?'); values.push(req.body.color); }
  if (req.body.bg !== undefined) { fields.push('bg = ?'); values.push(req.body.bg); }
  if (req.body.costPer1k !== undefined) { fields.push('cost_per_1k = ?'); values.push(req.body.costPer1k); }
  if (req.body.cliFlag !== undefined) { fields.push('cli_flag = ?'); values.push(req.body.cliFlag); }
  if (req.body.sortOrder !== undefined) { fields.push('sort_order = ?'); values.push(req.body.sortOrder); }
  if (req.body.enabled !== undefined) { fields.push('enabled = ?'); values.push(req.body.enabled ? 1 : 0); }

  if (fields.length > 0) {
    values.push(req.params.id!);
    db.prepare(`UPDATE models SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  const row = db.prepare('SELECT * FROM models WHERE id = ?').get(req.params.id!) as ModelRow;
  res.json(formatModel(row));
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM models WHERE id = ?').run(req.params.id!);
  if (result.changes === 0) throw new AppError(404, 'Model not found');
  res.json({ deleted: true });
});

export default router;
