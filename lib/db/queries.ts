import { and, eq } from "drizzle-orm";
import type { FeedInput } from "@/lib/feed";
import { db } from "./index";
import { enrollments, meetings, sections, semesters, students } from "./schema";

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
