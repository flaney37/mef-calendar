"use server";

import { z } from "zod";
import { COURSE_CODE_PATTERN, normalizeCourseCode, normalizeSection } from "@/lib/course-code";
import { currentSemesterId, lookupCatalogSection, type CatalogLookup } from "@/lib/db/queries";
import { createStudentSchedule } from "@/lib/db/save-schedule";
import { scheduleSchema } from "@/lib/schedule-input";

export type CreateScheduleResult =
  | { ok: true; feedToken: string; editToken: string }
  | { ok: false; error: string };

// Reachable by anyone with a direct POST, so the input is untrusted and
// validated here again, even though the form validates too.
export async function createSchedule(raw: unknown): Promise<CreateScheduleResult> {
  const parsed = scheduleSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Geçersiz bilgi" };
  }

  try {
    return { ok: true, ...(await createStudentSchedule(parsed.data)) };
  } catch (error) {
    console.error("createSchedule failed", error);
    return { ok: false, error: "Kaydedilemedi, lütfen tekrar dene." };
  }
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
