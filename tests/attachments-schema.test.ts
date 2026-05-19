import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { createTables } from '../server/db/schema.js';

describe('Attachment Schema Review', () => {
  it('creates the attachments table in the production schema', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');

    createTables(db);

    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'",
    ).get() as { name?: string } | undefined;

    expect(row?.name).toBe('attachments');

    db.close();
  });
});
