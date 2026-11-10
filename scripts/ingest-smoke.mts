// End-to-end check of /api/ingest against the real (= production) DB, with
// a fake course only (TEST999, TEST… tokens — CLAUDE.md). Needs `pnpm dev`
// running. Everything it creates is deleted at the end, even on failure.
// Never prints a token.
//
//   pnpm tsx --env-file=.env.local scripts/ingest-smoke.mts [http://localhost:3000]

import { createHash, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";

const base = process.argv[2] ?? "http://localhost:3000";
const sql = neon(process.env.DATABASE_URL!);
const fill = (prefix: string) => (prefix + randomBytes(24).toString("base64url")).slice(0, 32);
const feedToken = fill("TESTfeedToken");
const editToken = fill("TESTeditToken");
const ingestToken = fill("TESTingestToken");
const hash = createHash("sha256").update(ingestToken).digest("hex");

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "✓" : "✗"} ${label}${ok ? "" : `  ${detail}`}`);
  if (!ok) failures++;
};

async function post(body: object, token = ingestToken) {
  const res = await fetch(`${base}/api/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return { code: res.status, json: (await res.json()) as { status?: string; events?: number } };
}

const mail = {
  messageId: `<smoke-${randomBytes(6).toString("hex")}@mef.blackboard.com>`,
  from: "TEST ASSISTANT - ta@mef.edu.tr <do-not-reply@mef.blackboard.com>",
  subject: "Test Course: No Lab Session on November 16",
  body: "2026-2027-01-TEST999-01\nTest Course\nDear students,\nThere will be no lab session on Monday, November 16.\nView Announcement",
  sentAt: "2026-11-10T09:00:00Z",
};

const [{ id: semesterId }] = await sql`select id from semesters order by start_date desc limit 1`;
let studentId: number | null = null;

try {
  // A fake student in TEST999-1 (Mon lecture 09:00–11:50, Mon lab 13:00–14:50) who volunteers.
  [{ id: studentId }] = await sql`
    insert into students (feed_token, edit_token, semester_id) values (${feedToken}, ${editToken}, ${semesterId}) returning id`;
  await sql`insert into enrollments (student_id, course_code, section) values (${studentId}, 'TEST999', '1')`;
  await sql`insert into sections (semester_id, course_code, section, course_name, source)
            values (${semesterId}, 'TEST999', '1', 'Test Course', 'student')`;
  await sql`insert into meetings (semester_id, course_code, section, weekday, start_time, end_time, room) values
            (${semesterId}, 'TEST999', '1', 1, '09:00', '11:50', 'T101'),
            (${semesterId}, 'TEST999', '1', 1, '13:00', '14:50', 'T102')`;
  await sql`insert into volunteers (student_id, token_hash) values (${studentId}, ${hash})`;

  const first = await post(mail);
  check("lab cancellation → processed, 1 event", first.code === 200 && first.json.status === "processed" && first.json.events === 1, JSON.stringify(first));

  const again = await post(mail);
  check("same Message-ID again → duplicate", again.json.status === "duplicate", JSON.stringify(again));

  const copy = await post({ ...mail, messageId: `<smoke-copy-${randomBytes(6).toString("hex")}@mef.blackboard.com>` });
  check("another copy (new Message-ID) → no second event", copy.json.events === 0, JSON.stringify(copy));

  const outsider = await post({ ...mail, messageId: "<x@gmail.com>", from: "Someone <a@gmail.com>" });
  check("non-MEF sender → ignored", outsider.json.status === "ignored" && outsider.json.events === 0, JSON.stringify(outsider));

  const wrong = await post(mail, fill("TESTwrongToken"));
  check("unknown token → 401", wrong.code === 401, JSON.stringify(wrong));

  const bad = await post({ ...mail, sentAt: "not a date" });
  check("invalid body → 400", bad.code === 400, JSON.stringify(bad));

  const events = await sql`select type, date::text as date, start_time::text as start, status, source, mail_id
                           from course_events where semester_id = ${semesterId} and course_code = 'TEST999'`;
  check(
    "DB: one unconfirmed cancel on 2026-11-16 13:00, from mail",
    events.length === 1 && events[0].type === "cancel" && events[0].date === "2026-11-16" &&
      events[0].start === "13:00:00" && events[0].source === "mail" && events[0].mail_id !== null &&
      events[0].status === "unconfirmed",
    JSON.stringify(events),
  );

  const mails = await sql`select outcome, subject from ingested_mails m join volunteers v on v.id = m.volunteer_id
                          where v.student_id = ${studentId} order by m.id`;
  check("DB: mail rows keep subject only for the course mail", mails.length === 2 && mails[0].subject !== null, JSON.stringify(mails.map((m) => m.outcome)));

  const ics = await (await fetch(`${base}/cal/${feedToken}.ics`)).text();
  const cancelled = ics.split("BEGIN:VEVENT").find((e) => e.includes("20261116T1300"));
  // Mail events wait for a person's confirmation: ❓, not cancelled yet.
  check(
    "feed: the 16 Nov lab shows as ❓ Muhtemelen iptal (not yet cancelled)",
    !!cancelled && cancelled.includes("Muhtemelen iptal") && !cancelled.includes("STATUS:CANCELLED"),
    cancelled?.slice(0, 300) ?? "no such event",
  );
  const lecture = ics.split("BEGIN:VEVENT").find((e) => e.includes("20261116T0900"));
  check("feed: the 16 Nov lecture is untouched", !!lecture && !lecture.includes("İPTAL"), lecture?.slice(0, 300) ?? "no such event");
} finally {
  await sql`delete from course_events where semester_id = ${semesterId} and course_code = 'TEST999'`;
  if (studentId !== null) {
    await sql`delete from ingested_mails where volunteer_id in (select id from volunteers where student_id = ${studentId})`;
    await sql`delete from students where id = ${studentId}`; // cascades enrollments + volunteer
  }
  await sql`delete from meetings where semester_id = ${semesterId} and course_code = 'TEST999'`;
  await sql`delete from sections where semester_id = ${semesterId} and course_code = 'TEST999'`;
  const [left] = await sql`
    select (select count(*) from course_events where course_code = 'TEST999')
         + (select count(*) from meetings where course_code = 'TEST999')
         + (select count(*) from sections where course_code = 'TEST999')
         + (select count(*) from students where feed_token like 'TESTfeedToken%') as n`;
  console.log(`cleanup: ${left.n === "0" || left.n === 0 ? "all TEST999 data removed" : `${left.n} rows left!`}`);
}

process.exit(failures === 0 ? 0 : 1);
