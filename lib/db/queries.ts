import { and, desc, eq } from "drizzle-orm";
import type { FeedInput } from "@/lib/feed";
import { db } from "./index";
import { enrollments, meetings, sections, semesters, students } from "./schema";

export async function currentSemesterId(): Promise<number> {
  const [semester] = await db
    .select({ id: semesters.id })
    .from(semesters)
    .orderBy(desc(semesters.startDate))
    .limit(1);
  if (!semester) throw new Error("No semester in the database; run pnpm db:seed");
  return semester.id;
}

export type CatalogLookup =
  | {
      found: true;
      courseName: string | null;
      instructor: string | null;
      slots: { weekday: number; startTime: string; endTime: string; room: string | null }[];
    }
  // otherSections: the course exists in the catalog, but not this section.
  | { found: false; otherSections: string[] };

export async function lookupCatalogSection(
  semesterId: number,
  courseCode: string,
  section: string,
): Promise<CatalogLookup> {
  const rows = await db
    .select({ section: sections.section, courseName: sections.courseName, instructor: sections.instructor })
    .from(sections)
    .where(
      and(
        eq(sections.semesterId, semesterId),
        eq(sections.courseCode, courseCode),
        eq(sections.source, "catalog"),
      ),
    );
  const match = rows.find((r) => r.section === section);
  if (!match) {
    return {
      found: false,
      otherSections: rows.map((r) => r.section).sort((a, b) => Number(a) - Number(b)),
    };
  }

  const slots = await db
    .select({
      weekday: meetings.weekday,
      startTime: meetings.startTime,
      endTime: meetings.endTime,
      room: meetings.room,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.semesterId, semesterId),
        eq(meetings.courseCode, courseCode),
        eq(meetings.section, section),
      ),
    )
    .orderBy(meetings.weekday, meetings.startTime);

  return { found: true, courseName: match.courseName, instructor: match.instructor, slots };
}

// Code, section and name of every catalog section, for matching OCR rows.
export async function catalogEntries(semesterId: number) {
  return db
    .select({ courseCode: sections.courseCode, section: sections.section, courseName: sections.courseName })
    .from(sections)
    .where(and(eq(sections.semesterId, semesterId), eq(sections.source, "catalog")));
}

export type EditCourse = {
  code: string;
  section: string;
  source: "catalog" | "student";
  courseName: string | null;
  instructor: string | null;
  slots: { weekday: number; startTime: string; endTime: string; room: string | null }[];
};

// The student's saved courses for the edit page, or null for an unknown token.
export async function loadEditData(editToken: string) {
  const [student] = await db
    .select({ id: students.id, semesterId: students.semesterId, feedToken: students.feedToken })
    .from(students)
    .where(eq(students.editToken, editToken))
    .limit(1);
  if (!student) return null;

  const sameSection = (table: typeof meetings | typeof sections) =>
    and(
      eq(table.semesterId, student.semesterId),
      eq(table.courseCode, enrollments.courseCode),
      eq(table.section, enrollments.section),
    );

  const [courseRows, slotRows] = await Promise.all([
    db
      .select({
        code: enrollments.courseCode,
        section: enrollments.section,
        source: sections.source,
        courseName: sections.courseName,
        instructor: sections.instructor,
      })
      .from(enrollments)
      .leftJoin(sections, sameSection(sections))
      .where(eq(enrollments.studentId, student.id))
      .orderBy(enrollments.courseCode),
    db
      .select({
        code: meetings.courseCode,
        section: meetings.section,
        weekday: meetings.weekday,
        startTime: meetings.startTime,
        endTime: meetings.endTime,
        room: meetings.room,
      })
      .from(meetings)
      .innerJoin(enrollments, sameSection(meetings))
      .where(eq(enrollments.studentId, student.id))
      .orderBy(meetings.weekday, meetings.startTime),
  ]);

  const courses: EditCourse[] = courseRows.map((c) => ({
    code: c.code,
    section: c.section,
    source: c.source ?? "student",
    courseName: c.courseName,
    instructor: c.instructor,
    slots: slotRows
      .filter((s) => s.code === c.code && s.section === c.section)
      .map(({ weekday, startTime, endTime, room }) => ({ weekday, startTime, endTime, room })),
  }));

  return { feedToken: student.feedToken, courses };
}

// Everything needed to build one student's feed, or null for an unknown token.
export async function loadFeedData(feedToken: string): Promise<Omit<FeedInput, "now"> | null> {
  const [student] = await db
    .select({
      id: students.id,
      semesterId: students.semesterId,
      startDate: semesters.startDate,
      endDate: semesters.endDate,
      holidays: semesters.holidays,
    })
    .from(students)
    .innerJoin(semesters, eq(students.semesterId, semesters.id))
    .where(eq(students.feedToken, feedToken))
    .limit(1);
  if (!student) return null;

  // Meetings and sections are shared per section; the student's enrollments
  // pick which ones belong in this feed.
  const enrolledIn = (table: typeof meetings | typeof sections) =>
    and(
      eq(enrollments.studentId, student.id),
      eq(enrollments.courseCode, table.courseCode),
      eq(enrollments.section, table.section),
      eq(table.semesterId, student.semesterId),
    );

  const [meetingRows, sectionRows] = await Promise.all([
    db
      .select({
        courseCode: meetings.courseCode,
        section: meetings.section,
        weekday: meetings.weekday,
        startTime: meetings.startTime,
        endTime: meetings.endTime,
        room: meetings.room,
      })
      .from(meetings)
      .innerJoin(enrollments, enrolledIn(meetings)),
    db
      .select({
        courseCode: sections.courseCode,
        section: sections.section,
        courseName: sections.courseName,
        instructor: sections.instructor,
      })
      .from(sections)
      .innerJoin(enrollments, enrolledIn(sections)),
  ]);

  return {
    semester: {
      startDate: student.startDate,
      endDate: student.endDate,
      holidays: student.holidays,
    },
    meetings: meetingRows,
    sections: sectionRows,
  };
}
