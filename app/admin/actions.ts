"use server";

import { cookies } from "next/headers";
import { z } from "zod";
import {
  ADMIN_COOKIE,
  SESSION_SECONDS,
  createSessionToken,
  passwordMatches,
  sessionTokenValid,
} from "@/lib/admin-auth";
import { COURSE_CODE_PATTERN, normalizeCourseCode } from "@/lib/course-code";
import {
  confirmEvent,
  courseMeetings,
  courseSections,
  currentSemester,
  deleteEvent,
  insertEvent,
  listEvents,
  updateEvent,
  type AdminEvent,
  type AdminSection,
} from "@/lib/db/admin-queries";
import { eventSchema, sessionTargetError } from "@/lib/event-input";

// Every action here can be POSTed by anyone, so each one checks the
// session cookie itself; hiding the panel UI is not protection.

const password = () => process.env.ADMIN_PASSWORD ?? "";
const nowSeconds = () => Math.floor(Date.now() / 1000);

export async function isAdmin(): Promise<boolean> {
  const token = (await cookies()).get(ADMIN_COOKIE)?.value;
  return sessionTokenValid(token, password(), nowSeconds());
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const EXPIRED = { ok: false, error: "Oturumun süresi doldu, sayfayı yenileyip tekrar giriş yap." } as const;

export async function login(input: unknown): Promise<Result> {
  const given = typeof input === "string" ? input : "";
  if (!passwordMatches(given, password())) {
    // Slow down guessing; the wait is the same for every wrong password.
    await new Promise((r) => setTimeout(r, 1000));
    return { ok: false, error: "Şifre yanlış." };
  }
  (await cookies()).set(ADMIN_COOKIE, createSessionToken(password(), nowSeconds()), {
    httpOnly: true, // not readable from JavaScript
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict", // not sent along with requests started by other sites
    path: "/",
    maxAge: SESSION_SECONDS,
  });
  return { ok: true };
}

export async function logout(): Promise<void> {
  (await cookies()).delete(ADMIN_COOKIE);
}

export async function adminCourseInfo(code: unknown): Promise<Result<{ courseCode: string; sections: AdminSection[] }>> {
  if (!(await isAdmin())) return EXPIRED;
  const courseCode = z
    .string()
    .transform(normalizeCourseCode)
    .pipe(z.string().regex(COURSE_CODE_PATTERN))
    .safeParse(code);
  if (!courseCode.success) return { ok: false, error: "Ders kodu COMP 201 gibi olmalı." };
  const semester = await currentSemester();
  return { ok: true, courseCode: courseCode.data, sections: await courseSections(semester.id, courseCode.data) };
}

export async function saveEvent(id: unknown, raw: unknown): Promise<Result<{ events: AdminEvent[] }>> {
  if (!(await isAdmin())) return EXPIRED;
  const eventId = z.number().int().positive().nullable().safeParse(id);
  const parsed = eventSchema.safeParse(raw);
  if (!eventId.success) return { ok: false, error: "Geçersiz olay." };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Bilgileri kontrol et." };

  const semester = await currentSemester();
  const targetError = sessionTargetError(
    parsed.data,
    semester,
    await courseMeetings(semester.id, parsed.data.courseCode),
  );
  if (targetError) return { ok: false, error: targetError };

  if (eventId.data === null) await insertEvent(semester.id, parsed.data);
  else if (!(await updateEvent(semester.id, eventId.data, parsed.data))) {
    return { ok: false, error: "Olay bulunamadı (silinmiş olabilir)." };
  }
  return { ok: true, events: await listEvents(semester.id) };
}

export async function approveEvent(id: unknown): Promise<Result<{ events: AdminEvent[] }>> {
  if (!(await isAdmin())) return EXPIRED;
  const eventId = z.number().int().positive().safeParse(id);
  if (!eventId.success) return { ok: false, error: "Geçersiz olay." };
  const semester = await currentSemester();
  if (!(await confirmEvent(semester.id, eventId.data))) return { ok: false, error: "Olay bulunamadı (silinmiş olabilir)." };
  return { ok: true, events: await listEvents(semester.id) };
}

export async function removeEvent(id: unknown): Promise<Result<{ events: AdminEvent[] }>> {
  if (!(await isAdmin())) return EXPIRED;
  const eventId = z.number().int().positive().safeParse(id);
  if (!eventId.success) return { ok: false, error: "Geçersiz olay." };
  const semester = await currentSemester();
  await deleteEvent(semester.id, eventId.data);
  return { ok: true, events: await listEvents(semester.id) };
}
