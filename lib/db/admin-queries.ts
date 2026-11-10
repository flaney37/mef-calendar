// Database access for the /admin panel. Callers must have checked the
// admin session first (app/admin/actions.ts does).

import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { EventInput } from "@/lib/event-input";
import { meetingKind, toHHMM, type Meeting } from "@/lib/schedule";
import { db } from "./index";
import { courseEvents, ingestedMails, meetings, sections, semesters } from "./schema";

export async function currentSemester() {
  const [semester] = await db
    .select({
      id: semesters.id,
      name: semesters.name,
      startDate: semesters.startDate,
      endDate: semesters.endDate,
      holidays: semesters.holidays,
    })
    .from(semesters)
    .orderBy(desc(semesters.startDate))
    .limit(1);
  if (!semester) throw new Error("No semester in the database; run pnpm db:seed");
  return semester;
}

export async function courseMeetings(semesterId: number, courseCode: string): Promise<Meeting[]> {
  return db
    .select({
      courseCode: meetings.courseCode,
      section: meetings.section,
      weekday: meetings.weekday,
      startTime: meetings.startTime,
      endTime: meetings.endTime,
      room: meetings.room,
    })
    .from(meetings)
    .where(and(eq(meetings.semesterId, semesterId), eq(meetings.courseCode, courseCode)))
    .orderBy(meetings.section, meetings.weekday, meetings.startTime);
}

export type AdminSection = {
  section: string;
  courseName: string | null;
  slots: { weekday: number; startTime: string; endTime: string; room: string | null; kind: "lecture" | "lab" }[];
};

// Sections of a course with their weekly slots, for the event form.
export async function courseSections(semesterId: number, courseCode: string): Promise<AdminSection[]> {
  const [rows, slots] = await Promise.all([
    db
      .select({ section: sections.section, courseName: sections.courseName })
      .from(sections)
      .where(and(eq(sections.semesterId, semesterId), eq(sections.courseCode, courseCode))),
    courseMeetings(semesterId, courseCode),
  ]);
  return rows
    .sort((a, b) => a.section.localeCompare(b.section, undefined, { numeric: true }))
    .map((r) => {
      const own = slots.filter((m) => m.section === r.section);
      return {
        section: r.section,
        courseName: r.courseName,
        slots: own.map((m) => ({
          weekday: m.weekday,
          startTime: toHHMM(m.startTime),
          endTime: toHHMM(m.endTime),
          room: m.room,
          kind: meetingKind(m, own),
        })),
      };
    });
}

export type AdminEvent = EventInput & { id: number; source: "manual" | "mail" };

const eventColumns = {
  id: courseEvents.id,
  source: courseEvents.source,
  courseCode: courseEvents.courseCode,
  section: courseEvents.section,
  type: courseEvents.type,
  date: courseEvents.date,
  startTime: courseEvents.startTime,
  endTime: courseEvents.endTime,
  room: courseEvents.room,
  title: courseEvents.title,
  note: courseEvents.note,
  status: courseEvents.status,
};

export async function listEvents(semesterId: number): Promise<AdminEvent[]> {
  const rows = await db
    .select(eventColumns)
    .from(courseEvents)
    .where(eq(courseEvents.semesterId, semesterId))
    .orderBy(asc(courseEvents.date), asc(courseEvents.startTime), asc(courseEvents.courseCode));
  // Postgres `time` comes back as "HH:MM:SS"; the form works with "HH:MM".
  return rows.map((r) => ({
    ...r,
    startTime: r.startTime && toHHMM(r.startTime),
    endTime: r.endTime && toHHMM(r.endTime),
  }));
}

export async function insertEvent(semesterId: number, event: EventInput) {
  await db.insert(courseEvents).values({ ...event, semesterId, source: "manual" });
}

export async function updateEvent(semesterId: number, id: number, event: EventInput) {
  const rows = await db
    .update(courseEvents)
    .set(event)
    .where(and(eq(courseEvents.id, id), eq(courseEvents.semesterId, semesterId)))
    .returning({ id: courseEvents.id });
  return rows.length > 0;
}

export type AdminMail = {
  id: number;
  volunteerId: number | null;
  sentAt: string; // ISO
  subject: string | null; // kept only for mails about the volunteer's courses
  outcome: "processed" | "ignored" | "unsure";
  reason: string | null;
  events: { id: number; courseCode: string; section: string | null; type: AdminEvent["type"]; date: string; status: "confirmed" | "unconfirmed" }[];
};

// The latest mails volunteers' scripts sent, newest first, with what each
// one became. No mail text exists to show: it is never stored.
export async function listRecentMails(limit = 40): Promise<AdminMail[]> {
  const mails = await db
    .select({
      id: ingestedMails.id,
      volunteerId: ingestedMails.volunteerId,
      sentAt: ingestedMails.sentAt,
      subject: ingestedMails.subject,
      outcome: ingestedMails.outcome,
      reason: ingestedMails.reason,
    })
    .from(ingestedMails)
    .orderBy(desc(ingestedMails.sentAt))
    .limit(limit);
  const ids = mails.map((m) => m.id);
  const events =
    ids.length === 0
      ? []
      : await db
          .select({
            id: courseEvents.id,
            mailId: courseEvents.mailId,
            courseCode: courseEvents.courseCode,
            section: courseEvents.section,
            type: courseEvents.type,
            date: courseEvents.date,
            status: courseEvents.status,
          })
          .from(courseEvents)
          .where(inArray(courseEvents.mailId, ids))
          .orderBy(asc(courseEvents.date));
  return mails.map((m) => ({
    ...m,
    sentAt: m.sentAt.toISOString(),
    events: events
      .filter((e) => e.mailId === m.id)
      .map((e) => ({ id: e.id, courseCode: e.courseCode, section: e.section, type: e.type, date: e.date, status: e.status })),
  }));
}

// The review step for events read from mails: one click in /admin.
export async function confirmEvent(semesterId: number, id: number) {
  const rows = await db
    .update(courseEvents)
    .set({ status: "confirmed" })
    .where(and(eq(courseEvents.id, id), eq(courseEvents.semesterId, semesterId)))
    .returning({ id: courseEvents.id });
  return rows.length > 0;
}

export async function deleteEvent(semesterId: number, id: number) {
  const rows = await db
    .delete(courseEvents)
    .where(and(eq(courseEvents.id, id), eq(courseEvents.semesterId, semesterId)))
    .returning({ id: courseEvents.id });
  return rows.length > 0;
}
