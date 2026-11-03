/** Date-only business schedules use the company's Malaysian calendar, not elapsed hours. */
export function calendarDaysUntil(date: string, now = new Date()): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const end = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(end) || new Date(end).toISOString().slice(0, 10) !== date) return null;
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  const today = Date.parse(`${value('year')}-${value('month')}-${value('day')}T00:00:00Z`);
  return Math.round((end - today) / 86_400_000);
}
