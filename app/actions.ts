"use server";

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
