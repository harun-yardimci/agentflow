/**
 * Shared lifecycle for the engine's periodic pollers (routines, cleanup,
 * rate-limit resume, worktree cleanup). Centralizes the timer + start/stop +
 * error-isolation boilerplate so each poller only supplies its work function.
 *
 * The work function is responsible for its own "did N things" logging; this
 * wrapper only guarantees a thrown error from one tick is caught and never
 * tears down the timer.
 */

export interface PeriodicScheduler {
  start(): void;
  stop(): void;
}

export function createPeriodicScheduler(opts: {
  /** Short tag used in error logs, e.g. 'Routine'. */
  name: string;
  intervalMs: number;
  /** Run once immediately on start (default true). */
  runOnStart?: boolean;
  task: () => void;
}): PeriodicScheduler {
  let timer: ReturnType<typeof setInterval> | null = null;

  const run = (phase: 'startup' | 'scheduled') => {
    try {
      opts.task();
    } catch (err) {
      console.error(`[${opts.name}] ${phase} run failed:`, (err as Error).message);
    }
  };

  return {
    start() {
      if (opts.runOnStart !== false) run('startup');
      timer = setInterval(() => run('scheduled'), opts.intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
