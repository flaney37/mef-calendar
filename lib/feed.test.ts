import { describe, expect, it } from "vitest";
import { buildFeed, type FeedInput } from "./feed";

const input: FeedInput = {
  semester: {
    startDate: "2026-09-14",
    endDate: "2026-12-11",
    holidays: ["2026-10-28", "2026-10-29", "2026-10-30"],
  },
  meetings: [
    {
      courseCode: "COMP201",
      section: "1",
      weekday: 1,
      startTime: "09:00:00",
      endTime: "10:50:00",
      room: "5-101",
    },
  ],
  sections: [
    { courseCode: "COMP201", section: "1", courseName: "Data Structures", instructor: "Ayşe Yılmaz" },
  ],
  now: new Date("2026-09-01T12:00:00Z"),
};

const unfold = (s: string) => s.replace(/\r\n /g, "");
const events = (ics: string) => unfold(ics).split("BEGIN:VEVENT").slice(1);

describe("buildFeed", () => {
  it("creates one event per session", () => {
    expect(events(buildFeed(input))).toHaveLength(13);
  });

  it("shows the course code with a space, room and Istanbul local time", () => {
    const [first] = events(buildFeed(input));
    expect(first).toContain("SUMMARY:COMP 201\r\n");
    expect(first).toContain("LOCATION:5-101\r\n");
    expect(first).toContain("DTSTART;TZID=Europe/Istanbul:20260914T090000\r\n");
    expect(first).toContain("UID:COMP201-1-20260914-0900@mef-calendar\r\n");
  });

  it("puts course name, section and instructor in the description", () => {
    const [first] = events(buildFeed(input));
    expect(first).toContain(
      "DESCRIPTION:Data Structures\\nSection: 1\\nÖğretim üyesi: Ayşe Yılmaz\r\n",
    );
  });

  it("still works when the section has no name or instructor", () => {
    const [first] = events(buildFeed({ ...input, sections: [] }));
    expect(first).toContain("DESCRIPTION:Section: 1\r\n");
  });

  it("returns an empty calendar for a student with no timed courses", () => {
    const ics = buildFeed({ ...input, meetings: [] });
    expect(ics).toContain("X-WR-CALNAME:MEF Ders Takvimi");
    expect(events(ics)).toHaveLength(0);
  });
});
