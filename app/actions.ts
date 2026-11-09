"use server";

import { z } from "zod";
import { COURSE_CODE_PATTERN, normalizeCourseCode, normalizeSection } from "@/lib/course-code";
import {
  catalogEntries,
  currentSemesterId,
  lookupCatalogSection,
  type CatalogLookup,
  type EditCourse,
} from "@/lib/db/queries";
import { matchToCatalog } from "@/lib/extract";
import {
  createStudentSchedule,
  deleteStudent,
  rotateFeedToken,
  updateStudentSchedule,
} from "@/lib/db/save-schedule";
import { scheduleSchema } from "@/lib/schedule-input";
import { TOKEN_PATTERN, truncateToken } from "@/lib/token";

// Every Server Action is reachable by anyone with a direct POST, so all
// input is untrusted and validated here again, even though the form
// validates too. The edit token is the only proof of ownership.

// keptCourses: courses whose times the student entered were not used,
// because other students already share that section's times.
export type CreateScheduleResult =
  | { ok: true; feedToken: string; editToken: string; keptCourses: string[] }
  | { ok: false; error: string };

export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const editTokenSchema = z.string().regex(TOKEN_PATTERN);
const NOT_FOUND = "Kayıt bulunamadı. Bağlantıyı kontrol et.";
const FAILED = "Kaydedilemedi, lütfen tekrar dene.";

export async function createSchedule(raw: unknown): Promise<CreateScheduleResult> {
  const parsed = scheduleSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz bilgi" };
  }

  try {
    return { ok: true, ...(await createStudentSchedule(parsed.data)) };
  } catch (error) {
    console.error("createSchedule failed", error);
    return { ok: false, error: FAILED };
  }
}

export async function updateSchedule(
  editToken: unknown,
  raw: unknown,
): Promise<ActionResult<{ keptCourses: string[] }>> {
  const token = editTokenSchema.safeParse(editToken);
  if (!token.success) return { ok: false, error: NOT_FOUND };
  const parsed = scheduleSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz bilgi" };
  }

  try {
    const saved = await updateStudentSchedule(token.data, parsed.data);
    return saved ? { ok: true, keptCourses: saved.keptCourses } : { ok: false, error: NOT_FOUND };
  } catch (error) {
    console.error(`updateSchedule ${truncateToken(token.data)} failed`, error);
    return { ok: false, error: FAILED };
  }
}

export async function rotateFeed(editToken: unknown): Promise<ActionResult<{ feedToken: string }>> {
  const token = editTokenSchema.safeParse(editToken);
  if (!token.success) return { ok: false, error: NOT_FOUND };
  try {
    const row = await rotateFeedToken(token.data);
    return row ? { ok: true, feedToken: row.feedToken } : { ok: false, error: NOT_FOUND };
  } catch (error) {
    console.error(`rotateFeed ${truncateToken(token.data)} failed`, error);
    return { ok: false, error: FAILED };
  }
}

export async function deleteSchedule(editToken: unknown): Promise<ActionResult> {
  const token = editTokenSchema.safeParse(editToken);
  if (!token.success) return { ok: false, error: NOT_FOUND };
  try {
    return (await deleteStudent(token.data)) ? { ok: true } : { ok: false, error: NOT_FOUND };
  } catch (error) {
    console.error(`deleteSchedule ${truncateToken(token.data)} failed`, error);
    return { ok: false, error: FAILED };
  }
}

// Rows found by OCR in the browser. Only code, section and course name ever
// reach the server; the image and the rest of the OCR text never do.
const ocrRowsSchema = z
  .array(
    z.object({
      code: z.string().max(20),
      section: z.string().max(5),
      name: z.string().max(200),
    }),
  )
  .max(40); // rows of two OCR passes

// OCR rows → courses ready for the review form: catalog sections come with
// their official slots, others (e.g. HISTR 213) without slots.
export async function coursesFromOcr(raw: unknown): Promise<EditCourse[] | null> {
  const rows = ocrRowsSchema.safeParse(raw);
  if (!rows.success) return null;
  const semesterId = await currentSemesterId();
  const matched = matchToCatalog(rows.data, await catalogEntries(semesterId));

  return Promise.all(
    matched.map(async (m): Promise<EditCourse> => {
      if (m.match === "none") {
        return { code: m.code, section: m.section, source: "student", courseName: null, instructor: null, slots: [] };
      }
      const found = await lookupCatalogSection(semesterId, m.code, m.section);
      return found.found
        ? { code: m.code, section: m.section, source: "catalog", ...found }
        : { code: m.code, section: m.section, source: "student", courseName: null, instructor: null, slots: [] };
    }),
  );
}

const lookupSchema = z.object({
  code: z.string().transform(normalizeCourseCode).pipe(z.string().regex(COURSE_CODE_PATTERN)),
  section: z.string().transform(normalizeSection).pipe(z.string().regex(/^[A-Z0-9]{1,3}$/)),
});

// Official times for a section, so the form can fill them in. Returns null
// for input that isn't a well-formed code + section yet.
export async function lookupSection(raw: unknown): Promise<CatalogLookup | null> {
  const parsed = lookupSchema.safeParse(raw);
  if (!parsed.success) return null;
  return lookupCatalogSection(await currentSemesterId(), parsed.data.code, parsed.data.section);
}
