// Phase 4: what /api/ingest does with one mail from a volunteer's Gmail
// script — everything except the database, so it can be tested.

import { createHash } from "node:crypto";
import { z } from "zod";
import type { EventInput } from "./event-input";
import { BLACKBOARD_KEY, fold, mailToEvents, parseMail, type ParsedMail } from "./mail-parse";
import type { Meeting, Semester } from "./schedule";

// What the Apps Script sends. Generous limits: the script trims bodies, but
// a mail with a long quoted thread must not be rejected outright.
export const ingestSchema = z.object({
  messageId: z.string().trim().max(1000).nullish(),
  from: z.string().trim().max(500),
  subject: z.string().max(1000),
  body: z.string().max(100_000),
  sentAt: z.iso.datetime({ offset: true }),
});

export type IngestInput = z.infer<typeof ingestSchema>;

// Only mail from MEF itself: staff (@mef.edu.tr) or Blackboard
// (do-not-reply@mef.blackboard.com). The address in <…> is the real sender;
// a display name may contain anything ("Name - x@mef.edu.tr").
export function senderAllowed(from: string): boolean {
  const address = (from.match(/<([^<>\s]+@[^<>\s]+)>\s*$/)?.[1] ?? from.trim()).toLowerCase();
  const domain = address.split("@")[1] ?? "";
  return domain === "mef.edu.tr" || domain.endsWith(".mef.edu.tr") || domain === "mef.blackboard.com";
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

// Volunteer tokens are 192 random bits, so a plain hash is safe to store.
export function hashToken(token: string): string {
  return sha256(token);
}

// Every recipient's copy of a mail has the same Message-ID, so two
// volunteers sending the same announcement produce the same key.
export function dedupeKey(input: IngestInput): string {
  const id = input.messageId?.trim().replace(/^<|>$/g, "").toLowerCase();
  if (id) return sha256(`mid:${id}`);
  return sha256(`body:${input.from.toLowerCase()}|${input.sentAt}|${input.body.slice(0, 5000)}`);
}

export type VolunteerSection = {
  courseCode: string; // normalized
  section: string;
  courseName: string | null;
};

export type IngestPlan = {
  outcome: "processed" | "ignored" | "unsure";
  reason: string | null;
  events: EventInput[];
  // Stored for /admin only when the mail is about one of the volunteer's
  // courses; anything else (a personal mail that slipped through the
  // script's filter) leaves no trace but its hash.
  keepSubject: boolean;
};

// Older Blackboard mails carry no course key, only "Calculus II: …" in the
// subject. Matched against the volunteer's own courses only.
function sectionFromSubject(subject: string, sections: VolunteerSection[]): VolunteerSection | null {
  const prefix = subject.match(/^([^:]{3,80}):/)?.[1];
  if (!prefix) return null;
  const name = fold(prefix).trim();
  const hits = sections.filter((s) => s.courseName && fold(s.courseName).trim() === name);
  return hits.length === 1 ? hits[0] : null;
}

export function planIngest(
  input: IngestInput,
  context: { semester: Semester; meetings: Meeting[]; sections: VolunteerSection[] },
): IngestPlan {
  const { semester, meetings, sections } = context;
  const nothing = (outcome: IngestPlan["outcome"], reason: string | null, keepSubject = false): IngestPlan => ({
    outcome,
    reason,
    events: [],
    keepSubject,
  });

  let body = input.body;
  if (!BLACKBOARD_KEY.test(input.subject + "\n" + body)) {
    const named = sectionFromSubject(input.subject, sections);
    if (named) body = `0000-0000-00-${named.courseCode}-${named.section}\n${body}`;
  }

  const parsed: ParsedMail = parseMail({ subject: input.subject, body, sentAt: new Date(input.sentAt) });
  if (parsed.outcome === "ignored") return nothing("ignored", parsed.reason);
  if (parsed.outcome === "unsure") return nothing("unsure", parsed.reason, parsed.course !== null);
  if (parsed.allCourses || !parsed.course) return nothing("unsure", "Bütün dersleri etkileyen duyuru: elle girilmeli", true);

  // Only the volunteer's own sections: they are what this volunteer covers.
  const course = parsed.course;
  const own = sections.filter((s) => s.courseCode === course.courseCode);
  if (own.length === 0) return nothing("unsure", "Gönüllünün kayıtlı olduğu bir ders değil");
  // Blackboard often puts every section of a course into one shell: the
  // owner (COMP 205-2, MATH 211-3, EE 203-3) gets mails keyed "…-COMP205-01".
  // So the key's section says which shell, not which section. The volunteer
  // received the mail, so it concerns their own section; a person reviews
  // every mail event anyway. Same when no section is given at all
  // ("COMP 201 dersi yarın yok").
  let section = course.section;
  const doubts: string[] = [];
  if (section === null || !own.some((s) => s.section === section)) {
    if (own.length !== 1) return nothing("unsure", "Section belli değil", true);
    if (section !== null) doubts.push(`mailde section ${section}, gönüllü section ${own[0].section}`);
    section = own[0].section;
  }

  const { events, problem } = mailToEvents(
    { ...parsed, course: { ...course, section } },
    semester,
    meetings,
    input.subject,
  );
  if (problem) return nothing("unsure", problem, true);
  // Owner's rule (2026-11-10): a person confirms every event read from a
  // mail in /admin. Until then calendars show it with ❓. What the parser
  // wasn't sure about goes into the note, to help the review.
  const allDoubts = [...parsed.notes, ...doubts];
  const doubtText = allDoubts.length > 0 ? ` · Emin olunmayan: ${allDoubts.join(", ")}` : "";
  const reviewed = events.map((e) => ({
    ...e,
    status: "unconfirmed" as const,
    note: `${e.note ?? ""}${doubtText}`.slice(0, 500),
  }));
  return { outcome: "processed", reason: null, events: reviewed, keepSubject: true };
}
