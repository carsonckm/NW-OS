/**
 * The company business calendar (Phase 6 Batch 4): which days are working days, in the
 * company's time zone, for counting approval SLAs. One row in business_calendar plus
 * business_holidays, seeded from the Phase 5 calendar defaults (Monday to Saturday, Malaysian
 * public holidays). SLA time only runs on working days; a non-working day adds nothing.
 */
import type { Pool, PoolClient } from '../db/pool';

type Db = Pool | PoolClient;
export const DAY_MS = 86400_000;

export interface BusinessCalendar {
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  workingDays: Set<number>;
  offsetMs: number;
  holidays: Set<string>;
}

export const DEFAULT_CALENDAR: BusinessCalendar = { workingDays: new Set([1, 2, 3, 4, 5, 6]), offsetMs: 480 * 60_000, holidays: new Set() };

export async function loadCalendar(db: Db): Promise<BusinessCalendar> {
  const row = (await db.query('SELECT working_days, utc_offset_minutes FROM business_calendar WHERE id = 1')).rows[0];
  const holidays = (await db.query(`SELECT to_char(day, 'YYYY-MM-DD') AS d FROM business_holidays`)).rows.map((r) => r.d as string);
  if (!row) return { ...DEFAULT_CALENDAR, holidays: new Set(holidays) };
  return { workingDays: new Set((row.working_days as number[]).map(Number)), offsetMs: Number(row.utc_offset_minutes) * 60_000, holidays: new Set(holidays) };
}

/** Whether the local day starting at `localMidnight` (ms, shifted to local time) is a working day. */
function working(cal: BusinessCalendar, localMs: number) {
  const d = new Date(localMs);
  const iso = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  return cal.workingDays.has(iso) && !cal.holidays.has(d.toISOString().slice(0, 10));
}

/** Working time (ms) between two instants: only the parts that fall on working days count. */
export function businessElapsedMs(cal: BusinessCalendar, from: Date, to: Date): number {
  let a = from.getTime() + cal.offsetMs;
  const b = to.getTime() + cal.offsetMs;
  if (b <= a) return 0;
  let total = 0;
  for (let i = 0; a < b && i < 3700; i++) {
    const dayEnd = Math.floor(a / DAY_MS) * DAY_MS + DAY_MS;
    const end = Math.min(dayEnd, b);
    if (working(cal, a)) total += end - a;
    a = end;
  }
  return total;
}

/** The instant `days` working days after `from` (fractions allowed). */
export function addBusinessDays(cal: BusinessCalendar, from: Date, days: number): Date {
  let remaining = Math.max(0, days) * DAY_MS;
  let a = from.getTime() + cal.offsetMs;
  for (let i = 0; i < 3700; i++) {
    const dayEnd = Math.floor(a / DAY_MS) * DAY_MS + DAY_MS;
    if (working(cal, a)) {
      const chunk = Math.min(remaining, dayEnd - a);
      remaining -= chunk;
      a += chunk;
      if (remaining <= 0) return new Date(a - cal.offsetMs);
    }
    a = dayEnd;
  }
  return new Date(a - cal.offsetMs);
}
