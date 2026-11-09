// The SIS course catalog ("Tüm Ders Programı"), exported to JSON from the
// SIS page by hand (see CLAUDE.md). It is the source of truth for section
// times: a student's own entry for a catalog section is not used.

import { z } from "zod";
import { COURSE_CODE_PATTERN, normalizeCourseCode, normalizeSection } from "./course-code";

const WEEKDAYS: Record<string, number> = {
  Pazartesi: 1,
  Salı: 2,
  Çarşamba: 3,
  Perşembe: 4,
  Cuma: 5,
  Cumartesi: 6,
  Pazar: 7,
};

export type CatalogSlot = { weekday: number; startTime: string; endTime: string; room: string };

export type CatalogSection = {
  courseCode: string; // normalized, e.g. "COMP201"
  section: string;
  courseName: string;
  instructor: string | null;
  slots: CatalogSlot[];
};

// "A101 / Pazartesi / 09:00 - 11:50"
const SLOT_PATTERN = /^(.+?) \/ (\S+) \/ (\d{2}:\d{2}) - (\d{2}:\d{2})$/;

export function parseSlot(line: string): CatalogSlot {
  const match = SLOT_PATTERN.exec(line.trim());
  const weekday = match ? WEEKDAYS[match[2]] : undefined;
  if (!match || !weekday) throw new Error(`Unrecognized slot: ${JSON.stringify(line)}`);
  return { room: match[1], weekday, startTime: match[3], endTime: match[4] };
}

// Shape of the exported file; one entry per row of the SIS table.
const catalogFileSchema = z.object({
  source: z.string(),
  fetchedAt: z.string(),
  sections: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      section: z.string(),
      instructors: z.array(z.string()),
      slots: z.array(z.string()),
    }),
  ),
});

export function parseCatalog(file: unknown): CatalogSection[] {
  const { sections } = catalogFileSchema.parse(file);
  const seen = new Set<string>();

  return sections.map((row) => {
    const courseCode = normalizeCourseCode(row.code);
    const section = normalizeSection(row.section);
    if (!COURSE_CODE_PATTERN.test(courseCode)) {
      throw new Error(`Unrecognized course code: ${JSON.stringify(row.code)}`);
    }
    const key = `${courseCode}-${section}`;
    if (seen.has(key)) throw new Error(`Duplicate section in catalog: ${key}`);
    seen.add(key);

    // SIS sometimes lists the very same slot twice (seen: FIN 525, FIN 526).
    // A section can't meet twice at the same day and start time, so keep the
    // first one; this also matches the unique index on meetings.
    const slots = new Map<string, CatalogSlot>();
    for (const slot of row.slots.map(parseSlot)) {
      const slotKey = `${slot.weekday} ${slot.startTime}`;
      if (!slots.has(slotKey)) slots.set(slotKey, slot);
    }

    return {
      courseCode,
      section,
      courseName: row.name,
      instructor: row.instructors.length > 0 ? row.instructors.join(", ") : null,
      slots: [...slots.values()],
    };
  });
}
