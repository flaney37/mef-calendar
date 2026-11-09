import { describe, expect, it } from "vitest";
import {
  buildCalendar,
  escapeText,
  foldLine,
  formatIstanbul,
  formatUtc,
  type IcsEvent,
} from "./ics";

const bytes = (s: string) => new TextEncoder().encode(s).length;
const unfold = (s: string) => s.replace(/\r\n /g, "");

const now = new Date("2026-09-01T12:00:00Z");

const event: IcsEvent = {
  uid: "COMP201-1-20260914-0900@mef-calendar",
  start: new Date("2026-09-14T06:00:00Z"),
  end: new Date("2026-09-14T07:50:00Z"),
  summary: "COMP 201",
  location: "5-101",
  description: "Data Structures\nSection: 1",
};

describe("formatUtc", () => {
  it("writes basic UTC format without separators or milliseconds", () => {
    expect(formatUtc(new Date("2026-09-14T06:00:00.000Z"))).toBe("20260914T060000Z");
  });
});

describe("formatIstanbul", () => {
  it("writes Istanbul wall-clock time without the Z suffix", () => {
    expect(formatIstanbul(new Date("2026-09-14T06:00:00.000Z"))).toBe("20260914T090000");
  });

  it("rolls over to the next day after 21:00 UTC", () => {
    expect(formatIstanbul(new Date("2026-09-14T22:30:00.000Z"))).toBe("20260915T013000");
  });
});

describe("escapeText", () => {
  it("escapes separators and newlines", () => {
    expect(escapeText("Lab; Section A, B\nRoom 5")).toBe("Lab\\; Section A\\, B\\nRoom 5");
  });

  it("escapes backslashes first so they are not doubled twice", () => {
    expect(escapeText("a\\b;")).toBe("a\\\\b\\;");
  });

  it("leaves Turkish characters and emoji alone", () => {
    expect(escapeText("❌ İPTAL – Çarşamba")).toBe("❌ İPTAL – Çarşamba");
  });
});

describe("foldLine", () => {
  it("leaves short lines unchanged", () => {
    expect(foldLine("SUMMARY:COMP 201")).toBe("SUMMARY:COMP 201");
  });

  it("keeps every physical line within 75 bytes", () => {
    const folded = foldLine(`DESCRIPTION:${"x".repeat(300)}`);
    for (const line of folded.split("\r\n")) expect(bytes(line)).toBeLessThanOrEqual(75);
    expect(unfold(folded)).toBe(`DESCRIPTION:${"x".repeat(300)}`);
  });

  it("never splits a multi-byte character", () => {
    const original = `SUMMARY:${"İĞÜŞÖÇ❌📝".repeat(20)}`;
    const folded = foldLine(original);
    for (const line of folded.split("\r\n")) {
      expect(bytes(line)).toBeLessThanOrEqual(75);
      expect(line).not.toContain("�"); // replacement char = broken UTF-8
    }
    expect(unfold(folded)).toBe(original);
  });
});

describe("buildCalendar", () => {
  const ics = buildCalendar({ name: "MEF Ders Takvimi", events: [event], now });

  it("uses CRLF line endings everywhere, including the end", () => {
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("wraps events in a VCALENDAR with the required headers", () => {
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("VERSION:2.0");
    expect(lines).toContain("PRODID:-//mef-calendar//TR");
    expect(lines).toContain("X-WR-CALNAME:MEF Ders Takvimi");
  });

  it("defines Europe/Istanbul as a fixed +03:00 zone", () => {
    const lines = ics.split("\r\n");
    const start = lines.indexOf("BEGIN:VTIMEZONE");
    expect(start).toBeGreaterThan(0);
    expect(lines.slice(start, start + 9)).toEqual([
      "BEGIN:VTIMEZONE",
      "TZID:Europe/Istanbul",
      "BEGIN:STANDARD",
      "DTSTART:19700101T000000",
      "TZOFFSETFROM:+0300",
      "TZOFFSETTO:+0300",
      "TZNAME:+03",
      "END:STANDARD",
      "END:VTIMEZONE",
    ]);
    // The zone must be defined before any event that uses it.
    expect(start).toBeLessThan(lines.indexOf("BEGIN:VEVENT"));
  });

  it("never mixes UTC and local event times", () => {
    // Only inside events: VTIMEZONE has its own required bare DTSTART.
    const vevents = ics.split("BEGIN:VEVENT").slice(1).join("");
    expect(vevents).toContain("DTSTART;TZID=");
    expect(vevents).not.toMatch(/^DT(START|END):/m);
  });

  it("writes the event fields", () => {
    const lines = unfold(ics).split("\r\n");
    expect(lines).toEqual(
      expect.arrayContaining([
        "BEGIN:VEVENT",
        "UID:COMP201-1-20260914-0900@mef-calendar",
        "DTSTAMP:20260901T120000Z",
        "DTSTART;TZID=Europe/Istanbul:20260914T090000",
        "DTEND;TZID=Europe/Istanbul:20260914T105000",
        "SUMMARY:COMP 201",
        "LOCATION:5-101",
        "DESCRIPTION:Data Structures\\nSection: 1",
        "END:VEVENT",
      ]),
    );
    expect(ics).not.toContain("STATUS:");
  });

  it("omits empty optional fields", () => {
    const out = buildCalendar({
      name: "x",
      events: [{ ...event, location: null, description: "" }],
      now,
    });
    expect(out).not.toContain("LOCATION:");
    expect(out).not.toContain("DESCRIPTION:");
  });

  it("marks cancelled events", () => {
    const out = buildCalendar({
      name: "x",
      events: [{ ...event, summary: "❌ İPTAL – COMP 201", status: "CANCELLED" }],
      now,
    });
    expect(out).toContain("STATUS:CANCELLED");
    expect(out).toContain("SUMMARY:❌ İPTAL – COMP 201");
  });

  it("writes all-day events as dates, ending on the next day", () => {
    const out = buildCalendar({
      name: "x",
      events: [{ uid: "event-1@mef-calendar", summary: "📝 COMP 201 Vize", allDay: "2026-12-31" }],
      now,
    });
    expect(out).toContain("DTSTART;VALUE=DATE:20261231\r\n");
    expect(out).toContain("DTEND;VALUE=DATE:20270101\r\n"); // across the year end
  });

  it("produces a valid calendar with no events", () => {
    const out = buildCalendar({ name: "x", events: [], now });
    expect(out).toContain("BEGIN:VCALENDAR");
    expect(out).not.toContain("BEGIN:VEVENT");
  });
});
