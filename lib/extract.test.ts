import { describe, expect, it } from "vitest";
import { findCourseRows, matchToCatalog, similarity, type CatalogEntry } from "./extract";

// Real Tesseract.js ("eng") output for a 2026-2027 Fall SIS screenshot,
// course list part only (the advisor line is left out on purpose).

// Screenshot as-is (2000 px wide): small text, codes badly garbled.
const OCR_SMALL = `
COMP 201 ECON 114 EE 203 comp 205
Maslak A101 1 Maslak Online Maslak A403 4 Maslak A101 1
09:00- 11:50 09:00- 11:50 13:00 - 14:50 10:00- 12:50
DERS KODU DERS ADI SECTION GGRETIM ELEMANI KREDI
coup 201 Data Structures and Algorithms 1 YASSINE DRIAS 60
coup 205 Systems Programming 2 ADEM KARAHOCA 60
Econ 114 Economics or Engineering 1 MURAT DONDURAN 40
eE209 Dighal Systems Design 3 Over USTA 60
HISTR 213 Principles of Ataturk and History ofthe Turkish Republe | 1 HAVVAKARAGOZ 20
wa 211 Linear Algebra 3 MUSTAFA LUTF| OVEGOGLU 60
TURK 114 Turkish Language and Literature 1 1 IPEK SAHBENDEROGLU 20
`;

// Same screenshot upscaled 3x before OCR: clean.
const OCR_UPSCALED = `
COMP 201 | ECON 114 EE 203 COMP 205
COMP 201 COMP 205 MATH 211
EE 203
DERS KODU DERS ADI SECTION OGRETIM ELEMANI KREDI
COMP 201 Data Structures and Algorithms 1 YASSINE DRIAS 6.0
COMP 205 Systems Programming 2 ADEM KARAHOCA 6.0
ECON 114 Economics for Engineering 1 MURAT DONDURAN 4.0
EE 203 Digital Systems Design 3 OMER USTA 6.0
HISTR 213 Principles of Ataturk and History of the Turkish Republic | 1 HAVVA KARAGOZ 2.0
MATH 211 Linear Algebra 3 MUSTAFA LUTFI OVEGCOGLU 6.0
TURK 114 Turkish Language and Literature II 1 IPEK SAHBENDEROGLU 20
`;

// Full-page desktop screenshot (1280 px wide, whole SIS page with lots of
// white space) upscaled 3x: codes fine, but sections and credits garbled
// (1 → ' or |], credits → [1, ao, LT]) and HISTR read as HSTR.
const OCR_FULL_PAGE = `
DERS KODU DERS ADI SECTION OGRETIM ELEMANI KREDI
COMP 201 Data Structures and Algorms 1 YASSINE DRIAS [1
COMP 205 Systoms Programming 2 ADEM KARAMOCA ao
ECON 114 Economics for Engineering ' MURAT DONDURAN 40
EE 203 Digital Systems Design 3 OMER USTA 60
HSTR213 Pranciples of Alaturk and Hastory of fe Turkish Reputée | |] HAYVA KARAGOZ 20
MATH 211 Lines Algotra 3 MUSTAFA LUTFI OVEGOGLY LT]
TURK 114 Turkish Language and Litersture || 1 IPEK SAMBENDEROGLUY 20
= 4
`;

// A slice of the real catalog, with look-alikes that must not win.
const catalog: CatalogEntry[] = [
  { courseCode: "COMP201", section: "1", courseName: "Data Structures and Algorithms" },
  { courseCode: "COMP201", section: "2", courseName: "Data Structures and Algorithms" },
  { courseCode: "COMP205", section: "2", courseName: "Systems Programming" },
  { courseCode: "ECON114", section: "1", courseName: "Economics for Engineering" },
  { courseCode: "EE203", section: "1", courseName: "Digital Systems Design" },
  { courseCode: "EE203", section: "3", courseName: "Digital Systems Design" },
  { courseCode: "MATH211", section: "1", courseName: "Linear Algebra" },
  { courseCode: "MATH211", section: "3", courseName: "Linear Algebra" },
  { courseCode: "MATH212", section: "3", courseName: "Differential Equations" },
];

const expected = [
  { code: "COMP201", section: "1" },
  { code: "COMP205", section: "2" },
  { code: "ECON114", section: "1" },
  { code: "EE203", section: "3" },
  { code: "HISTR213", section: "1" },
  { code: "MATH211", section: "3" },
  { code: "TURK114", section: "1" },
];
const strip = (cs: { code: string; section: string }[]) =>
  cs.map(({ code, section }) => ({ code, section }));

describe("findCourseRows", () => {
  it("reads every course row of a clean OCR text", () => {
    expect(strip(findCourseRows(OCR_UPSCALED))).toEqual(expected);
  });

  it("ignores the weekly grid above the course list", () => {
    // The grid line "COMP 201 COMP 205 MATH 211" must not become a row.
    expect(findCourseRows(OCR_UPSCALED)).toHaveLength(7);
  });

  it("splits name and section even with a trailing roman numeral", () => {
    const turk = findCourseRows(OCR_UPSCALED).find((r) => r.code === "TURK114");
    expect(turk).toEqual({
      code: "TURK114",
      section: "1",
      name: "Turkish Language and Literature II",
    });
  });

  it("handles OCR noise: lowercase, missing spaces, '|' and credits without a dot", () => {
    const rows = findCourseRows(OCR_SMALL);
    expect(rows).toHaveLength(7);
    expect(rows.find((r) => r.name.startsWith("Principles"))?.section).toBe("1");
    expect(rows.find((r) => r.name === "Linear Algebra")?.section).toBe("3");
  });

  it("survives garbled sections and credits", () => {
    const rows = findCourseRows(OCR_FULL_PAGE);
    expect(rows.map((r) => `${r.code}-${r.section}`)).toEqual([
      "COMP201-1",
      "COMP205-2",
      "ECON114-1", // section read as '
      "EE203-3",
      "HSTR213-1", // section read as |]; prefix is fixed later, against the catalog
      "MATH211-3",
      "TURK114-1", // "Literature II" read as "Litersture ||", then the real 1
    ]);
    expect(rows.find((r) => r.code === "ECON114")?.name).toBe("Economics for Engineering");
  });

  it("does not take a number from the instructor or credit columns as the section", () => {
    const [row] = findCourseRows("DERS KODU\nCOMP 205 Systems Programming 2 ADEM KARAHOCA 40\n");
    expect(row.section).toBe("2");
  });

  it("skips a row whose section can't be found at all", () => {
    expect(findCourseRows("DERS KODU\nCOMP 205 Systems Programming ADEM KARAHOCA\n")).toEqual([]);
  });

  it("keeps nothing but code, section and course name", () => {
    for (const row of findCourseRows(OCR_UPSCALED)) {
      expect(Object.keys(row).sort()).toEqual(["code", "name", "section"]);
      expect(row.name).not.toMatch(/DRIAS|KARAHOCA/); // no instructor names
    }
  });

  it("finds nothing in text without a course list", () => {
    expect(findCourseRows("TC Kimlik No 12345678901\nAD SOYAD\n")).toEqual([]);
  });
});

describe("similarity", () => {
  it("scores OCR typos close to the real name", () => {
    expect(similarity("Dighal Systems Design", "Digital Systems Design")).toBeGreaterThan(0.8);
    expect(similarity("Linear Algebra", "Differential Equations")).toBeLessThan(0.3);
  });
});

describe("matchToCatalog", () => {
  it("accepts clean rows as read", () => {
    const matched = matchToCatalog(findCourseRows(OCR_UPSCALED), catalog);
    expect(strip(matched)).toEqual(expected);
    expect(matched.find((c) => c.code === "COMP201")?.match).toBe("code");
    expect(matched.find((c) => c.code === "HISTR213")?.match).toBe("none");
  });

  it("repairs garbled codes using course name + section", () => {
    const matched = matchToCatalog(findCourseRows(OCR_SMALL), catalog);
    expect(strip(matched)).toEqual(expected);
    // coup 201 → COMP201, eE209 → EE203 (section 3, not 1), wa 211 → MATH211
    expect(matched.find((c) => c.code === "EE203")?.match).toBe("name");
    expect(matched.find((c) => c.code === "MATH211")?.match).toBe("name");
  });

  it("fixes a misread department prefix, also for courses outside the catalog", () => {
    const matched = matchToCatalog(findCourseRows(OCR_FULL_PAGE), catalog);
    expect(strip(matched)).toEqual(expected); // HSTR213 → HISTR213
  });

  it("drops a course of an unknown department when the name matches nothing", () => {
    // Real junk row from an over-upscaled pass: "Tide 114 TT e— 1 …"
    expect(matchToCatalog([{ code: "TIDE114", section: "1", name: "TT e—" }], catalog)).toEqual([]);
  });

  it("keeps a known-department course that is not in the catalog", () => {
    expect(matchToCatalog([{ code: "TURK114", section: "1", name: "Turkish" }], catalog)).toEqual([
      { code: "TURK114", section: "1", match: "none" },
    ]);
  });

  it("prefers the prefix with the same first letter on a tie", () => {
    const catalogWithStat = [...catalog, { courseCode: "STAT102", section: "1", courseName: "Statics" }];
    const [course] = matchToCatalog([{ code: "HSTA213", section: "1", name: "" }], catalogWithStat);
    expect(course.code).toBe("HISTR213");
  });

  it("merges rows of several OCR passes into one entry per course", () => {
    const passes = [...findCourseRows(OCR_SMALL), ...findCourseRows(OCR_FULL_PAGE), ...findCourseRows(OCR_UPSCALED)];
    expect(strip(matchToCatalog(passes, catalog))).toEqual(expected);
  });

  it("lets the most certain reading win when passes disagree on the section", () => {
    const merged = matchToCatalog(
      [
        { code: "XX201", section: "2", name: "Data Structures and Algorithms" }, // name match → COMP201-2
        { code: "COMP201", section: "1", name: "Data Structures and Algorithms" }, // exact
      ],
      catalog,
    );
    expect(merged).toEqual([{ code: "COMP201", section: "1", match: "code" }]);
  });
});
