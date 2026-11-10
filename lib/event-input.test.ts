import { describe, expect, it } from "vitest";
import { eventSchema, sessionTargetError, type EventInput } from "./event-input";
import type { Meeting, Semester } from "./schedule";

const fall2026: Semester = {
  startDate: "2026-09-14",
  endDate: "2026-12-11",
  holidays: ["2026-10-28", "2026-10-29", "2026-10-30"],
};

// COMP 201: section 1 Mon lecture + Mon lab, section 2 Mon lecture + Tue lab.
const meetings: Meeting[] = [
  { courseCode: "COMP201", section: "1", weekday: 1, startTime: "09:00:00", endTime: "11:50:00", room: "A101" },
  { courseCode: "COMP201", section: "1", weekday: 1, startTime: "13:00:00", endTime: "14:50:00", room: "A415" },
  { courseCode: "COMP201", section: "2", weekday: 1, startTime: "09:00:00", endTime: "11:50:00", room: "A101" },
  { courseCode: "COMP201", section: "2", weekday: 2, startTime: "13:00:00", endTime: "14:50:00", room: "A303" },
];

const form = {
  courseCode: "comp 201",
  section: "1",
  type: "cancel",
  date: "2026-11-16", // a Monday
  startTime: "13:00",
  endTime: "",
  room: "",
  title: "",
  note: "",
  status: "confirmed",
};
const parse = (overrides: Record<string, string>) => eventSchema.parse({ ...form, ...overrides });

describe("eventSchema", () => {
  it("normalizes the form values", () => {
    expect(parse({})).toEqual({
      courseCode: "COMP201",
      section: "1",
      type: "cancel",
      date: "2026-11-16",
      startTime: "13:00",
      endTime: null,
      room: null,
      title: null,
      note: null,
      status: "confirmed",
    });
  });

  it("treats an empty section as all sections and an empty time as all sessions", () => {
    const e = parse({ section: "", startTime: "" });
    expect(e.section).toBeNull();
    expect(e.startTime).toBeNull();
  });

  it("requires the new room for a room change", () => {
    expect(eventSchema.safeParse({ ...form, type: "room_change" }).success).toBe(false);
    expect(parse({ type: "room_change", room: "B202" }).room).toBe("B202");
  });

  it("drops the end time of a session change (the session defines it)", () => {
    expect(parse({ endTime: "14:50" }).endTime).toBeNull();
  });

  it("checks exam times", () => {
    expect(parse({ type: "exam", startTime: "10:00", endTime: "12:00" }).endTime).toBe("12:00");
    expect(eventSchema.safeParse({ ...form, type: "exam", startTime: "12:00", endTime: "10:00" }).success).toBe(false);
    expect(eventSchema.safeParse({ ...form, type: "exam", startTime: "", endTime: "10:00" }).success).toBe(false);
  });

  it("accepts an exam without any time (all-day)", () => {
    expect(parse({ type: "exam", startTime: "", title: "Final" }).startTime).toBeNull();
  });

  it("rejects unknown types and bad dates", () => {
    expect(eventSchema.safeParse({ ...form, type: "party" }).success).toBe(false);
    expect(eventSchema.safeParse({ ...form, date: "16.11.2026" }).success).toBe(false);
  });
});

describe("sessionTargetError", () => {
  const check = (overrides: Record<string, string>) =>
    sessionTargetError(parse(overrides) as EventInput, fall2026, meetings);

  it("accepts a real session: the section 1 lab on a Monday", () => {
    expect(check({})).toBeNull();
  });

  it("accepts all sessions of that day", () => {
    expect(check({ startTime: "" })).toBeNull();
  });

  it("rejects a day without a session", () => {
    expect(check({ date: "2026-11-17" })).toMatch(/Salı günü bu dersin oturumu yok \(oturum günleri: Pazartesi\)/);
  });

  it("rejects a start time with no session", () => {
    expect(check({ startTime: "15:00" })).toMatch(/15:00'da başlayan oturum yok/);
  });

  it("looks at the chosen section only", () => {
    // Section 2's lab is on Tuesday, section 1 has nothing then.
    expect(check({ section: "2", date: "2026-11-17" })).toBeNull();
    expect(check({ section: "1", date: "2026-11-17" })).not.toBeNull();
  });

  it("accepts any section's session for an all-sections event", () => {
    expect(check({ section: "", date: "2026-11-17" })).toBeNull();
  });

  it("rejects dates outside the semester and holidays", () => {
    expect(check({ date: "2026-12-14" })).toMatch(/dönem dışında/);
    expect(check({ date: "2026-10-26", startTime: "" })).toBeNull(); // Monday before the holidays
    expect(check({ type: "cancel", date: "2026-10-28", section: "", startTime: "" })).toMatch(/tatil/);
  });

  it("rejects a course without any meetings", () => {
    expect(check({ courseCode: "HISTR 213" })).toMatch(/saati yok/);
  });

  it("only checks the semester range for separate events", () => {
    expect(check({ type: "exam", date: "2026-11-17", startTime: "10:00" })).toBeNull();
    expect(check({ type: "exam", date: "2027-01-05", startTime: "" })).toMatch(/dönem dışında/);
  });
});
