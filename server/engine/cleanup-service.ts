import { getDb } from '../db/connection.js';
import { eventBus } from './event-bus.js';

/** Clean up old data based on retention settings */
export function runCleanup(): { logsDeleted: number; runsCleanedUp: number; eventsDeleted: number } {
  const db = getDb();

  // Get retention setting
  const setting = db.prepare("SELECT value FROM settings WHERE key = 'log_retention_days'").get() as { value: string } | undefined;
  const retentionDays = Math.max(1, parseInt(setting?.value ?? '30', 10));
  const cutoff = new Date(Date.now() - retentionDays * 86400000).toISOString();

  let logsDeleted = 0;
  let runsCleanedUp = 0;
  let eventsDeleted = 0;

  const run = db.transaction(() => {
    // 1. Truncate stdout/stderr from old execution_runs (keep metadata)
    const oldRuns = db.prepare(
      "UPDATE execution_runs SET stdout = '[cleaned]', stderr = '[cleaned]' WHERE completed_at < ? AND stdout != '[cleaned]'"
    ).run(cutoff);
    runsCleanedUp = oldRuns.changes;

    // 2. Prune pipeline logs (keep max 1000 per pipeline)
    const pipelines = db.prepare('SELECT id FROM pipelines').all() as { id: string }[];
    for (const p of pipelines) {
      const logCount = db.prepare('SELECT COUNT(*) as count FROM logs WHERE pipeline_id = ?').get(p.id) as { count: number };
      if (logCount.count > 1000) {
        const excess = logCount.count - 800; // Remove 200 extra to avoid frequent cleanup
        db.prepare(
          'DELETE FROM logs WHERE id IN (SELECT id FROM logs WHERE pipeline_id = ? ORDER BY id ASC LIMIT ?)'
        ).run(p.id, excess);
        logsDeleted += excess;
      }
    }

    // 3. Clean expired short-term memory
    db.prepare("DELETE FROM memory WHERE layer = 'short_term' AND expires_at IS NOT NULL AND expires_at < ?")
      .run(new Date().toISOString());

    // 4. Clean old events
    const eventResult = db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff);
    eventsDeleted = eventResult.changes;
  });

  run();

  return { logsDeleted, runsCleanedUp, eventsDeleted };
}

/** Schedule periodic cleanup (every 24 hours) */
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

export function startCleanupScheduler(): void {
  // Run once on startup
  try {
    const result = runCleanup();
    if (result.logsDeleted > 0 || result.runsCleanedUp > 0 || result.eventsDeleted > 0) {
      console.log(`[Cleanup] logs: ${result.logsDeleted}, runs: ${result.runsCleanedUp}, events: ${result.eventsDeleted}`);
    }
  } catch (err) {
    console.error('[Cleanup] Initial cleanup failed:', (err as Error).message);
  }

  // Schedule every 24 hours
  cleanupTimer = setInterval(() => {
    try {
      const result = runCleanup();
      console.log(`[Cleanup] logs: ${result.logsDeleted}, runs: ${result.runsCleanedUp}, events: ${result.eventsDeleted}`);
    } catch (err) {
      console.error('[Cleanup] Scheduled cleanup failed:', (err as Error).message);
    }
  }, 24 * 60 * 60 * 1000);
}

export function stopCleanupScheduler(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
