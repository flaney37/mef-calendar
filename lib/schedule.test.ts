import { describe, expect, it } from "vitest";
import {
  expandSessions,
  istanbulToInstant,
  isoWeekday,
  meetingKind,
  sessionUid,
  type Meeting,
  type Semester,
} from "./schedule";

// The real 2026-2027 Fall semester (see CLAUDE.md → Academic calendar).
const fall2026: Semester = {
  startDate: "2026-09-14",
  endDate: "2026-12-11",
  holidays: ["2026-10-28", "2026-10-29", "2026-10-30"],
};

function meeting(overrides: Partial<Meeting>): Meeting {
  return {
    courseCode: "COMP201",
    section: "1",
    weekday: 1,
    startTime: "09:00",
    endTime: "10:50",
    room: "5-101",
    ...overrides,
  };
}

describe("test environment", () => {
  it("does not run in Istanbul time, so local-time bugs show up", () => {
    // vitest.config.ts sets TZ=America/Los_Angeles (UTC-7/-8).
    expect(new Date(2026, 8, 14).getTimezoneOffset()).toBeGreaterThan(0);
  });
});

describe("isoWeekday", () => {
  it("maps Monday to 1 and Sunday to 7", () => {
    expect(isoWeekday("2026-09-14")).toBe(1); // Monday
    expect(isoWeekday("2026-09-19")).toBe(6); // Saturday
    expect(isoWeekday("2026-09-20")).toBe(7); // Sunday
  });
});

describe("istanbulToInstant", () => {
  it("converts Istanbul wall-clock time to UTC (fixed +03:00)", () => {
    expect(istanbulToInstant("2026-09-14", "09:00").toISOString()).toBe(
      "2026-09-14T06:00:00.000Z",
    );
  });

  it("accepts Postgres time format with seconds", () => {
    expect(istanbulToInstant("2026-09-14", "13:30:00").toISOString()).toBe(
      "2026-09-14T10:30:00.000Z",
    );
  });

  it("rolls back to the previous UTC day for early-morning times", () => {
    expect(istanbulToInstant("2026-09-14", "01:00").toISOString()).toBe(
      "2026-09-13T22:00:00.000Z",
    );
  });

  it("ignores daylight saving: winter dates use the same offset", () => {
    // Europe switches clocks on 2026-10-25; Türkiye does not.
    expect(istanbulToInstant("2026-11-02", "09:00").toISOString()).toBe(
      "2026-11-02T06:00:00.000Z",
    );
  });
});

describe("sessionUid", () => {
  it("has the documented format", () => {
    expect(sessionUid("COMP201", "1", "2026-09-14", "09:00:00")).toBe(
      "COMP201-1-20260914-0900@mef-calendar",
    );
  });

  it("is the same for HH:MM and HH:MM:SS input", () => {
    expect(sessionUid("COMP201", "1", "2026-09-14", "09:00")).toBe(
      sessionUid("COMP201", "1", "2026-09-14", "09:00:00"),
    );
  });
});

describe("meetingKind", () => {
  // COMP 201-1 in Fall 2026.
  const lecture = meeting({ weekday: 1, startTime: "09:00", endTime: "11:50" });
  const lab = meeting({ weekday: 1, startTime: "13:00", endTime: "14:50" });

  it("labels the shorter slot of a section as lab", () => {
    expect(meetingKind(lecture, [lecture, lab])).toBe("lecture");
    expect(meetingKind(lab, [lecture, lab])).toBe("lab");
  });

  it("has no lab when all slots are equally long", () => {
    const tue = meeting({ weekday: 2, startTime: "10:00", endTime: "11:50" });
    const thu = meeting({ weekday: 4, startTime: "10:00", endTime: "11:50" });
    expect(meetingKind(tue, [tue, thu])).toBe("lecture");
    expect(meetingKind(thu, [tue, thu])).toBe("lecture");
  });

  it("calls a single weekly slot a lecture", () => {
    expect(meetingKind(lecture, [lecture])).toBe("lecture");
  });

  it("is set on every expanded session, per section", () => {
    const other = meeting({ courseCode: "MATH211", weekday: 1, startTime: "15:00", endTime: "15:50" });
    const sessions = expandSessions(fall2026, [lecture, lab, other]).filter((s) => s.date === "2026-09-14");
    expect(sessions.map((s) => `${s.courseCode} ${s.startTime} ${s.kind}`)).toEqual([
      "COMP201 09:00 lecture",
      "COMP201 13:00 lab",
      "MATH211 15:00 lecture", // shorter than COMP 201's slots, but its own section has one slot
    ]);
  });
});

describe("expandSessions", () => {
  it("puts a Monday class on every Monday of the semester", () => {
    const sessions = expandSessions(fall2026, [meeting({ weekday: 1 })]);
    expect(sessions).toHaveLength(13);
    expect(sessions[0].date).toBe("2026-09-14");
    expect(sessions.at(-1)?.date).toBe("2026-12-07");
    expect(sessions.every((s) => isoWeekday(s.date) === 1)).toBe(true);
  });

  it("skips holidays", () => {
    const dates = expandSessions(fall2026, [meeting({ weekday: 3 })]).map((s) => s.date);
    expect(dates).not.toContain("2026-10-28");
    expect(dates).toContain("2026-10-21");
    expect(dates).toContain("2026-11-04");
    expect(dates).toHaveLength(12);
  });

  it("includes the first and last day of the semester", () => {
    const friday = expandSessions(fall2026, [meeting({ weekday: 5 })]).map((s) => s.date);
    expect(friday.at(-1)).toBe("2026-12-11"); // endDate is inclusive
    expect(friday).not.toContain("2026-12-18");
    expect(friday).not.toContain("2026-10-30"); // holiday

    const monday = expandSessions(fall2026, [meeting({ weekday: 1 })]).map((s) => s.date);
    expect(monday[0]).toBe("2026-09-14"); // startDate is inclusive
  });

  it("maps weekday 7 to Sunday (JS uses 0 for Sunday)", () => {
    const sessions = expandSessions(fall2026, [meeting({ weekday: 7 })]);
    expect(sessions).toHaveLength(12);
    expect(sessions[0].date).toBe("2026-09-20");
    expect(sessions.every((s) => new Date(`${s.date}T12:00:00Z`).getUTCDay() === 0)).toBe(true);
  });

  it("sets start and end instants in UTC", () => {
    const [first] = expandSessions(fall2026, [meeting({})]);
    expect(first.start.toISOString()).toBe("2026-09-14T06:00:00.000Z");
    expect(first.end.toISOString()).toBe("2026-09-14T07:50:00.000Z");
    expect(first.room).toBe("5-101");
  });

  it("gives every session a unique UID", () => {
    const sessions = expandSessions(fall2026, [
      meeting({ weekday: 1, startTime: "09:00" }),
      meeting({ weekday: 1, startTime: "13:00", endTime: "13:50" }),
      meeting({ courseCode: "MATH211", weekday: 3 }),
    ]);
    expect(new Set(sessions.map((s) => s.uid)).size).toBe(sessions.length);
  });

  it("produces identical UIDs on every run", () => {
    const meetings = [meeting({ weekday: 1 }), meeting({ courseCode: "MATH211", weekday: 4 })];
    const a = expandSessions(fall2026, meetings).map((s) => s.uid);
    const b = expandSessions(fall2026, [...meetings].reverse()).map((s) => s.uid);
    expect(a).toEqual(b);
  });

  it("sorts sessions by start time across courses", () => {
    const sessions = expandSessions(fall2026, [
      meeting({ courseCode: "MATH211", weekday: 1, startTime: "13:00", endTime: "14:50" }),
      meeting({ courseCode: "COMP201", weekday: 1, startTime: "09:00" }),
    ]);
    expect(sessions[0].courseCode).toBe("COMP201");
    expect(sessions[1].courseCode).toBe("MATH211");
  });
});
