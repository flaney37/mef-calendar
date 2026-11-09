// What a student submits: courses, each with zero or more weekly slots.
// Shared by the form (client) and the Server Action (server); the server
// always re-validates because anyone can POST to a Server Action directly.

import { z } from "zod";
import { COURSE_CODE_PATTERN, normalizeCourseCode, normalizeSection } from "./course-code";

// Zod's built-in messages ("Invalid input…") in Turkish, for the cases
// without a custom message below.
z.config(z.locales.tr());

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Saat SS:DD biçiminde olmalı");

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const slotSchema = z
  .object({
    weekday: z.coerce.number().int().min(1).max(7),
    startTime: time,
    endTime: time,
    room: optionalText(40),
  })
  // "HH:MM" strings compare correctly as text.
  .refine((s) => s.endTime > s.startTime, {
    message: "Bitiş saati başlangıçtan sonra olmalı",
    path: ["endTime"],
  });

export const courseSchema = z.object({
  code: z
    .string()
    .transform(normalizeCourseCode)
    .pipe(z.string().regex(COURSE_CODE_PATTERN, "Ders kodu COMP 201 gibi olmalı")),
  section: z
    .string()
    .transform(normalizeSection)
    .pipe(z.string().regex(/^[A-Z0-9]{1,3}$/, "Şube 1, 2 gibi olmalı")),
  courseName: optionalText(120),
  instructor: optionalText(120),
  // Courses like HISTR 213 have no fixed slot: kept as an enrollment only.
  slots: z.array(slotSchema).max(7),
});

export const scheduleSchema = z
  .object({ courses: z.array(courseSchema).min(1, "En az bir ders ekle").max(15) })
  .refine((s) => new Set(s.courses.map((c) => c.code)).size === s.courses.length, {
    message: "Aynı ders iki kez eklenmiş",
    path: ["courses"],
  });

export type ScheduleInput = z.infer<typeof scheduleSchema>;
export type CourseInput = ScheduleInput["courses"][number];
