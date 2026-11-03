import { describe, expect, it } from 'vitest';
import { calendarDaysUntil } from './operational';

describe('Malaysian project schedule', () => {
  it('uses today instead of the historical demo date', () => {
    expect(calendarDaysUntil('2027-01-30', new Date('2026-11-01T08:00:00Z'))).toBe(90);
  });
  it('changes at Malaysian midnight, including overdue and today', () => {
    expect(calendarDaysUntil('2026-11-03', new Date('2026-11-03T15:59:59Z'))).toBe(0);
    expect(calendarDaysUntil('2026-11-03', new Date('2026-11-03T16:00:00Z'))).toBe(-1);
  });
  it.each(['', 'not a date', '2026-02-30'])('rejects missing/invalid schedule %s', (date) => {
    expect(calendarDaysUntil(date)).toBeNull();
  });
});
