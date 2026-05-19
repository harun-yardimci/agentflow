import Database from 'better-sqlite3';
import { getDbPath } from '../db/connection.js';

const DEFAULT_APP_PORT = 3100;

function parsePort(value: string | undefined | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readPersistedAppPort(): number | null {
  const dbPath = getDbPath();

  try {
    const db = new Database(dbPath, { readonly: true });
    const row = db
      .prepare("SELECT value FROM settings WHERE key = 'port'")
      .get() as { value: string } | undefined;
    db.close();
    return parsePort(row?.value);
  } catch {
    return null;
  }
}

export function resolveAppPort(): number {
  return parsePort(process.env.PORT)
    ?? parsePort(process.env.AGENTFLOW_APP_PORT)
    ?? readPersistedAppPort()
    ?? DEFAULT_APP_PORT;
}

export function resolveApiPortForDev(): number {
  return resolveAppPort() + 1;
}

export { DEFAULT_APP_PORT };
