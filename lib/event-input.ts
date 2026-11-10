// What the admin panel submits for one course event (cancellation, exam…),
// and the check that a session change hits a real class session.

import { z } from "zod";
import { COURSE_CODE_PATTERN, normalizeCourseCode, normalizeSection } from "./course-code";
import { isoWeekday, toHHMM, type Meeting, type Semester } from "./schedule";

z.config(z.locales.tr());

export const EVENT_TYPES = ["cancel", "online", "room_change", "exam", "makeup", "other"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

// These change an existing class session; the others are events of their own.
export const SESSION_CHANGE_TYPES: readonly EventType[] = ["cancel", "online", "room_change"];

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Saat SS:DD biçiminde olmalı");
const emptyToNull = (s: unknown) => (typeof s === "string" && s.trim() === "" ? null : s);
const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToNull, schema.nullable().optional()).transform((v) => v ?? null);
const optionalText = (max: number) => optional(z.string().trim().max(max));

export const eventSchema = z
  .object({
    courseCode: z
      .string()
      .transform(normalizeCourseCode)
      .pipe(z.string().regex(COURSE_CODE_PATTERN, "Ders kodu COMP 201 gibi olmalı")),
    // Empty = every section of the course.
    section: optional(
      z.string().transform(normalizeSection).pipe(z.string().regex(/^[A-Z0-9]{1,3}$/, "Section 1, 2 gibi olmalı")),
    ),
    type: z.enum(EVENT_TYPES),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Tarih seç"),
    startTime: optional(time),
    endTime: optional(time),
    room: optionalText(40),
    title: optionalText(80),
    note: optionalText(500),
    status: z.enum(["confirmed", "unconfirmed"]),
  })
  .superRefine((e, ctx) => {
    if (e.type === "room_change" && !e.room) {
      ctx.addIssue({ code: "custom", path: ["room"], message: "Yeni sınıfı yaz" });
    }
    if (!SESSION_CHANGE_TYPES.includes(e.type) && e.endTime) {
      if (!e.startTime) ctx.addIssue({ code: "custom", path: ["startTime"], message: "Başlangıç saatini de yaz" });
      else if (e.endTime <= e.startTime) {
        ctx.addIssue({ code: "custom", path: ["endTime"], message: "Bitiş saati başlangıçtan sonra olmalı" });
      }
    }
  })
  // A session change only picks a session by its start time.
  .transform((e) => (SESSION_CHANGE_TYPES.includes(e.type) ? { ...e, endTime: null } : e));

export type EventInput = z.infer<typeof eventSchema>;

const WEEKDAY_NAMES = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

// For a cancellation / online / room change: is there a class session of
// this course (and section) on that date (and at that time)? Returns a
// Turkish error message, or null when the event targets something real.
export function sessionTargetError(event: EventInput, semester: Semester, meetings: Meeting[]): string | null {
  if (event.date < semester.startDate || event.date > semester.endDate) {
    return `Tarih dönem dışında (${semester.startDate} – ${semester.endDate}).`;
  }
  if (!SESSION_CHANGE_TYPES.includes(event.type)) return null;

  const relevant = meetings.filter(
    (m) => m.courseCode === event.courseCode && (event.section === null || m.section === event.section),
  );
  if (relevant.length === 0) return "Bu dersin (section'ın) ders programında saati yok.";
  if (semester.holidays.includes(event.date)) return "Bu tarih tatil, zaten ders yok.";

  const weekday = isoWeekday(event.date);
  const sameDay = relevant.filter((m) => m.weekday === weekday);
  if (sameDay.length === 0) {
    const days = [...new Set(relevant.map((m) => WEEKDAY_NAMES[m.weekday - 1]))].join(", ");
    return `${WEEKDAY_NAMES[weekday - 1]} günü bu dersin oturumu yok (oturum günleri: ${days}).`;
  }
  if (event.startTime && !sameDay.some((m) => toHHMM(m.startTime) === event.startTime)) {
    return `O gün ${event.startTime}'da başlayan oturum yok.`;
  }
  return null;
}
