// Inserts semester rows from MEF's academic calendar. Safe to re-run:
// a semester that already exists (by name) is updated, not duplicated.
// Run with: pnpm db:seed
import { neon } from "@neondatabase/serverless";

const semesters = [
  {
    name: "2026-2027 Fall",
    startDate: "2026-09-14", // "Derslerin Başlangıcı"
    endDate: "2026-12-11", // "Derslerin Son Günü"
    holidays: ["2026-10-28", "2026-10-29", "2026-10-30"],
  },
];

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");
const sql = neon(url);

for (const s of semesters) {
  const updated = await sql`
    update semesters
    set start_date = ${s.startDate}, end_date = ${s.endDate}, holidays = ${s.holidays}::date[]
    where name = ${s.name}
    returning id`;
  if (updated.length === 0) {
    await sql`
      insert into semesters (name, start_date, end_date, holidays)
      values (${s.name}, ${s.startDate}, ${s.endDate}, ${s.holidays}::date[])`;
    console.log(`inserted ${s.name}`);
  } else {
    console.log(`updated ${s.name}`);
  }
}
