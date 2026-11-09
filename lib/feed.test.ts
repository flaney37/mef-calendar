import { describe, expect, it } from "vitest";
import { buildFeed, type FeedEvent, type FeedInput } from "./feed";

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

// COMP 201-1 as in the real Fall 2026 catalog: Monday lecture + Monday lab.
const comp201: FeedInput = {
  ...input,
  meetings: [
    { courseCode: "COMP201", section: "1", weekday: 1, startTime: "09:00:00", endTime: "11:50:00", room: "A101" },
    { courseCode: "COMP201", section: "1", weekday: 1, startTime: "13:00:00", endTime: "14:50:00", room: "A415" },
  ],
};

let nextEventId = 1;
function event(overrides: Partial<FeedEvent>): FeedEvent {
  return {
    id: nextEventId++,
    courseCode: "COMP201",
    section: "1",
    type: "cancel",
    date: "2026-11-16",
    startTime: null,
    endTime: null,
    room: null,
    title: null,
    note: null,
    status: "confirmed",
    ...overrides,
  };
}

// The VEVENT text for one UID.
function find(ics: string, uid: string): string {
  const found = events(ics).find((e) => e.includes(`UID:${uid}\r\n`));
  if (!found) throw new Error(`no event ${uid}`);
  return found;
}
const LECTURE_16 = "COMP201-1-20261116-0900@mef-calendar";
const LAB_16 = "COMP201-1-20261116-1300@mef-calendar";

describe("lab label", () => {
  it("calls the shorter weekly slot of a section the lab", () => {
    const ics = buildFeed(comp201);
    expect(find(ics, LECTURE_16)).toContain("SUMMARY:COMP 201\r\n");
    expect(find(ics, LAB_16)).toContain("SUMMARY:COMP 201 Lab\r\n");
  });
});

describe("session changes", () => {
  it("cancels only the targeted session: the lab, not that day's lecture", () => {
    const ics = buildFeed({ ...comp201, events: [event({ startTime: "13:00:00" })] });
    const lab = find(ics, LAB_16);
    expect(lab).toContain("SUMMARY:❌ İPTAL – COMP 201 Lab\r\n");
    expect(lab).toContain("STATUS:CANCELLED\r\n");
    expect(find(ics, LECTURE_16)).toContain("SUMMARY:COMP 201\r\n");
    expect(find(ics, LECTURE_16)).not.toContain("STATUS:");
  });

  it("without a start time, cancels every session of the course that day", () => {
    const ics = buildFeed({ ...comp201, events: [event({})] });
    expect(find(ics, LECTURE_16)).toContain("STATUS:CANCELLED");
    expect(find(ics, LAB_16)).toContain("STATUS:CANCELLED");
    // A week later nothing changed.
    expect(find(ics, "COMP201-1-20261123-0900@mef-calendar")).not.toContain("STATUS:");
  });

  it("keeps the event and its UID, so calendars update it instead of duplicating", () => {
    const plain = events(buildFeed(comp201));
    const cancelled = events(buildFeed({ ...comp201, events: [event({})] }));
    expect(cancelled).toHaveLength(plain.length);
  });

  it("marks an unconfirmed cancellation without cancelling", () => {
    const lecture = find(buildFeed({ ...comp201, events: [event({ status: "unconfirmed" })] }), LECTURE_16);
    expect(lecture).toContain("SUMMARY:❓ Muhtemelen iptal – COMP 201\r\n");
    expect(lecture).not.toContain("STATUS:");
  });

  it("moves a face-to-face session online", () => {
    const lecture = find(
      buildFeed({ ...comp201, events: [event({ type: "online", startTime: "09:00", note: "Zoom linki Blackboard'da" })] }),
      LECTURE_16,
    );
    expect(lecture).toContain("SUMMARY:COMP 201 (Online)\r\n");
    expect(lecture).toContain("LOCATION:Online\r\n");
    expect(lecture).toContain("DESCRIPTION:Bu ders online yapılacak.\\nZoom linki Blackboard'da\\n\\n");
  });

  it("changes the room of one session and says so", () => {
    const lab = find(
      buildFeed({ ...comp201, events: [event({ type: "room_change", startTime: "13:00", room: "B202" })] }),
      LAB_16,
    );
    expect(lab).toContain("LOCATION:B202\r\n");
    expect(lab).toContain("Sınıf değişti: A415 → B202");
  });

  it("does not move an unconfirmed room change, only mentions it", () => {
    const lab = find(
      buildFeed({
        ...comp201,
        events: [event({ type: "room_change", startTime: "13:00", room: "B202", status: "unconfirmed" })],
      }),
      LAB_16,
    );
    expect(lab).toContain("LOCATION:A415\r\n");
    expect(lab).toContain("Sınıf değişmiş olabilir: B202 (kesin değil)");
  });

  it("lets a cancellation win over other changes to the same session", () => {
    const lecture = find(
      buildFeed({ ...comp201, events: [event({ type: "online" }), event({ type: "cancel" })] }),
      LECTURE_16,
    );
    expect(lecture).toContain("SUMMARY:❌ İPTAL – COMP 201\r\n");
  });

  it("applies an all-sections event (section null) to this section", () => {
    const ics = buildFeed({ ...comp201, events: [event({ section: null })] });
    expect(find(ics, LECTURE_16)).toContain("STATUS:CANCELLED");
  });

  it("ignores events of another section or course", () => {
    const ics = buildFeed({
      ...comp201,
      events: [event({ section: "2" }), event({ courseCode: "MATH211" })],
    });
    expect(find(ics, LECTURE_16)).not.toContain("STATUS:");
  });
});

describe("separate events", () => {
  it("adds an exam with its own stable UID", () => {
    const exam = event({ id: 42, type: "exam", title: "Vize", startTime: "10:00", endTime: "12:00", room: "A101" });
    const ics = buildFeed({ ...comp201, events: [exam] });
    const vevent = find(ics, "event-42@mef-calendar");
    expect(vevent).toContain("SUMMARY:📝 COMP 201 Vize\r\n");
    expect(vevent).toContain("DTSTART;TZID=Europe/Istanbul:20261116T100000\r\n");
    expect(vevent).toContain("DTEND;TZID=Europe/Istanbul:20261116T120000\r\n");
    expect(vevent).toContain("LOCATION:A101\r\n");
    // The class sessions of that day are untouched.
    expect(find(ics, LECTURE_16)).toContain("SUMMARY:COMP 201\r\n");
  });

  it("shows an exam without a time as an all-day event", () => {
    const ics = buildFeed({ ...comp201, events: [event({ id: 43, type: "exam", title: "Final", date: "2026-12-18" })] });
    expect(find(ics, "event-43@mef-calendar")).toContain("DTSTART;VALUE=DATE:20261218\r\n");
  });

  it("gives a make-up class one hour when no end time is known", () => {
    const ics = buildFeed({ ...comp201, events: [event({ id: 44, type: "makeup", date: "2026-11-21", startTime: "10:00" })] });
    const makeup = find(ics, "event-44@mef-calendar");
    expect(makeup).toContain("SUMMARY:🔁 COMP 201 Telafi\r\n");
    expect(makeup).toContain("DTEND;TZID=Europe/Istanbul:20261121T110000\r\n");
  });

  it("marks unconfirmed separate events with ❓", () => {
    const ics = buildFeed({ ...comp201, events: [event({ id: 45, type: "exam", status: "unconfirmed" })] });
    expect(find(ics, "event-45@mef-calendar")).toContain("SUMMARY:❓ 📝 COMP 201 Sınav\r\n");
  });
});
