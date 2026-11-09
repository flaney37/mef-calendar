import { describe, expect, it } from "vitest";
import {
  COURSE_CODE_PATTERN,
  displayCourseCode,
  normalizeCourseCode,
  normalizeSection,
} from "./course-code";

describe("normalizeCourseCode", () => {
  it.each(["COMP 201", "comp201", " Comp  201 ", "COMP\t201"])("%j → COMP201", (input) => {
    expect(normalizeCourseCode(input)).toBe("COMP201");
  });

  it("uppercases i to ASCII I, not Turkish İ", () => {
    expect(normalizeCourseCode("histr 213")).toBe("HISTR213");
  });
});

describe("COURSE_CODE_PATTERN", () => {
  it.each(["COMP201", "HISTR213", "TURK114", "PHYS101L", "MATH1001"])("accepts %s", (code) => {
    expect(COURSE_CODE_PATTERN.test(code)).toBe(true);
  });

  it.each(["COMP", "201", "C201", "COMP20", "COMP 201"])("rejects %j", (code) => {
    expect(COURSE_CODE_PATTERN.test(code)).toBe(false);
  });
});

describe("displayCourseCode", () => {
  it("adds a space between letters and digits", () => {
    expect(displayCourseCode("COMP201")).toBe("COMP 201");
    expect(displayCourseCode("PHYS101L")).toBe("PHYS 101L");
  });
});

describe("normalizeSection", () => {
  it("treats leading zeros as the same section", () => {
    expect(normalizeSection("01")).toBe("1");
    expect(normalizeSection(" 2 ")).toBe("2");
  });

  it("keeps non-numeric sections", () => {
    expect(normalizeSection("a")).toBe("A");
  });
});
