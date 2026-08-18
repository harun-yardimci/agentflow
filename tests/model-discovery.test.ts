import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createTestDb } from './helpers/test-db.js';

let db: Database.Database;

const execSyncMock = vi.fn<(cmd: string, opts?: unknown) => string>();
const readFileSyncMock = vi.fn<(path: string, encoding: string) => string>();

vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
}));

vi.mock('node:fs', () => ({
  readFileSync: readFileSyncMock,
}));

vi.mock('../server/db/connection.js', () => ({
  getDb: () => db,
  closeDb: () => {
    db?.close();
  },
}));

const { discoverModels } = await import('../server/services/model-discovery.js');

describe('Model Discovery', () => {
  beforeEach(() => {
    db = createTestDb();
    db.prepare(`
      INSERT INTO providers (id, label, color, bg, cli_command, sort_order, enabled)
      VALUES ('codex', 'Codex', '#22C55E', '#071710', 'codex', 2, 1)
    `).run();
    db.prepare(`
      INSERT INTO providers (id, label, color, bg, cli_command, sort_order, enabled)
      VALUES ('antigravity', 'Antigravity', '#8B5CF6', '#120A20', 'agy', 3, 1)
    `).run();

    execSyncMock.mockReset();
    readFileSyncMock.mockReset();
  });

  afterEach(() => {
    db.close();
  });

  it('discovers Codex models from the local models cache when available', async () => {
    execSyncMock.mockImplementation((cmd) => {
      if (cmd === 'which codex') {
        return '/usr/local/bin/codex';
      }
      return '';
    });

    readFileSyncMock.mockReturnValue(JSON.stringify({
      models: [
        {
          slug: 'gpt-5.4',
          display_name: 'gpt-5.4',
          visibility: 'list',
          supported_in_api: true,
          priority: 1,
        },
        {
          slug: 'gpt-hidden',
          display_name: 'gpt-hidden',
          visibility: 'hide',
          supported_in_api: true,
          priority: 2,
        },
        {
          slug: 'gpt-local-only',
          display_name: 'gpt-local-only',
          visibility: 'list',
          supported_in_api: false,
          priority: 3,
        },
      ],
    }));

    const results = await discoverModels('codex');
    const models = db.prepare(
      'SELECT id, label, cli_flag, sort_order FROM models WHERE provider = ? ORDER BY sort_order ASC'
    ).all('codex') as Array<{
      id: string;
      label: string;
      cli_flag: string | null;
      sort_order: number;
    }>;

    expect(results).toEqual([
      {
        provider: 'codex',
        added: ['codex:gpt-5.4'],
        updated: [],
        removed: [],
      },
    ]);
    expect(models).toEqual([
      {
        id: 'codex:gpt-5.4',
        label: 'gpt-5.4',
        cli_flag: 'gpt-5.4',
        sort_order: 1,
      },
    ]);
  });

  it('discovers Gemini 3.7 as the default Antigravity model without removing older families', async () => {
    execSyncMock.mockImplementation((cmd) => cmd === 'which agy' ? '/usr/local/bin/agy' : '');

    const results = await discoverModels('antigravity');
    const models = db.prepare(
      'SELECT id, cli_flag, sort_order FROM models WHERE provider = ? ORDER BY sort_order ASC'
    ).all('antigravity');

    expect(results).toEqual([
      {
        provider: 'antigravity',
        added: [
          'antigravity:gemini-3.7-flash',
          'antigravity:gemini-3.6-flash',
          'antigravity:gemini-3.5-flash',
          'antigravity:gemini-3.1-pro',
        ],
        updated: [],
        removed: [],
      },
    ]);
    expect(models).toEqual([
      { id: 'antigravity:gemini-3.7-flash', cli_flag: 'gemini-3.7-flash-high', sort_order: 0 },
      { id: 'antigravity:gemini-3.6-flash', cli_flag: 'gemini-3.6-flash-high', sort_order: 1 },
      { id: 'antigravity:gemini-3.5-flash', cli_flag: 'gemini-3.5-flash-high', sort_order: 2 },
      { id: 'antigravity:gemini-3.1-pro', cli_flag: 'gemini-3.1-pro-high', sort_order: 3 },
    ]);
  });
});
