// Becoming a volunteer (Phase 4): a student runs the Gmail script with their
// own ingest token. Found by the student's edit token — the edit link is
// the only proof of who they are. Only a hash of the ingest token is stored.

import { eq } from "drizzle-orm";
import { hashToken } from "@/lib/ingest-plan";
import { generateToken } from "@/lib/token";
import { db } from "./index";
import { students, volunteers } from "./schema";

async function studentId(editToken: string): Promise<number | null> {
  const [row] = await db.select({ id: students.id }).from(students).where(eq(students.editToken, editToken)).limit(1);
  return row?.id ?? null;
}

export type VolunteerStatus = { since: string; lastSeenAt: string | null } | null;

export async function volunteerStatus(editToken: string): Promise<VolunteerStatus> {
  const [row] = await db
    .select({ createdAt: volunteers.createdAt, lastSeenAt: volunteers.lastSeenAt })
    .from(volunteers)
    .innerJoin(students, eq(volunteers.studentId, students.id))
    .where(eq(students.editToken, editToken))
    .limit(1);
  if (!row) return null;
  return { since: row.createdAt.toISOString(), lastSeenAt: row.lastSeenAt?.toISOString() ?? null };
}

// Creates the volunteer, or gives an existing one a new token (the old
// script stops working). Returns the plain token once; it is never stored.
export async function issueVolunteerToken(editToken: string): Promise<string | null> {
  const id = await studentId(editToken);
  if (id === null) return null;
  const token = generateToken();
  await db
    .insert(volunteers)
    .values({ studentId: id, tokenHash: hashToken(token) })
    .onConflictDoUpdate({ target: volunteers.studentId, set: { tokenHash: hashToken(token), lastSeenAt: null } });
  return token;
}

export async function stopVolunteering(editToken: string): Promise<boolean> {
  const id = await studentId(editToken);
  if (id === null) return false;
  await db.delete(volunteers).where(eq(volunteers.studentId, id));
  return true;
}
