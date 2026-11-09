import { describe, expect, it } from "vitest";
import { parseCatalog, parseSlot } from "./catalog";

const file = (sections: unknown[]) => ({
  source: "https://sis.mef.edu.tr/dersler/dersprogrami/tumprogram",
  fetchedAt: "2026-11-09T22:32:27.550Z",
  sections,
});

// Real rows from the 2026-2027 Fall catalog.
const comp201 = {
  code: "COMP 201",
  name: "Data Structures and Algorithms",
  section: "1",
  instructors: ["YASSINE DRIAS"],
  slots: ["A101 / Pazartesi / 09:00 - 11:50", "A415 / Pazartesi / 13:00 - 14:50"],
};

describe("parseSlot", () => {
  it("reads room, weekday and times", () => {
    expect(parseSlot("A101 / Pazartesi / 09:00 - 11:50")).toEqual({
      room: "A101",
      weekday: 1,
      startTime: "09:00",
      endTime: "11:50",
    });
  });

  it.each([
    ["Salı", 2],
    ["Çarşamba", 3],
    ["Perşembe", 4],
    ["Cuma", 5],
    ["Cumartesi", 6],
  ])("maps %s to %i", (day, weekday) => {
    expect(parseSlot(`C003 / ${day} / 13:00 - 15:50`).weekday).toBe(weekday);
  });

  it("rejects anything it does not understand instead of guessing", () => {
    expect(() => parseSlot("A101 / Monday / 09:00 - 11:50")).toThrow();
    expect(() => parseSlot("TBA")).toThrow();
  });
});

describe("parseCatalog", () => {
  it("normalizes codes and keeps every slot", () => {
    const [section] = parseCatalog(file([comp201]));
    expect(section.courseCode).toBe("COMP201");
    expect(section.section).toBe("1");
    expect(section.instructor).toBe("YASSINE DRIAS");
    expect(section.slots).toHaveLength(2);
    expect(section.slots[1]).toEqual({
      room: "A415",
      weekday: 1,
      startTime: "13:00",
      endTime: "14:50",
    });
  });

  it("joins multiple instructors", () => {
    const [section] = parseCatalog(
      file([{ ...comp201, instructors: ["HÜSEYİN KAYA", "YASEMİN TURKAN"] }]),
    );
    expect(section.instructor).toBe("HÜSEYİN KAYA, YASEMİN TURKAN");
  });

  it("accepts cross-listed codes", () => {
    const [section] = parseCatalog(file([{ ...comp201, code: "POLS/IR 200" }]));
    expect(section.courseCode).toBe("POLS/IR200");
  });

  it("drops a slot SIS lists twice", () => {
    const [section] = parseCatalog(
      file([
        {
          ...comp201,
          code: "FIN 525",
          slots: ["Online / Salı / 17:00 - 19:50", "Online / Salı / 17:00 - 19:50"],
        },
      ]),
    );
    expect(section.slots).toEqual([
      { room: "Online", weekday: 2, startTime: "17:00", endTime: "19:50" },
    ]);
  });

  it("rejects duplicate sections", () => {
    expect(() => parseCatalog(file([comp201, comp201]))).toThrow(/Duplicate/);
  });

  it("rejects a file with the wrong shape", () => {
    expect(() => parseCatalog({ sections: "nope" })).toThrow();
  });
});
