import { describe, expect, it } from "vitest";
import { scheduleSchema } from "./schedule-input";

const course = {
  code: "comp 201",
  section: "01",
  courseName: " Data Structures ",
  instructor: "",
  slots: [{ weekday: "1", startTime: "09:00", endTime: "10:50", room: " 5-101 " }],
};

describe("scheduleSchema", () => {
  it("normalizes code, section and text fields", () => {
    const parsed = scheduleSchema.parse({ courses: [course] });
    expect(parsed.courses[0]).toEqual({
      code: "COMP201",
      section: "1",
      courseName: "Data Structures",
      instructor: null,
      slots: [{ weekday: 1, startTime: "09:00", endTime: "10:50", room: "5-101" }],
    });
  });

  it("accepts a course with no slots", () => {
    expect(scheduleSchema.safeParse({ courses: [{ ...course, slots: [] }] }).success).toBe(true);
  });

  it("rejects an end time before the start time", () => {
    const bad = { ...course, slots: [{ ...course.slots[0], endTime: "08:00" }] };
    expect(scheduleSchema.safeParse({ courses: [bad] }).success).toBe(false);
  });

  it.each(["9:00", "24:00", "09:60", "nine"])("rejects time %j", (startTime) => {
    const bad = { ...course, slots: [{ ...course.slots[0], startTime }] };
    expect(scheduleSchema.safeParse({ courses: [bad] }).success).toBe(false);
  });

  it("rejects weekday 0 and 8", () => {
    for (const weekday of [0, 8]) {
      const bad = { ...course, slots: [{ ...course.slots[0], weekday }] };
      expect(scheduleSchema.safeParse({ courses: [bad] }).success).toBe(false);
    }
  });

  it("rejects invalid course codes", () => {
    expect(scheduleSchema.safeParse({ courses: [{ ...course, code: "201" }] }).success).toBe(false);
  });

  it("rejects the same course twice, even written differently", () => {
    const result = scheduleSchema.safeParse({
      courses: [course, { ...course, code: "COMP201", section: "2" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty schedule", () => {
    expect(scheduleSchema.safeParse({ courses: [] }).success).toBe(false);
  });
});
