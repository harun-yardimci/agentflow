/**
 * Pure next-trigger computation for routines. Preset-based (hourly/daily/weekly)
 * and interpreted in the server's local timezone — no cron library.
 *
 * Returned Date is an absolute instant; callers persist it via `.toISOString()`
 * so the scheduler's `next_trigger_at <= now` comparison works on UTC strings.
 */

export type ScheduleKind = 'hourly' | 'daily' | 'weekly';

export interface RoutineSchedule {
  scheduleKind: ScheduleKind;
  /** 'HH:MM' (24h) — used by daily/weekly; ignored by hourly. */
  scheduleTime: string;
  /** 0-6, 0 = Sunday — used by weekly. */
  scheduleWeekday: number;
}

/** Parse 'HH:MM', falling back to 09:00 on malformed input. */
function parseHHMM(time: string): { h: number; m: number } {
  const [hStr, mStr] = String(time).split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (!Number.isInteger(h) || h < 0 || h > 23 || !Number.isInteger(m) || m < 0 || m > 59) {
    return { h: 9, m: 0 };
  }
  return { h, m };
}

/** The next instant the routine should fire, strictly after `from`. */
export function computeNextTrigger(schedule: RoutineSchedule, from: Date): Date {
  const { scheduleKind, scheduleTime, scheduleWeekday } = schedule;

  // Hourly: top of the next hour (minute 0), regardless of scheduleTime.
  if (scheduleKind === 'hourly') {
    const next = new Date(from);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    // On a DST fall-back the wall clock repeats an hour, so +1h can land on an
    // instant equal to `from`; keep advancing until strictly after.
    while (next.getTime() <= from.getTime()) next.setHours(next.getHours() + 1);
    return next;
  }

  const { h, m } = parseHHMM(scheduleTime);

  if (scheduleKind === 'daily') {
    const next = new Date(from);
    next.setHours(h, m, 0, 0);
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }

  // Weekly: next occurrence of the target weekday at HH:MM.
  const targetDow = ((Math.trunc(scheduleWeekday) % 7) + 7) % 7;
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  let dayDiff = (targetDow - next.getDay() + 7) % 7;
  if (dayDiff === 0 && next <= from) dayDiff = 7;
  next.setDate(next.getDate() + dayDiff);
  return next;
}
