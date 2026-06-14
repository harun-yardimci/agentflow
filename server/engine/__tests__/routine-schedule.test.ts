import { describe, it, expect } from 'vitest';
import { computeNextTrigger } from '../routine-schedule.js';

/**
 * All assertions use local-time Date constructors so they hold regardless of
 * the runner's timezone — computeNextTrigger interprets schedules in local time.
 */
describe('computeNextTrigger', () => {
  describe('hourly', () => {
    const sched = { scheduleKind: 'hourly' as const, scheduleTime: '00:00', scheduleWeekday: 0 };

    it('rolls to the top of the next hour', () => {
      const from = new Date(2026, 0, 1, 10, 30, 15);
      const next = computeNextTrigger(sched, from);
      expect(next).toEqual(new Date(2026, 0, 1, 11, 0, 0, 0));
    });

    it('on the exact hour still advances (strictly after)', () => {
      const from = new Date(2026, 0, 1, 10, 0, 0, 0);
      const next = computeNextTrigger(sched, from);
      expect(next).toEqual(new Date(2026, 0, 1, 11, 0, 0, 0));
    });

    it('crosses midnight', () => {
      const from = new Date(2026, 0, 1, 23, 45, 0);
      const next = computeNextTrigger(sched, from);
      expect(next).toEqual(new Date(2026, 0, 2, 0, 0, 0, 0));
    });
  });

  describe('daily', () => {
    const sched = { scheduleKind: 'daily' as const, scheduleTime: '09:00', scheduleWeekday: 0 };

    it('targets today when the time is still ahead', () => {
      const from = new Date(2026, 0, 1, 8, 0, 0);
      const next = computeNextTrigger(sched, from);
      expect(next).toEqual(new Date(2026, 0, 1, 9, 0, 0, 0));
    });

    it('rolls to tomorrow when the time has passed', () => {
      const from = new Date(2026, 0, 1, 9, 30, 0);
      const next = computeNextTrigger(sched, from);
      expect(next).toEqual(new Date(2026, 0, 2, 9, 0, 0, 0));
    });

    it('at the exact time advances to the next day', () => {
      const from = new Date(2026, 0, 1, 9, 0, 0, 0);
      const next = computeNextTrigger(sched, from);
      expect(next).toEqual(new Date(2026, 0, 2, 9, 0, 0, 0));
    });

    it('falls back to 09:00 on malformed time', () => {
      const next = computeNextTrigger(
        { scheduleKind: 'daily', scheduleTime: 'bogus', scheduleWeekday: 0 },
        new Date(2026, 0, 1, 6, 0, 0),
      );
      expect(next).toEqual(new Date(2026, 0, 1, 9, 0, 0, 0));
    });
  });

  describe('weekly', () => {
    // 2026-01-01 is a Thursday (getDay() === 4).
    it('targets later this week when the weekday is ahead', () => {
      // Thu 08:00 → next Saturday (6) 10:00
      const next = computeNextTrigger(
        { scheduleKind: 'weekly', scheduleTime: '10:00', scheduleWeekday: 6 },
        new Date(2026, 0, 1, 8, 0, 0),
      );
      expect(next).toEqual(new Date(2026, 0, 3, 10, 0, 0, 0));
    });

    it('rolls a full week when the weekday already passed', () => {
      // Thu (4) targeting Monday (1) → next Monday
      const next = computeNextTrigger(
        { scheduleKind: 'weekly', scheduleTime: '09:00', scheduleWeekday: 1 },
        new Date(2026, 0, 1, 12, 0, 0),
      );
      expect(next).toEqual(new Date(2026, 0, 5, 9, 0, 0, 0));
    });

    it('same weekday but time passed rolls a full week', () => {
      // Thu (4) targeting Thursday (4), time already passed → +7 days
      const next = computeNextTrigger(
        { scheduleKind: 'weekly', scheduleTime: '07:00', scheduleWeekday: 4 },
        new Date(2026, 0, 1, 8, 0, 0),
      );
      expect(next).toEqual(new Date(2026, 0, 8, 7, 0, 0, 0));
    });

    it('same weekday and time ahead targets today', () => {
      const next = computeNextTrigger(
        { scheduleKind: 'weekly', scheduleTime: '20:00', scheduleWeekday: 4 },
        new Date(2026, 0, 1, 8, 0, 0),
      );
      expect(next).toEqual(new Date(2026, 0, 1, 20, 0, 0, 0));
    });
  });
});
