import { describe, expect, it } from "vitest";
import { dedupeKey, hashToken, ingestSchema, planIngest, senderAllowed, type IngestInput, type VolunteerSection } from "./ingest-plan";
import type { Meeting, Semester } from "./schedule";

const semester: Semester = {
  startDate: "2026-09-14",
  endDate: "2026-12-11",
  holidays: ["2026-10-28", "2026-10-29", "2026-10-30"],
};

const meetings: Meeting[] = [
  { courseCode: "COMP201", section: "1", weekday: 1, startTime: "09:00:00", endTime: "11:50:00", room: "A101" },
  { courseCode: "COMP201", section: "1", weekday: 1, startTime: "13:00:00", endTime: "14:50:00", room: "B201" },
  { courseCode: "COMP201", section: "2", weekday: 2, startTime: "09:00:00", endTime: "11:50:00", room: "A102" },
  { courseCode: "MATH102", section: "1", weekday: 3, startTime: "10:00:00", endTime: "11:50:00", room: "A201" },
];

const mine: VolunteerSection[] = [
  { courseCode: "COMP201", section: "1", courseName: "Data Structures and Algorithms" },
  { courseCode: "MATH102", section: "1", courseName: "Calculus II" },
];

const noLabs: IngestInput = {
  messageId: "<abc123@mef.blackboard.com>",
  from: "TEACHING ASSISTANT - ta@mef.edu.tr <do-not-reply@mef.blackboard.com>",
  subject: "Data Structures and Algorithms: No Labs This Week",
  body: "2026-2027-01-COMP201-01\nThere will be no lab sessions this week (November 9–10).",
  sentAt: "2026-11-08T17:37:00Z",
};

const plan = (input: IngestInput, sections = mine) => planIngest(input, { semester, meetings, sections });

describe("ingestSchema", () => {
  it("accepts what the script sends", () => {
    expect(ingestSchema.safeParse(noLabs).success).toBe(true);
    expect(ingestSchema.safeParse({ ...noLabs, messageId: null }).success).toBe(true);
  });
  it("rejects a missing or malformed date", () => {
    expect(ingestSchema.safeParse({ ...noLabs, sentAt: "yesterday" }).success).toBe(false);
    expect(ingestSchema.safeParse({ ...noLabs, sentAt: undefined }).success).toBe(false);
  });
});

describe("senderAllowed", () => {
  it.each([
    ["Name - x@mef.edu.tr <do-not-reply@mef.blackboard.com>", true],
    ["Öğrenci İşleri <ogrenciisleri@mef.edu.tr>", true],
    ["x@mef.edu.tr", true],
    ["Anyone <someone@gmail.com>", false],
    // A display name that pretends to be MEF doesn't count.
    ['"x@mef.edu.tr" <attacker@example.com>', false],
    ["Fake <x@mef.edu.tr.evil.com>", false],
  ])("%s → %s", (from, ok) => {
    expect(senderAllowed(from)).toBe(ok);
  });
});

describe("hashToken / dedupeKey", () => {
  it("hashes the token, never stores it", () => {
    expect(hashToken("TESTvolunteerToken000000000000000")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("TESTvolunteerToken000000000000000")).not.toContain("TEST");
  });
  it("same Message-ID (any case, with or without <>) → same key", () => {
    expect(dedupeKey(noLabs)).toBe(dedupeKey({ ...noLabs, messageId: "ABC123@mef.blackboard.com", subject: "Fwd: x" }));
    expect(dedupeKey(noLabs)).not.toBe(dedupeKey({ ...noLabs, messageId: "<other@mef.blackboard.com>" }));
  });
  it("no Message-ID → key from sender, date and body", () => {
    const a = { ...noLabs, messageId: null };
    expect(dedupeKey(a)).toBe(dedupeKey({ ...a }));
    expect(dedupeKey(a)).not.toBe(dedupeKey({ ...a, body: a.body + " changed" }));
  });
});

describe("planIngest", () => {
  it("a lab cancellation for the volunteer's section → one event, waiting for review (❓)", () => {
    const p = plan(noLabs);
    expect(p.outcome).toBe("processed");
    expect(p.keepSubject).toBe(true);
    expect(p.events).toEqual([
      expect.objectContaining({ courseCode: "COMP201", section: "1", type: "cancel", date: "2026-11-09", startTime: "13:00", status: "unconfirmed" }),
    ]);
    // The parser was sure, so the note has no doubts listed.
    expect(p.events[0].note).not.toContain("Emin olunmayan");
  });

  it("what the parser wasn't sure about is written into the note for the reviewer", () => {
    const p = plan({ ...noLabs, from: "Hoca <hoca@mef.edu.tr>", subject: "Duyuru", body: "Yarınki COMP 201 dersi yapılmayacaktır.", sentAt: "2026-11-15T10:00:00Z" });
    expect(p.events[0].note).toContain("Emin olunmayan");
  });

  it("a section the volunteer isn't in → unsure, no events", () => {
    const p = plan({ ...noLabs, body: noLabs.body.replace("COMP201-01", "COMP201-02") });
    expect(p).toMatchObject({ outcome: "unsure", events: [], keepSubject: false });
  });

  it("a course the volunteer doesn't take → unsure, subject not kept", () => {
    const p = plan({ ...noLabs, body: noLabs.body.replace("COMP201-01", "PHYS101-01") });
    expect(p).toMatchObject({ outcome: "unsure", events: [], keepSubject: false });
  });

  it("no course key: the subject's course name is matched to the volunteer's courses", () => {
    const p = plan({
      ...noLabs,
      subject: "Calculus II: Lecture cancelled",
      body: "Dear students, tomorrow's lecture is cancelled.",
      sentAt: "2026-11-10T09:00:00Z", // Tue → Wed 11 Nov
    });
    expect(p.outcome).toBe("processed");
    expect(p.events).toEqual([expect.objectContaining({ courseCode: "MATH102", section: "1", date: "2026-11-11", status: "unconfirmed" })]);
  });

  it("a course code without a section → the volunteer's section, unconfirmed", () => {
    const p = plan({
      ...noLabs,
      from: "Hoca <hoca@mef.edu.tr>",
      subject: "Duyuru",
      body: "Yarınki COMP 201 dersi yapılmayacaktır.",
      sentAt: "2026-11-15T10:00:00Z", // Sun → Mon 16 Nov
    });
    expect(p.events).toEqual([
      expect.objectContaining({ courseCode: "COMP201", section: "1", date: "2026-11-16", startTime: "09:00", status: "unconfirmed" }),
    ]);
  });

  it("a notification mail → ignored, subject not kept", () => {
    expect(plan({ ...noLabs, subject: "Daily Notifications", body: "Your updates" })).toMatchObject({
      outcome: "ignored",
      keepSubject: false,
    });
  });

  it("a personal mail that slipped through → no subject kept", () => {
    const p = plan({ ...noLabs, subject: "Fwd: Mazeret Bildirim Formu - Ad Soyad", body: "Sayın hocalarım, ekte mazeret formu var. Sınav tarihi değişebilir." });
    expect(p.keepSubject).toBe(false);
    expect(p.events).toEqual([]);
  });
});
