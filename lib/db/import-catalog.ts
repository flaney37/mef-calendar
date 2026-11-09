import { sql } from "drizzle-orm";
import type { CatalogSection } from "@/lib/catalog";
import { db } from "./index";
import { meetings, sections } from "./schema";

// Makes the database match the catalog for every section in it, in one
// transaction. Sections that are not in the catalog (entered by students)
// are left alone. Re-running with a newer export applies room/time changes.
export async function importCatalog(semesterId: number, catalog: CatalogSection[]) {
  const keys = sql.join(
    catalog.map((s) => sql`(${s.courseCode}, ${s.section})`),
    sql`, `,
  );

  const meetingRows = catalog.flatMap((s) =>
    s.slots.map((slot) => ({
      semesterId,
      courseCode: s.courseCode,
      section: s.section,
      ...slot,
    })),
  );

  await db.batch([
    db
      .insert(sections)
      .values(
        catalog.map((s) => ({
          semesterId,
          courseCode: s.courseCode,
          section: s.section,
          courseName: s.courseName,
          instructor: s.instructor,
          source: "catalog" as const,
        })),
      )
      .onConflictDoUpdate({
        target: [sections.semesterId, sections.courseCode, sections.section],
        // The catalog wins over anything a student typed.
        set: {
          courseName: sql`excluded.course_name`,
          instructor: sql`excluded.instructor`,
          source: sql`excluded.source`,
        },
      }),
    db
      .delete(meetings)
      .where(
        sql`${meetings.semesterId} = ${semesterId}
            and (${meetings.courseCode}, ${meetings.section}) in (values ${keys})`,
      ),
    db.insert(meetings).values(meetingRows),
  ]);

  return { sections: catalog.length, meetings: meetingRows.length };
}
