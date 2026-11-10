// Database side of /api/ingest. The route checks the token format and the
// request body; everything here trusts its arguments.

import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { EventInput } from "@/lib/event-input";
import type { VolunteerSection } from "@/lib/ingest-plan";
import { toHHMM, type Meeting } from "@/lib/schedule";
import { db } from "./index";
import { courseEvents, enrollments, ingestedMails, meetings, sections, semesters, students, volunteers } from "./schema";

export async function findVolunteer(tokenHash: string) {
  const [row] = await db
    .select({
      id: volunteers.id,
      studentId: volunteers.studentId,
      semesterId: students.semesterId,
      startDate: semesters.startDate,
      endDate: semesters.endDate,
      holidays: semesters.holidays,
    })
    .from(volunteers)
    .innerJoin(students, eq(volunteers.studentId, students.id))
    .innerJoin(semesters, eq(students.semesterId, semesters.id))
    .where(eq(volunteers.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

// The volunteer's own sections (what they cover) and those courses' weekly
// meetings (all sections, so lab/lecture is judged per section).
export async function volunteerContext(studentId: number, semesterId: number) {
  const own: VolunteerSection[] = await db
    .select({
      courseCode: enrollments.courseCode,
      section: enrollments.section,
      courseName: sections.courseName,
    })
    .from(enrollments)
    .leftJoin(
      sections,
      and(
        eq(sections.semesterId, semesterId),
        eq(sections.courseCode, enrollments.courseCode),
        eq(sections.section, enrollments.section),
      ),
    )
    .where(eq(enrollments.studentId, studentId));

  const codes = [...new Set(own.map((s) => s.courseCode))];
  const slots: Meeting[] =
    codes.length === 0
      ? []
      : await db
          .select({
            courseCode: meetings.courseCode,
            section: meetings.section,
            weekday: meetings.weekday,
            startTime: meetings.startTime,
            endTime: meetings.endTime,
            room: meetings.room,
          })
          .from(meetings)
          .where(and(eq(meetings.semesterId, semesterId), inArray(meetings.courseCode, codes)));
  return { sections: own, meetings: slots };
}

export async function touchVolunteer(id: number) {
  await db.update(volunteers).set({ lastSeenAt: sql`now()` }).where(eq(volunteers.id, id));
}

type MailRow = {
  dedupeKey: string;
  volunteerId: number;
  sentAt: Date;
  subject: string | null;
  outcome: "processed" | "ignored" | "unsure";
};

// One row per mail. Returns null when this mail was already processed (the
// unique dedupe_key: another volunteer, or the same one, sent it before).
// A mail that was only ignored/unsure before may be tried again: volunteer
// A may not be in the section, while volunteer B is.
export async function recordMail(row: MailRow): Promise<number | null> {
  const [inserted] = await db
    .insert(ingestedMails)
    .values(row)
    .onConflictDoNothing({ target: ingestedMails.dedupeKey })
    .returning({ id: ingestedMails.id });
  if (inserted) return inserted.id;

  const [updated] = await db
    .update(ingestedMails)
    .set({ volunteerId: row.volunteerId, subject: row.subject, outcome: row.outcome })
    .where(and(eq(ingestedMails.dedupeKey, row.dedupeKey), ne(ingestedMails.outcome, "processed")))
    .returning({ id: ingestedMails.id });
  return updated?.id ?? null;
}

const sameEvent = (a: EventInput, b: EventInput) =>
  a.courseCode === b.courseCode &&
  a.section === b.section &&
  a.type === b.type &&
  a.date === b.date &&
  (a.startTime && toHHMM(a.startTime)) === (b.startTime && toHHMM(b.startTime));

// Blackboard sends every student their own copy (own Message-ID), so the
// same announcement can arrive as several "different" mails. An event that
// already exists — from a mail or entered in /admin — is not added again.
// Returns how many were added.
export async function insertMailEvents(semesterId: number, mailId: number, events: EventInput[]): Promise<number> {
  if (events.length === 0) return 0;
  const existing = await db
    .select({
      courseCode: courseEvents.courseCode,
      section: courseEvents.section,
      type: courseEvents.type,
      date: courseEvents.date,
      startTime: courseEvents.startTime,
    })
    .from(courseEvents)
    .where(
      and(
        eq(courseEvents.semesterId, semesterId),
        inArray(courseEvents.courseCode, [...new Set(events.map((e) => e.courseCode))]),
      ),
    );
  const fresh = events.filter((e) => !existing.some((x) => sameEvent(x as EventInput, e)));
  if (fresh.length === 0) return 0;
  await db
    .insert(courseEvents)
    .values(fresh.map((e) => ({ ...e, semesterId, source: "mail" as const, mailId })));
  return fresh.length;
}
