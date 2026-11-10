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

// cancel, room_change, online: change one existing class session
// (course_events.start_time picks the session; null = every session of
// that course on that date). makeup, exam, other: a separate calendar event.
export const eventType = pgEnum("event_type", [
  "cancel",
  "makeup",
  "room_change",
  "exam",
  "other",
  "online",
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
    // The mail this event was read from (source = 'mail'); null for manual
    // events. Kept when the mail record is pruned.
    mailId: integer("mail_id").references(() => ingestedMails.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("course_events_course_idx").on(t.semesterId, t.courseCode)],
);

// A student who runs the Gmail script (Phase 4). No name or email: the
// volunteer is just a student record, and the sections they cover are their
// own enrollments, counted per course + section (never per cohort).
// Only a SHA-256 hash of the ingest token is stored. The token is 192 random
// bits, so a plain hash is enough: a leaked DB can't be turned back into
// working tokens, and nothing needs a server-side secret to check one.
export const volunteers = pgTable("volunteers", {
  id: serial("id").primaryKey(),
  studentId: integer("student_id")
    .notNull()
    .unique()
    .references(() => students.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

// processed: at least one event was written. ignored: no course/keyword
// found. unsure: something was found but couldn't be placed (no matching
// session, ambiguous date) — shown in /admin for a human to look at.
export const mailOutcome = pgEnum("mail_outcome", [
  "processed",
  "ignored",
  "unsure",
]);

// One row per mail, so the same mail sent by two volunteers is handled once.
// The mail text itself is never stored: only a hash to recognise it again,
// the subject (for /admin) and what came out of it.
export const ingestedMails = pgTable("ingested_mails", {
  id: serial("id").primaryKey(),
  // sha256 of the Message-ID header (identical in every recipient's copy),
  // or of the normalised sender + date + body when there is none.
  dedupeKey: text("dedupe_key").notNull().unique(),
  volunteerId: integer("volunteer_id").references(() => volunteers.id, {
    onDelete: "set null",
  }),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
  subject: text("subject"),
  outcome: mailOutcome("outcome").notNull(),
  // Why it was ignored / unsure ("Ertelendi: yeni tarih elle girilmeli"),
  // shown in /admin. Fixed Turkish phrases from the parser, never mail text.
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
