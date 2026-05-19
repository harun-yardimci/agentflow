import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePackageRoot } from '../lib/runtime-paths.js';

const PACKAGE_ROOT = resolvePackageRoot(import.meta.url);
const LEGACY_DB_PATH = path.join(PACKAGE_ROOT, 'data', 'agentflow.db');
const DEFAULT_DB_PATH = path.join(os.homedir(), '.agentflow', 'agentflow.db');

let db: Database.Database | null = null;
let resolvedDbPath: string | null = null;

function resolveDbPath(): string {
  if (resolvedDbPath) {
    return resolvedDbPath;
  }

  const explicitPath = process.env.AGENTFLOW_DB_PATH?.trim();
  const dbPath = explicitPath && explicitPath.length > 0
    ? path.resolve(explicitPath)
    : DEFAULT_DB_PATH;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  if (
    dbPath === DEFAULT_DB_PATH &&
    !fs.existsSync(dbPath) &&
    fs.existsSync(LEGACY_DB_PATH)
  ) {
    fs.copyFileSync(LEGACY_DB_PATH, dbPath);
  }

  resolvedDbPath = dbPath;
  return dbPath;
}

export function getDbPath(): string {
  return resolveDbPath();
}

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(resolveDbPath());
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  }
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
