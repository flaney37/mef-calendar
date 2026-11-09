// Minimal iCalendar (RFC 5545) writer. It knows nothing about courses;
// lib/feed.ts turns sessions into IcsEvents.
//
// Event times are written as Istanbul local time with TZID=Europe/Istanbul,
// defined by the VTIMEZONE block below. (Plain UTC "…Z" times also work, but
// iPhone then shows "09:00 (06:00 GMT)" on every event.) DTSTAMP stays in
// UTC because the standard requires it.

import { ISTANBUL_UTC_OFFSET_HOURS } from "./schedule";

export const TZID = "Europe/Istanbul";

// Türkiye has used fixed UTC+3 with no daylight saving since 2016, so a
// single STANDARD rule describes it completely.
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  `TZID:${TZID}`,
  "BEGIN:STANDARD",
  "DTSTART:19700101T000000",
  "TZOFFSETFROM:+0300",
  "TZOFFSETTO:+0300",
  "TZNAME:+03",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export type IcsEvent = {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string | null;
  description?: string | null;
  status?: "CONFIRMED" | "CANCELLED";
};

export type IcsCalendar = {
  name: string;
  events: IcsEvent[];
  now: Date; // DTSTAMP: when this file was generated
};

const encoder = new TextEncoder();

// 2026-09-14T06:00:00.000Z → 20260914T060000Z
export function formatUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// 2026-09-14T06:00:00.000Z → 20260914T090000 (Istanbul wall clock, no "Z")
export function formatIstanbul(date: Date): string {
  const shifted = new Date(date.getTime() + ISTANBUL_UTC_OFFSET_HOURS * 60 * 60 * 1000);
  return formatUtc(shifted).slice(0, -1);
}

// In TEXT values, backslash, semicolon, comma and newlines must be escaped,
// otherwise calendar apps read them as field separators.
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Lines may be at most 75 octets (bytes, not characters). Longer lines are
// split and each continuation starts with a space, which also counts toward
// its 75. Splitting happens between characters, never inside a multi-byte
// UTF-8 character such as "İ" (2 bytes) or "❌" (3 bytes).
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;
  for (const char of line) {
    const size = encoder.encode(char).length;
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      limit = 74; // room for the leading space
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function eventLines(event: IcsEvent, now: Date): string[] {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART;TZID=${TZID}:${formatIstanbul(event.start)}`,
    `DTEND;TZID=${TZID}:${formatIstanbul(event.end)}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];
  if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  if (event.status) lines.push(`STATUS:${event.status}`);
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(calendar: IcsCalendar): string {
  const name = escapeText(calendar.name);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//mef-calendar//TR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `NAME:${name}`,
    `X-WR-CALNAME:${name}`,
    // Hints for how often subscribers should re-fetch (Apple and Outlook
    // read one or the other; Google ignores both and picks its own pace).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    `X-WR-TIMEZONE:${TZID}`,
    ...VTIMEZONE,
    ...calendar.events.flatMap((e) => eventLines(e, calendar.now)),
    "END:VCALENDAR",
  ];
  // Every line, including the last one, ends with CRLF.
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
