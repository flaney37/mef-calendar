// All date/time logic lives here.
//
// Calendar dates ("2026-09-14") are handled as UTC midnights, never as local
// dates: the server's time zone (Vercel runs in UTC, a laptop in Istanbul)
// must not change the result. Wall-clock times are always Istanbul time and
// are converted to real instants with a fixed +03:00 offset — Türkiye has no
// daylight saving since 2016.

export const ISTANBUL_UTC_OFFSET_HOURS = 3;

export type Semester = {
  startDate: string; // YYYY-MM-DD, first day of classes
  endDate: string; // YYYY-MM-DD, last day of classes (inclusive)
  holidays: string[]; // YYYY-MM-DD
};

export type Meeting = {
  courseCode: string; // normalized, e.g. "COMP201"
  section: string;
  weekday: number; // ISO: 1 = Monday … 7 = Sunday
  startTime: string; // "HH:MM" or "HH:MM:SS" (Postgres `time`)
  endTime: string;
  room: string | null;
};

export type Session = {
  uid: string;
  courseCode: string;
  section: string;
  date: string; // YYYY-MM-DD
  start: Date; // real instant
  end: Date;
  room: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// JS getUTCDay(): 0 = Sunday … 6 = Saturday. ISO: 1 = Monday … 7 = Sunday.
export function isoWeekday(date: string): number {
  const jsDay = new Date(parseDate(date)).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

// "09:00:00" → "09:00"
export function toHHMM(time: string): string {
  return time.slice(0, 5);
}

// Istanbul wall-clock date + time → the real instant it refers to.
export function istanbulToInstant(date: string, time: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = toHHMM(time).split(":").map(Number);
  // Date.UTC handles negative hours by rolling back to the previous day.
  return new Date(Date.UTC(y, m - 1, d, hh - ISTANBUL_UTC_OFFSET_HOURS, mm));
}

// Stable across requests, so calendar apps update an event instead of
// duplicating it: COMP201-1-20260914-0900@mef-calendar
export function sessionUid(
  courseCode: string,
  section: string,
  date: string,
  startTime: string,
): string {
  return `${courseCode}-${section}-${date.replaceAll("-", "")}-${toHHMM(startTime).replace(":", "")}@mef-calendar`;
}

// Every class session of the semester, one per meeting per matching day,
// skipping holidays. Sorted by start time.
export function expandSessions(semester: Semester, meetings: Meeting[]): Session[] {
  const holidays = new Set(semester.holidays);
  const first = parseDate(semester.startDate);
  const last = parseDate(semester.endDate);
  const sessions: Session[] = [];

  for (let ms = first; ms <= last; ms += DAY_MS) {
    const date = formatDate(ms);
    if (holidays.has(date)) continue;
    const weekday = isoWeekday(date);
    for (const m of meetings) {
      if (m.weekday !== weekday) continue;
      sessions.push({
        uid: sessionUid(m.courseCode, m.section, date, m.startTime),
        courseCode: m.courseCode,
        section: m.section,
        date,
        start: istanbulToInstant(date, m.startTime),
        end: istanbulToInstant(date, m.endTime),
        room: m.room,
      });
    }
  }

  return sessions.sort((a, b) => a.start.getTime() - b.start.getTime());
}
