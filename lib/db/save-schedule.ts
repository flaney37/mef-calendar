import { and, eq, or, sql } from "drizzle-orm";
import type { CourseInput, ScheduleInput } from "@/lib/schedule-input";
import { toHHMM } from "@/lib/schedule";
import { generateToken } from "@/lib/token";
import { db } from "./index";
import { currentSemesterId } from "./queries";
import { meetings, sections, students, enrollments } from "./schema";

type SlotRow = { weekday: number; startTime: string; endTime: string; room: string | null };

// Order-independent fingerprint of a section's weekly slots, used to spot
// two students reporting different times for the same section.
function slotSignature(slots: SlotRow[]): string {
  return slots
    .map((s) => `${s.weekday} ${toHHMM(s.startTime)}-${toHHMM(s.endTime)} ${s.room ?? ""}`)
    .sort()
    .join(" | ");
}

const keyOf = (c: { courseCode: string; section: string }) => `${c.courseCode}-${c.section}`;

// Meetings are shared per section: the first student to save a section
// defines its slots. Later students reuse them; if they report different
// slots, we log the conflict and keep the existing ones (CLAUDE.md).
async function newMeetingRows(semesterId: number, courses: CourseInput[]) {
  const timed = courses.filter((c) => c.slots.length > 0);
  if (timed.length === 0) return [];

  const existing = await db
    .select({
      courseCode: meetings.courseCode,
      section: meetings.section,
      weekday: meetings.weekday,
      startTime: meetings.startTime,
      endTime: meetings.endTime,
      room: meetings.room,
    })
    .from(meetings)
    .where(
      and(
        eq(meetings.semesterId, semesterId),
        or(...timed.map((c) => and(eq(meetings.courseCode, c.code), eq(meetings.section, c.section)))),
      ),
    );

  const existingByKey = new Map<string, SlotRow[]>();
  for (const row of existing) {
    const list = existingByKey.get(keyOf(row)) ?? [];
    list.push(row);
    existingByKey.set(keyOf(row), list);
  }

  return timed.flatMap((c) => {
    const key = keyOf({ courseCode: c.code, section: c.section });
    const known = existingByKey.get(key);
    if (known) {
      if (slotSignature(known) !== slotSignature(c.slots)) {
        console.warn(`meetings conflict for ${key}: kept "${slotSignature(known)}", got "${slotSignature(c.slots)}"`);
      }
      return [];
    }
    return c.slots.map((s) => ({ semesterId, courseCode: c.code, section: c.section, ...s }));
  });
}

export async function createStudentSchedule(input: ScheduleInput) {
  const semesterId = await currentSemesterId();
  const feedToken = generateToken();
  const editToken = generateToken();
  const meetingRows = await newMeetingRows(semesterId, input.courses);

  const enrollmentValues = sql.join(
    input.courses.map((c) => sql`(${c.code}, ${c.section})`),
    sql`, `,
  );

  // db.batch runs every statement in one transaction: either the whole
  // schedule is saved or nothing is. neon-http has no interactive
  // transactions, so the enrollments find the new student by its token
  // (INSERT … SELECT) instead of using a returned id.
  await db.batch([
    db
      .insert(sections)
      .values(
        input.courses.map((c) => ({
          semesterId,
          courseCode: c.code,
          section: c.section,
          courseName: c.courseName,
          instructor: c.instructor,
        })),
      )
      .onConflictDoUpdate({
        target: [sections.semesterId, sections.courseCode, sections.section],
        // Fill in missing details, never overwrite what someone already gave.
        set: {
          courseName: sql`coalesce(${sections.courseName}, excluded.course_name)`,
          instructor: sql`coalesce(${sections.instructor}, excluded.instructor)`,
        },
      }),
    ...(meetingRows.length > 0
      ? [db.insert(meetings).values(meetingRows).onConflictDoNothing()]
      : []),
    db.insert(students).values({ feedToken, editToken, semesterId }),
    db
      .insert(enrollments)
      .select(
        sql`select ${students.id}, v.course_code, v.section
            from ${students}, (values ${enrollmentValues}) as v(course_code, section)
            where ${students.feedToken} = ${feedToken}`,
      ),
  ]);

  return { feedToken, editToken };
}
