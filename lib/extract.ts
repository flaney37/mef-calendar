// OCR text of a SIS "Ders Programı" screenshot → the student's courses.
//
// Pure functions only: no OCR, DOM or database imports, so it is easy to test
// with real OCR output. The OCR text itself never leaves the browser; only
// the rows found here (code, section, course name) are used further.
//
// Two stages:
// 1. findCourseRows: pick the rows of the course list under the "DERS KODU"
//    header and split each into code / name / section. Everything else on
//    the page (student name, ID number, advisor, weekly grid) is ignored.
// 2. matchToCatalog: OCR often garbles the short code ("coup 201", "wa 211")
//    but reads the course name well, so when the code + section is not in
//    the catalog, the course name + section is used to find it.

import { COURSE_CODE_PATTERN, normalizeSection } from "./course-code";

export type OcrRow = {
  code: string; // best guess, normalized like "COMP201"
  section: string;
  name: string;
};

export type CatalogEntry = { courseCode: string; section: string; courseName: string | null };

export type MatchedCourse = {
  code: string;
  section: string;
  // "code": code + section found in the catalog (as read, or after fixing
  // a misread department prefix like "COUP" → "COMP").
  // "name": code fixed using the course name. "none": not in the catalog
  // (e.g. HISTR 213, which has no fixed slot) — kept as read.
  match: "code" | "name" | "none";
};

// A course-list row is CODE NAME SECTION INSTRUCTOR CREDIT, e.g.
//   "COMP 201 Data Structures and Algorithms 1 YASSINE DRIAS 6.0"
// Real OCR output is messier, so only the start is matched strictly:
//   "ECON 114 Economics for Engineering ' MURAT DONDURAN 40"   (1 read as ')
//   "MATH 211 Lines Algotra 3 MUSTAFA LUTFI OVEGOGLY LT]"     (credit garbled)
// The credit column is ignored; the section is found between the course
// name and the instructor's name (see splitRest).
const ROW_START = /^\s*([A-Za-z0-9]{2,6}(?:\/[A-Za-z0-9]{2,6})?)\s?([0-9OoIlSZB]{3,4}[A-Za-z]?)\s+(.*)$/;

// "1" is a thin glyph and often comes out as one of these.
const LOOKS_LIKE_ONE = /^[|lI'!\][]{1,2}$/;
const DIGITS = /^\d{1,2}$/;
// Instructor names are written in capitals (YASSINE DRIAS, ÖMER USTA).
const ALL_CAPS_WORD = /^[A-ZÇĞİÖŞÜ]{3,}$/;

// Text after the code → course name + section. null if no section is found.
function splitRest(rest: string): { name: string; section: string } | null {
  const tokens = rest.split(/\s+/).filter(Boolean);
  // The instructor starts at the first all-caps word after the name.
  const instructor = tokens.findIndex((t, i) => i > 0 && ALL_CAPS_WORD.test(t));
  const region = instructor > 0 ? tokens.slice(0, instructor) : tokens;

  // Before the instructor: the section is the last number (a course name
  // can end in a roman numeral read as "||", so digits win over look-alikes).
  // Without a known instructor, credits may follow, so take the first one.
  const pick = (test: RegExp) => {
    const indexes = region.map((t, i) => (test.test(t) && i > 0 ? i : -1)).filter((i) => i >= 0);
    return instructor > 0 ? indexes.at(-1) : indexes[0];
  };
  const at = pick(DIGITS) ?? pick(LOOKS_LIKE_ONE);
  if (at === undefined) return null;

  // Drop stray table borders (| ] ') from the name, but keep letters:
  // "II" in "Literature II" is part of the name.
  const name = region
    .slice(0, at)
    .filter((t) => !/^[|'!\][]+$/.test(t))
    .join(" ");
  return { name, section: DIGITS.test(region[at]) ? region[at] : "1" };
}

// OCR swaps look-alike characters. Letters belong in the prefix, digits in
// the number, so each part is pushed toward the expected kind.
const TO_LETTER: Record<string, string> = { "0": "O", "1": "I", "5": "S", "8": "B", "2": "Z" };
const TO_DIGIT: Record<string, string> = { O: "0", I: "1", L: "1", S: "5", B: "8", Z: "2" };

function cleanCode(prefix: string, number: string): string {
  const letters = prefix.toUpperCase().replace(/[0-9]/g, (d) => TO_LETTER[d] ?? d);
  const digits = number
    .toUpperCase()
    .replace(/^([A-Z0-9]{3,4})/, (core) => core.replace(/[A-Z]/g, (c) => TO_DIGIT[c] ?? c));
  return letters + digits;
}

export function findCourseRows(ocrText: string): OcrRow[] {
  const lines = ocrText.split(/\r?\n/);
  // The weekly grid above also contains course codes; start after the
  // course list header when it was read.
  const header = lines.findIndex((l) => /DERS\s*KODU/i.test(l));
  const rows: OcrRow[] = [];
  const seen = new Set<string>();

  for (const line of lines.slice(header + 1)) {
    const m = ROW_START.exec(line);
    if (!m) continue;
    const rest = splitRest(m[3]);
    if (!rest) continue;
    const code = cleanCode(m[1], m[2]);
    const section = normalizeSection(rest.section);
    const key = `${code}-${section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ code, section, name: rest.name });
  }
  return rows;
}

// Similarity of two strings, 0…1 (Dice coefficient over letter pairs).
// Robust to OCR typos like "Dighal Systems Design" vs "Digital Systems Design".
export function similarity(a: string, b: string): number {
  const pairs = (s: string) => {
    const t = s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const out: string[] = [];
    for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2));
    return out;
  };
  const pa = pairs(a);
  const pb = pairs(b);
  if (pa.length === 0 || pb.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const p of pb) counts.set(p, (counts.get(p) ?? 0) + 1);
  let common = 0;
  for (const p of pa) {
    const n = counts.get(p) ?? 0;
    if (n > 0) {
      common++;
      counts.set(p, n - 1);
    }
  }
  return (2 * common) / (pa.length + pb.length);
}

// Below this, a name match is not trusted and the row is kept as read.
const NAME_MATCH_THRESHOLD = 0.7;

// Departments of courses without a fixed slot, which never appear in the
// catalog but do appear in students' course lists.
const NON_CATALOG_PREFIXES = ["HISTR", "TURK"];

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = old;
    }
  }
  return row[b.length];
}

// "HSTR213" → "HISTR213": snap an unknown department prefix to the closest
// known one, if it is only a letter or so away.
function fixPrefix(code: string, prefixes: Set<string>): string {
  const m = /^([A-Z/]+)(.*)$/.exec(code);
  if (!m || prefixes.has(m[1])) return code;
  let best: string | null = null;
  let bestDistance = m[1].length >= 4 ? 2 : 1;
  for (const p of prefixes) {
    const d = editDistance(m[1], p);
    if (d < bestDistance || (d === bestDistance && best === null)) {
      best = p;
      bestDistance = d;
    }
  }
  return best ? best + m[2] : code;
}

export function matchToCatalog(rows: OcrRow[], catalog: CatalogEntry[]): MatchedCourse[] {
  const byKey = new Set(catalog.map((c) => `${c.courseCode}-${c.section}`));
  const prefixes = new Set([
    ...catalog.map((c) => /^[A-Z/]+/.exec(c.courseCode)?.[0] ?? ""),
    ...NON_CATALOG_PREFIXES,
  ]);

  return rows.map((read) => {
    const row = { ...read, code: fixPrefix(read.code, prefixes) };
    if (byKey.has(`${row.code}-${row.section}`)) {
      return { code: row.code, section: row.section, match: "code" };
    }
    let best: CatalogEntry | null = null;
    let bestScore = 0;
    for (const entry of catalog) {
      if (entry.section !== row.section || !entry.courseName) continue;
      const score = similarity(row.name, entry.courseName);
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    if (best && bestScore >= NAME_MATCH_THRESHOLD) {
      return { code: best.courseCode, section: best.section, match: "name" };
    }
    // Not in the catalog. Keep it only if it at least looks like a code.
    return COURSE_CODE_PATTERN.test(row.code)
      ? { code: row.code, section: row.section, match: "none" }
      : null;
  }).filter((c): c is MatchedCourse => c !== null);
}
