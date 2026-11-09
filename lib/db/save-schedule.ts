import { and, eq, ne, or, sql } from "drizzle-orm";
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
const courseKey = (c: CourseInput) => keyOf({ courseCode: c.code, section: c.section });

// Meetings are shared per section. Catalog sections already have the
// official slots, so whatever the student sent for them is ignored. For a
// section outside the catalog, the first student to save it defines its
// slots; if a later student reports different ones, we log the conflict and
// keep the existing ones (CLAUDE.md). The one exception: when editing, a
// student who is the only one in such a section may change its slots.
async function planMeetings(semesterId: number, courses: CourseInput[], editorId?: number) {
  const plan = {
    insert: [] as (SlotRow & { semesterId: number; courseCode: string; section: string })[],
    replace: [] as CourseInput[],
    // Sections whose submitted slots were not used (shared with others).
    kept: [] as string[],
  };
  if (courses.length === 0) return plan;

  const catalogKeys = new Set(
    (
      await db
        .select({ courseCode: sections.courseCode, section: sections.section })
        .from(sections)
        .where(
          and(
            eq(sections.semesterId, semesterId),
            eq(sections.source, "catalog"),
            or(...courses.map((c) => and(eq(sections.courseCode, c.code), eq(sections.section, c.section)))),
          ),
        )
    ).map(keyOf),
  );

  const own = courses.filter((c) => !catalogKeys.has(courseKey(c)));
  if (own.length === 0) return plan;

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
        or(...own.map((c) => and(eq(meetings.courseCode, c.code), eq(meetings.section, c.section)))),
      ),
    );
  const existingByKey = new Map<string, SlotRow[]>();
  for (const row of existing) {
    existingByKey.set(keyOf(row), [...(existingByKey.get(keyOf(row)) ?? []), row]);
  }

  // Sections where some other student of this semester is enrolled.
  const sharedKeys = new Set(
    editorId === undefined
      ? []
      : (
          await db
            .selectDistinct({ courseCode: enrollments.courseCode, section: enrollments.section })
            .from(enrollments)
            .innerJoin(students, eq(enrollments.studentId, students.id))
            .where(
              and(
                eq(students.semesterId, semesterId),
                ne(enrollments.studentId, editorId),
                or(...own.map((c) => and(eq(enrollments.courseCode, c.code), eq(enrollments.section, c.section)))),
              ),
            )
        ).map(keyOf),
  );

  const rowsFor = (c: CourseInput) =>
    c.slots.map((s) => ({ semesterId, courseCode: c.code, section: c.section, ...s }));

  for (const c of own) {
    const key = courseKey(c);
    const known = existingByKey.get(key);
    if (!known) {
      plan.insert.push(...rowsFor(c));
    } else if (slotSignature(known) !== slotSignature(c.slots)) {
      if (editorId !== undefined && !sharedKeys.has(key)) {
        plan.replace.push(c);
        plan.insert.push(...rowsFor(c));
      } else {
        console.warn(`meetings conflict for ${key}: kept "${slotSignature(known)}", got "${slotSignature(c.slots)}"`);
        plan.kept.push(c.code);
      }
    }
  }
  return plan;
}

function upsertSections(semesterId: number, courses: CourseInput[]) {
  return db
    .insert(sections)
    .values(
      courses.map((c) => ({
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
    });
}

function meetingWrites(semesterId: number, plan: Awaited<ReturnType<typeof planMeetings>>) {
  return [
    ...plan.replace.map((c) =>
      db
        .delete(meetings)
        .where(
          and(
            eq(meetings.semesterId, semesterId),
            eq(meetings.courseCode, c.code),
            eq(meetings.section, c.section),
          ),
        ),
    ),
    ...(plan.insert.length > 0 ? [db.insert(meetings).values(plan.insert).onConflictDoNothing()] : []),
  ];
}

export async function createStudentSchedule(input: ScheduleInput) {
  const semesterId = await currentSemesterId();
  const feedToken = generateToken();
  const editToken = generateToken();
  const plan = await planMeetings(semesterId, input.courses);

  const enrollmentValues = sql.join(
    input.courses.map((c) => sql`(${c.code}, ${c.section})`),
    sql`, `,
  );

  // db.batch runs every statement in one transaction: either the whole
  // schedule is saved or nothing is. neon-http has no interactive
  // transactions, so the enrollments find the new student by its token
  // (INSERT … SELECT) instead of using a returned id.
  await db.batch([
    upsertSections(semesterId, input.courses),
    ...meetingWrites(semesterId, plan),
    db.insert(students).values({ feedToken, editToken, semesterId }),
    db
      .insert(enrollments)
      .select(
        sql`select ${students.id}, v.course_code, v.section
            from ${students}, (values ${enrollmentValues}) as v(course_code, section)
            where ${students.feedToken} = ${feedToken}`,
      ),
  ]);

  return { feedToken, editToken, keptCourses: plan.kept };
}

async function studentByEditToken(editToken: string) {
  const [student] = await db
    .select({ id: students.id, semesterId: students.semesterId, feedToken: students.feedToken })
    .from(students)
    .where(eq(students.editToken, editToken))
    .limit(1);
  return student ?? null;
}

// Replaces the student's courses. The feed URL stays the same, so subscribed
// calendars pick up the change on their next refresh.
export async function updateStudentSchedule(editToken: string, input: ScheduleInput) {
  const student = await studentByEditToken(editToken);
  if (!student) return null;
  const plan = await planMeetings(student.semesterId, input.courses, student.id);

  await db.batch([
    upsertSections(student.semesterId, input.courses),
    ...meetingWrites(student.semesterId, plan),
    db.delete(enrollments).where(eq(enrollments.studentId, student.id)),
    db.insert(enrollments).values(
      input.courses.map((c) => ({ studentId: student.id, courseCode: c.code, section: c.section })),
    ),
  ]);
  return { feedToken: student.feedToken, keptCourses: plan.kept };
}

// New feed URL; the old one stops working (404) immediately.
export async function rotateFeedToken(editToken: string) {
  const [row] = await db
    .update(students)
    .set({ feedToken: generateToken() })
    .where(eq(students.editToken, editToken))
    .returning({ feedToken: students.feedToken });
  return row ?? null;
}

// Removes the student and (by cascade) their enrollments. Shared section
// data stays, since other students may use it.
export async function deleteStudent(editToken: string) {
  const [row] = await db
    .delete(students)
    .where(eq(students.editToken, editToken))
    .returning({ id: students.id });
  return row !== undefined;
}
