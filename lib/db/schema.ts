import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// Dates are kept as "YYYY-MM-DD" strings (mode: "string") rather than JS Date
// objects: a JS Date carries a time and a time zone, which is exactly what
// causes off-by-one-day bugs for plain calendar dates.

export const semesters = pgTable("semesters", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(), // e.g. "2026-2027 Fall"
  startDate: date("start_date", { mode: "string" }).notNull(),
  endDate: date("end_date", { mode: "string" }).notNull(),
  holidays: date("holidays", { mode: "string" })
    .array()
    .notNull()
    .default(sql`'{}'::date[]`),
});

// No name, email, student number or national ID — only random tokens.
export const students = pgTable("students", {
  id: serial("id").primaryKey(),
  feedToken: text("feed_token").notNull().unique(),
  editToken: text("edit_token").notNull().unique(),
  semesterId: integer("semester_id")
    .notNull()
    .references(() => semesters.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const enrollments = pgTable(
  "enrollments",
  {
    studentId: integer("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    courseCode: text("course_code").notNull(), // normalized, e.g. "COMP201"
    section: text("section").notNull(),
  },
  (t) => [primaryKey({ columns: [t.studentId, t.courseCode] })],
);

// "catalog": imported from the SIS catalog, authoritative — its meetings are
// never changed by student input. "student": entered by a student because
// the section is not in the catalog.
export const sectionSource = pgEnum("section_source", ["catalog", "student"]);

// Per-section facts that don't depend on the day: course name, instructor.
// Shared by every student in the section, like meetings.
export const sections = pgTable(
  "sections",
  {
    id: serial("id").primaryKey(),
    semesterId: integer("semester_id")
      .notNull()
      .references(() => semesters.id),
    courseCode: text("course_code").notNull(),
    section: text("section").notNull(),
    courseName: text("course_name"),
    instructor: text("instructor"),
    source: sectionSource("source").notNull().default("student"),
  },
  (t) => [uniqueIndex("sections_key_idx").on(t.semesterId, t.courseCode, t.section)],
);

// One row per weekly slot of a section, shared by every student in it.
export const meetings = pgTable(
  "meetings",
  {
    id: serial("id").primaryKey(),
    semesterId: integer("semester_id")
      .notNull()
      .references(() => semesters.id),
    courseCode: text("course_code").notNull(),
    section: text("section").notNull(),
    weekday: smallint("weekday").notNull(), // 1 = Monday … 7 = Sunday (ISO)
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    room: text("room"),
  },
  (t) => [
    // Also blocks the same slot being inserted twice by two students at once.
    uniqueIndex("meetings_slot_idx").on(
      t.semesterId,
      t.courseCode,
      t.section,
      t.weekday,
      t.startTime,
    ),
    check("meetings_weekday_check", sql`${t.weekday} between 1 and 7`),
  ],
);

export const eventType = pgEnum("event_type", [
  "cancel",
  "makeup",
  "room_change",
  "exam",
  "other",
]);
export const eventStatus = pgEnum("event_status", ["confirmed", "unconfirmed"]);
export const eventSource = pgEnum("event_source", ["manual", "mail"]);

export const courseEvents = pgTable(
  "course_events",
  {
    id: serial("id").primaryKey(),
    semesterId: integer("semester_id")
      .notNull()
      .references(() => semesters.id),
    courseCode: text("course_code").notNull(),
    section: text("section"), // null = applies to every section of the course
    type: eventType("type").notNull(),
    date: date("date", { mode: "string" }).notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    room: text("room"),
    title: text("title"),
    note: text("note"),
    status: eventStatus("status").notNull().default("confirmed"),
    source: eventSource("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("course_events_course_idx").on(t.semesterId, t.courseCode)],
);
