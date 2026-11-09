// Course codes are stored normalized ("COMP201") and shown with a space
// ("COMP 201"). Every place that reads user/AI input goes through
// normalizeCourseCode, so "comp 201", "COMP201" and " Comp  201 " all match.

// Plain toUpperCase on purpose: codes are ASCII ("HISTR"), and a Turkish
// locale would turn a typed "histr" into "HİSTR", which never matches.
export function normalizeCourseCode(input: string): string {
  return input.replace(/\s+/g, "").toUpperCase();
}

// Letters then digits (+ optional trailing letter), e.g. COMP201, HISTR213, PHYS101L.
export const COURSE_CODE_PATTERN = /^[A-Z]{2,6}\d{3,4}[A-Z]?$/;

export function displayCourseCode(code: string): string {
  return code.replace(/^([A-Z]+)(\d)/, "$1 $2");
}

// "01" and "1" are the same section; non-numeric sections are kept as-is.
export function normalizeSection(input: string): string {
  const trimmed = input.trim().toUpperCase();
  return /^\d+$/.test(trimmed) ? String(Number(trimmed)) : trimmed;
}
