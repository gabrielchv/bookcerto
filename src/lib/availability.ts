import { fromZonedTime } from "date-fns-tz";

type Slot = { startAt: Date; endAt: Date };

export function computeAvailableSlots(input: {
  date: string;
  timezone: string;
  durationMinutes: number;
  schedule: { dayOfWeek: number; startTime: string; endTime: string }[];
  overrides: { date: string; closed?: boolean; startTime?: string | null; endTime?: string | null }[];
  existing: { startAt: Date; endAt: Date }[];
}): Slot[] {
  const { date, timezone, durationMinutes, schedule, overrides, existing } = input;
  const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
  const ms = durationMinutes * 60_000;

  const windows: { start: Date; end: Date }[] = [];
  const closedDates = new Set(overrides.filter((o) => o.closed).map((o) => o.date));

  if (closedDates.has(date)) return [];

  for (const rule of schedule) {
    if (rule.dayOfWeek !== dayOfWeek) continue;
    const start = fromZonedTime(`${date} ${rule.startTime}:00`, timezone);
    const end = fromZonedTime(`${date} ${rule.endTime}:00`, timezone);
    windows.push({ start, end });
  }

  const slots: Slot[] = [];
  for (const w of windows) {
    let cursor = w.start.getTime();
    while (cursor + ms <= w.end.getTime()) {
      const s = new Date(cursor);
      const e = new Date(cursor + ms);
      const overlaps = existing.some((x) => s < x.endAt && e > x.startAt);
      if (!overlaps) slots.push({ startAt: s, endAt: e });
      cursor += ms;
    }
  }
  return slots;
}
