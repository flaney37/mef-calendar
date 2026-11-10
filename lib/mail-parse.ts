// Phase 4: turning an announcement mail into course events.
//
// Two steps, both pure (no DB, no network), so they can be tested with real
// mails:
//   1. parseMail(): only the mail. Which course, what happened (cancel,
//      online, exam…), which date(s), which time, lab or lecture.
//   2. mailToEvents(): matches that against the course's weekly meetings and
//      turns it into the same EventInput the admin panel produces.
//
// Rules learned from real MEF mails (2026-11-10):
// - Almost every course mail comes through Blackboard
//   (do-not-reply@mef.blackboard.com) and carries a course key like
//   "2026-2027-01-COMP201-01": course AND section, with certainty.
// - The subject usually says what happened ("No Labs This Week",
//   "Lecture 7 is online on 6th Nov Friday at 10:00"); the body adds the
//   exact date. So the type comes from the subject when it has a keyword.
// - The Blackboard footer says "Any multimedia items must be viewed online":
//   cut it off, or every mail looks like an "online" notice.
// - Mails mention past dates too ("since we had no lecture on October 29th"):
//   dates before the day the mail was sent are dropped.
// Anything the rules can't place for sure becomes "unconfirmed" (❓ in the
// calendar) or "unsure" (no event, shown in /admin), never a silent guess.

import { normalizeCourseCode, normalizeSection } from "./course-code";
import type { EventInput, EventType } from "./event-input";
import {
  addDays,
  daysBetween,
  istanbulDate,
  isoWeekday,
  meetingKind,
  toHHMM,
  type Meeting,
  type MeetingKind,
  type Semester,
} from "./schedule";

export type MailInput = {
  subject: string;
  body: string; // plain text
  sentAt: Date;
};

export type CourseRef = {
  courseCode: string; // normalized, "COMP201"
  section: string | null; // null = every section
  fromKey: boolean; // came from a Blackboard course key → certain
};

export type DateRange = { start: string; end: string }; // YYYY-MM-DD, inclusive

export type ParsedMail =
  | { outcome: "ignored"; reason: string }
  | { outcome: "unsure"; reason: string; course: CourseRef | null }
  | {
      outcome: "event";
      course: CourseRef | null; // null only when allCourses
      allCourses: boolean; // "[EVERYONE] classes online tomorrow"
      type: EventType;
      dates: DateRange[]; // a permanent change runs to OPEN_END (cut at semester end)
      weekdays: number[] | null; // only sessions on these ISO weekdays (permanent changes)
      startTime: string | null; // "HH:MM"
      endTime: string | null;
      kind: MeetingKind | null; // lab / lecture, null = not said
      room: string | null;
      title: string | null;
      confident: boolean;
      notes: string[]; // why it is not confident (for /admin and tests)
    };

// ---------------------------------------------------------------------------
// Text helpers

// Lowercase + strip Turkish/English accents, so "Çarşamba", "CARSAMBA" and
// "çarşamba" all become "carsamba". "İ" and "I" both become "i" first (a
// plain toLowerCase would turn "I" into "i" but "İ" into "i̇").
export function fold(text: string): string {
  return text
    .replace(/[İI]/g, "i")
    .toLowerCase()
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Where the Blackboard notification ends and its footer starts.
const FOOTER_MARKERS = [
  "View Message",
  "View Announcement",
  "Email brought to you by",
  "Any multimedia items must be viewed online",
];

export function cleanBody(body: string): string {
  let end = body.length;
  for (const marker of FOOTER_MARKERS) {
    const i = body.indexOf(marker);
    if (i !== -1 && i < end) end = i;
  }
  return body.slice(0, end);
}

// Split on line breaks and on ". " followed by a capital letter, so
// "Nov. 4th" and "Hk. /" stay in one piece.
function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+(?=[A-ZÇĞİÖŞÜ])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// ---------------------------------------------------------------------------
// Course

const BLACKBOARD_KEY = /\b\d{4}-\d{4}-\d{2}-([A-Z]{2,6}\d{3,4}[A-Z]?)-(\d{1,3})\b/i;
// "COMP 201", "ECON114", "MATH 211". Uppercase only, so ordinary words
// followed by a number ("Lab 6", "Lecture 7") don't count.
const TEXT_COURSE = /\b([A-Z]{2,6})\s?(\d{3,4}[A-Z]?)\b/g;
const TEXT_SECTION = /\b(?:section|sec\.?|sube)\s*(\d{1,2})\b/;

function findCourse(subject: string, body: string): CourseRef | "many" | null {
  const key = (subject + "\n" + body).match(BLACKBOARD_KEY);
  if (key) {
    return { courseCode: normalizeCourseCode(key[1]), section: normalizeSection(key[2]), fromKey: true };
  }
  const codes = new Set<string>();
  for (const m of (subject + "\n" + body).matchAll(TEXT_COURSE)) codes.add(normalizeCourseCode(m[1] + m[2]));
  if (codes.size > 1) return "many";
  if (codes.size === 0) return null;
  const section = fold(subject + "\n" + body).match(TEXT_SECTION);
  return { courseCode: [...codes][0], section: section ? normalizeSection(section[1]) : null, fromKey: false };
}

// ---------------------------------------------------------------------------
// What happened

type Classified = EventType | "postponed" | "conflict";

const IGNORE_SUBJECT =
  /\b(submission received|daily notifications?|results?|sonuc\w*|grades?|notlar|paper review|attendance|due date|deadline|teslim\w*)\b/;
const POSTPONED = /\b(postponed|rescheduled|ertelen\w*|ileri bir tarih\w*)\b/;
const EXAM = /\b(midterm|vize|final|quiz|exam|sinav\w*)\b/;
// "No lab sessions this week" is a cancellation; a bare "there will be no …"
// is not ("there will be no make-up labs" is a rule, not an event).
const CANCEL =
  /\b(cancell?ed|cancel|iptal\w*|yapilmayacak\w*|olmayacak\w*|will not be held|won'?t be held|no (?:lab|labs|lab sessions?|class|classes|lectures?|lessons?))\b/;
// Sentences about what *would* happen: "If there is no lab on a particular
// week, you will be informed beforehand." Never an event.
const CONDITIONAL = /\b(if|unless|in case|eger|halinde|durumunda|takdirde)\b/;
// Course rules, not events: "there will be no make-up labs".
const POLICY = /\bno make-?up\b|\btelafi(?:si)? (?:yok|olmayacak\w*|yapilmayacak\w*)/g;
const MAKEUP = /\b(make-?up|make up (?:class|lecture|lab)|telafi\w*)\b/;
const ROOM = /\b(room change|classroom change|classroom update|sinif degis\w*|derslik degis\w*|new (?:room|classroom)|will be held in)\b/;
const ONLINE = /\b(online|cevrimici|uzaktan|ms teams|microsoft teams|zoom)\b/;
// A change that holds from now on, not for one session.
const RECURRING =
  /\b(starting (?:from )?(?:this|next|today|tomorrow|\d)|from now on|onwards|until further notice|for the rest of the semester|bundan (?:boyle|sonra)|itibaren|donem sonuna kadar)\b/;
export const OPEN_END = "9999-12-31";
const SESSION_CHANGES: readonly EventType[] = ["cancel", "online", "room_change"];
const HEDGE =/\b(might|possibly|probably|tentative\w*|muhtemelen|olabilir|planlan\w*)\b/;
const ALL_COURSES = /\[everyone\]|\b(tum dersler\w*|butun dersler\w*|derslerin|all classes|all courses|all lectures)\b/;

function classify(sentence: string): Classified | null {
  if (CONDITIONAL.test(sentence)) return null;
  const folded = sentence.replace(POLICY, " ");
  if (POSTPONED.test(folded)) return "postponed";
  const exam = EXAM.test(folded);
  const cancel = CANCEL.test(folded);
  if (exam && cancel) return "conflict"; // "the quiz is cancelled": not a session change
  if (exam) return "exam";
  if (cancel) return "cancel";
  if (MAKEUP.test(folded)) return "makeup";
  if (ROOM.test(folded)) return "room_change";
  if (ONLINE.test(folded)) return "online";
  return null;
}

function examTitle(folded: string): string {
  if (/\b(midterm|vize)\b/.test(folded)) return "Vize";
  if (/\bfinal\b/.test(folded)) return "Final";
  if (/\bquiz\b/.test(folded)) return "Quiz";
  return "Sınav";
}

function kindOf(folded: string): MeetingKind | null {
  if (/\b(labs?|lab sessions?|laborator\w*|laboratuvar\w*|uygulama\w*)\b/.test(folded)) return "lab";
  if (/\b(lectures?|ders|dersi|class)\b/.test(folded)) return "lecture";
  return null;
}

// The new room ("A101", "B-315", "E 204"). The old one is skipped:
// "held in A415 instead of A303", "moved from A303 to A415",
// "A303 yerine A415".
function roomIn(text: string): string | null {
  const rooms = [...text.matchAll(/\b([A-Z]{1,2})[ -]?(\d{3})\b/g)].filter((m) => {
    const before = fold(text.slice(Math.max(0, m.index - 12), m.index));
    const after = fold(text.slice(m.index + m[0].length, m.index + m[0].length + 8));
    return !/(instead of|from)\s*$/.test(before) && !/^\s*(yerine|'?(?:den|dan|ten|tan)\b)/.test(after);
  });
  const last = rooms.at(-1);
  return last ? `${last[1]}${last[2]}` : null;
}

// ---------------------------------------------------------------------------
// Dates

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, ocak: 1,
  february: 2, feb: 2, subat: 2,
  march: 3, mar: 3, mart: 3,
  april: 4, apr: 4, nisan: 4,
  may: 5, mayis: 5,
  june: 6, jun: 6, haziran: 6,
  july: 7, jul: 7, temmuz: 7,
  august: 8, aug: 8, agustos: 8,
  september: 9, sept: 9, sep: 9, eylul: 9,
  october: 10, oct: 10, ekim: 10,
  november: 11, nov: 11, kasim: 11,
  december: 12, dec: 12, aralik: 12,
};

const WEEKDAYS: Record<string, number> = {
  monday: 1, pazartesi: 1,
  tuesday: 2, sali: 2,
  wednesday: 3, carsamba: 3,
  thursday: 4, persembe: 4,
  friday: 5, cuma: 5,
  saturday: 6, cumartesi: 6,
  sunday: 7, pazar: 7,
};

const alternation = (words: string[]) => words.sort((a, b) => b.length - a.length).join("|");
const MONTH = `(${alternation(Object.keys(MONTHS))})\\.?`;
const WEEKDAY = `(${alternation(Object.keys(WEEKDAYS))})`;
const DAY = `(\\d{1,2})(?:st|nd|rd|th)?`;
const YEAR = `(?:,?\\s+(\\d{4}))?`;
const DASH = `\\s*[-–—]\\s*`;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// Day + month without a year: take the year that puts the date closest to
// when the mail was sent ("5 January" in a December mail = next year).
function makeDate(day: number, month: number, year: number | null, sent: string): string | null {
  const build = (y: number) => {
    const iso = `${y}-${pad(month)}-${pad(day)}`;
    const d = new Date(`${iso}T00:00:00Z`);
    return d.getUTCMonth() + 1 === month && d.getUTCDate() === day ? iso : null;
  };
  if (year) return build(year);
  const sentYear = Number(sent.slice(0, 4));
  const options = [sentYear - 1, sentYear, sentYear + 1]
    .map(build)
    .filter((d): d is string => d !== null);
  options.sort((a, b) => Math.abs(daysBetween(sent, a)) - Math.abs(daysBetween(sent, b)));
  return options[0] ?? null;
}

// Dates written out: "11 November 2026", "6th Nov", "Nov. 4th",
// "November 9–10", "16 Ekim", "12.11.2026", "09/11". Matched text is blanked
// so a range isn't counted again as two single dates.
function absoluteDates(folded: string, sent: string): DateRange[] {
  let text = folded;
  const found: DateRange[] = [];
  const take = (re: RegExp, toRange: (m: RegExpMatchArray) => DateRange | null) => {
    text = text.replace(re, (...args) => {
      const match = args.slice(0, -2) as unknown as RegExpMatchArray;
      const range = toRange(match);
      if (range) found.push(range);
      return " ".repeat(String(args[0]).length);
    });
  };
  const range = (d1: string, d2: string, mon: string, year: string | undefined) => {
    const start = makeDate(Number(d1), MONTHS[mon], year ? Number(year) : null, sent);
    const end = makeDate(Number(d2), MONTHS[mon], year ? Number(year) : null, sent);
    return start && end && start <= end ? { start, end } : null;
  };
  const single = (d: string, month: number, year: string | undefined) => {
    const date = makeDate(Number(d), month, year ? Number(year) : null, sent);
    return date ? { start: date, end: date } : null;
  };

  // "the week of October 5", "5 Ekim haftası": that day and the six after it.
  const week = (r: DateRange | null) => (r ? { start: r.start, end: addDays(r.start, 6) } : null);
  take(new RegExp(`\\bweek of\\s+${MONTH}\\s+${DAY}\\b${YEAR}`, "g"), (m) => week(single(m[2], MONTHS[m[1]], m[3])));
  take(new RegExp(`\\bweek of\\s+${DAY}\\s+(?:of\\s+)?${MONTH}${YEAR}`, "g"), (m) => week(single(m[1], MONTHS[m[2]], m[3])));
  take(new RegExp(`\\b${DAY}\\s+${MONTH}\\s+haftasi\\w*`, "g"), (m) => week(single(m[1], MONTHS[m[2]], undefined)));
  // "October 5 and 6", "5 ve 6 Ekim": two single days.
  const both = (d1: string, d2: string, mon: string, year: string | undefined) => {
    found.push(...[single(d1, MONTHS[mon], year), single(d2, MONTHS[mon], year)].filter((r): r is DateRange => r !== null));
    return null;
  };
  take(new RegExp(`\\b${MONTH}\\s+${DAY}\\s+(?:and|ve|&)\\s+${DAY}\\b${YEAR}`, "g"), (m) => both(m[2], m[3], m[1], m[4]));
  take(new RegExp(`\\b${DAY}\\s+(?:and|ve|&)\\s+${DAY}\\s+(?:of\\s+)?${MONTH}${YEAR}`, "g"), (m) => both(m[1], m[2], m[3], m[4]));
  take(new RegExp(`\\b${DAY}${DASH}${DAY}\\s+(?:of\\s+)?${MONTH}${YEAR}`, "g"), (m) => range(m[1], m[2], m[3], m[4]));
  take(new RegExp(`\\b${MONTH}\\s+${DAY}${DASH}${DAY}${YEAR}`, "g"), (m) => range(m[2], m[3], m[1], m[4]));
  take(new RegExp(`\\b${DAY}\\s+(?:of\\s+)?${MONTH}${YEAR}`, "g"), (m) => single(m[1], MONTHS[m[2]], m[3]));
  take(new RegExp(`\\b${MONTH}\\s+${DAY}\\b${YEAR}`, "g"), (m) => single(m[2], MONTHS[m[1]], m[3]));
  take(/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g, (m) => single(m[1], Number(m[2]), m[3]));
  take(/\b(\d{1,2})\/(\d{1,2})\b/g, (m) => (Number(m[2]) <= 12 ? single(m[1], Number(m[2]), undefined) : null));
  return found;
}

// The Monday of the week a date is in.
function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

type Relative = { ranges: DateRange[]; vague: boolean };
type RelativeLevel = (folded: string, sent: string) => Relative | null;

const one = (d: string): DateRange => ({ start: d, end: d });

// Relative dates, strongest kind first. Each level is tried on every
// sentence before the next level: "our lecture tonight" must win over a
// "(Thursday session)" in the greeting two lines up.
const RELATIVE_LEVELS: RelativeLevel[] = [
  // "today", "tonight", "yarın" (\w* for Turkish suffixes: "yarınki", "bugünkü").
  (folded, sent) => {
    if (/\b(day after tomorrow|obur gun|yarindan sonra)\b/.test(folded)) return { ranges: [one(addDays(sent, 2))], vague: false };
    if (/\b(tomorrow|yarin\w*)\b/.test(folded)) return { ranges: [one(addDays(sent, 1))], vague: false };
    if (/\b(today|tonight|this evening|bugun\w*|bu aksam\w*)\b/.test(folded)) return { ranges: [one(sent)], vague: false };
    return null;
  },
  // "bu Çarşamba", "on Friday", "next Monday". A weekday naming a group
  // ("Thursday session", "Perşembe grubu") is not a date.
  (folded, sent) => {
    const re = new RegExp(
      `\\b(?:(this|next|coming|bu|onumuzdeki|gelecek|haftaya)\\s+)?${WEEKDAY}\\b(?!\\s+(?:session|group|grubu|sube\\w*|section))`,
      "g",
    );
    const weekdays = [...folded.matchAll(re)];
    if (weekdays.length === 0) return null;
    const isNext = (m: RegExpMatchArray) => m[1] !== undefined && !["this", "bu"].includes(m[1]);
    const ranges = weekdays.map((m) => {
      const target = WEEKDAYS[m[2]];
      return one(
        isNext(m) ? addDays(mondayOf(sent), 7 + target - 1) : addDays(sent, (target - isoWeekday(sent) + 7) % 7),
      );
    });
    // "next Friday" is read differently by different people.
    return { ranges, vague: weekdays.some(isNext) };
  },
  // "this week", "next week". A "this week" mail sent on a weekend means
  // the coming week.
  (folded, sent) => {
    const thisWeek = isoWeekday(sent) >= 6 ? addDays(mondayOf(sent), 7) : mondayOf(sent);
    if (/\b(next week|following week|gelecek hafta|onumuzdeki hafta|haftaya)\b/.test(folded)) {
      return { ranges: [{ start: addDays(thisWeek, 7), end: addDays(thisWeek, 13) }], vague: false };
    }
    if (/\b(this week|bu hafta)\b/.test(folded)) return { ranges: [{ start: thisWeek, end: addDays(thisWeek, 6) }], vague: false };
    return null;
  },
];

function weekdaysIn(folded: string): number[] {
  return [...folded.matchAll(new RegExp(`\\b${WEEKDAY}\\b`, "g"))].map((m) => WEEKDAYS[m[1]]);
}

function sameRange(a: DateRange, b: DateRange): boolean {
  return a.start === b.start && a.end === b.end;
}

// ---------------------------------------------------------------------------
// Time

function timesIn(folded: string): { start: string | null; end: string | null } {
  const range = folded.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*[-–]\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (range) return { start: `${pad(Number(range[1]))}:${range[2]}`, end: `${pad(Number(range[3]))}:${range[4]}` };
  // A dotted "10.00" only counts after "at" / "saat"; a bare one could be a date.
  const single =
    folded.match(/\b(?:at|saat|@)\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/) ?? folded.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (single) return { start: `${pad(Number(single[1]))}:${single[2]}`, end: null };
  return { start: null, end: null };
}

// ---------------------------------------------------------------------------
// Step 1

export function parseMail(mail: MailInput): ParsedMail {
  const sent = istanbulDate(mail.sentAt);
  const body = cleanBody(mail.body);
  const foldedSubject = fold(mail.subject);

  if (IGNORE_SUBJECT.test(foldedSubject)) return { outcome: "ignored", reason: "Bildirim/sonuç maili" };

  const course = findCourse(mail.subject, body);
  if (course === "many") return { outcome: "unsure", reason: "Mailde birden fazla ders kodu var", course: null };

  // The course key would otherwise read as dates and numbers.
  const all = [mail.subject, ...sentences(body)].map((s) => fold(s.replace(BLACKBOARD_KEY, " ")));

  // What happened: the first sentence (subject first) with a keyword.
  let typeIndex = -1;
  let classified: Classified | null = null;
  for (let i = 0; i < all.length && classified === null; i++) {
    classified = classify(all[i]);
    if (classified !== null) typeIndex = i;
  }
  if (classified === null) return { outcome: "ignored", reason: "İptal/sınav/online gibi bir anahtar kelime yok" };

  const allCourses = course === null && all.some((s) => ALL_COURSES.test(s));
  if (classified === "postponed") return { outcome: "unsure", reason: "Ertelendi: yeni tarih elle girilmeli", course };
  if (classified === "conflict") return { outcome: "unsure", reason: "Hem sınav hem iptal geçiyor", course };
  if (course === null && !allCourses) return { outcome: "unsure", reason: "Ders kodu bulunamadı", course: null };

  const typeSentence = all[typeIndex];
  const notes: string[] = [];

  // When: dates written out anywhere win over relative words.
  let dateIndex = -1;
  let dates: DateRange[] = [];
  let vague = false;
  for (let i = 0; i < all.length; i++) {
    const found = absoluteDates(all[i], sent);
    if (found.length > 0 && dateIndex === -1) dateIndex = i;
    dates.push(...found);
  }
  if (dates.length === 0) {
    // Relative words: level by level, the sentence that said what happened first.
    const order = [typeIndex, ...[...all.keys()].filter((i) => i !== typeIndex)];
    search: for (const level of RELATIVE_LEVELS) {
      for (const i of order) {
        const rel = level(all[i], sent);
        if (rel) {
          dates = rel.ranges;
          vague = rel.vague;
          dateIndex = i;
          break search;
        }
      }
    }
  }
  dates = dates
    .filter((r) => r.end >= sent) // past dates are context, not the event
    .filter((r, i, list) => list.findIndex((o) => sameRange(o, r)) === i);

  // "Starting this week, Wednesday lab sessions will be held in A415": from
  // the first date (or now) to the end of the semester, on the weekdays named.
  const recurring = SESSION_CHANGES.includes(classified) && all.some((s) => RECURRING.test(s));
  let weekdays: number[] | null = null;
  if (recurring) {
    const start = dates.length > 0 ? dates.map((r) => r.start).sort()[0] : sent;
    dates = [{ start: start < sent ? sent : start, end: OPEN_END }];
    const named = [...new Set(all.filter((s) => s === typeSentence || RECURRING.test(s)).flatMap(weekdaysIn))];
    weekdays = named.length > 0 ? named : null;
    vague = false;
  }

  if (dates.length === 0) return { outcome: "unsure", reason: "Tarih bulunamadı", course: course ?? null };
  // Several dates are normal for a cancellation ("October 5 and October 6"),
  // not for an exam.
  if (dates.length > 1 && !SESSION_CHANGES.includes(classified)) notes.push("Birden fazla tarih var");
  if (vague) notes.push("Göreli gün ('next …') farklı okunabilir");

  // A weekday written next to the date must agree with it.
  if (!recurring && dateIndex !== -1 && dates.length === 1 && dates[0].start === dates[0].end) {
    const stated = weekdaysIn(all[dateIndex]);
    if (stated.length > 0 && !stated.includes(isoWeekday(dates[0].start))) notes.push("Gün adı tarihle uyuşmuyor");
  }

  const timeSource = dateIndex !== -1 && timesIn(all[dateIndex]).start ? all[dateIndex] : typeSentence;
  const time = timesIn(timeSource);

  if (HEDGE.test(typeSentence) || (dateIndex !== -1 && HEDGE.test(all[dateIndex]))) notes.push("Kesin olmayan ifade");
  if (course && !course.fromKey) notes.push("Ders kodu metinden okundu (Blackboard anahtarı yok)");
  if (course && course.section === null) notes.push("Section belli değil");

  const type = classified;
  let room: string | null = null;
  if (type === "room_change") {
    // The new room: in the sentence that said so, else where the date was, else anywhere.
    const original = [mail.subject, ...sentences(body)].map((s) => s.replace(BLACKBOARD_KEY, " "));
    room = roomIn(original[typeIndex]) ?? (dateIndex !== -1 ? roomIn(original[dateIndex]) : null) ?? roomIn(original.join("\n"));
    if (!room) return { outcome: "unsure", reason: "Yeni sınıf bulunamadı", course: course ?? null };
  }
  if (type === "exam" && ONLINE.test(typeSentence)) room = "Online";

  return {
    outcome: "event",
    course: course ?? null,
    allCourses,
    type,
    dates,
    weekdays,
    startTime: time.start,
    endTime: type === "exam" || type === "makeup" ? time.end : null,
    kind: type === "exam" ? null : kindOf(typeSentence),
    room,
    title: type === "exam" ? examTitle(typeSentence) : null,
    confident: notes.length === 0,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Step 2

export type MailEvents = {
  events: EventInput[];
  problem: string | null; // set when nothing could be placed
};

function* eachDay(range: DateRange, semester: Semester): Generator<string> {
  const first = range.start > semester.startDate ? range.start : semester.startDate;
  const last = range.end < semester.endDate ? range.end : semester.endDate;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    if (!semester.holidays.includes(d)) yield d;
  }
}

// meetings: every weekly slot of this course (all sections) this semester.
export function mailToEvents(parsed: ParsedMail, semester: Semester, meetings: Meeting[], subject: string): MailEvents {
  if (parsed.outcome !== "event") return { events: [], problem: parsed.reason };
  // course_events needs a course; school-wide notices go to /admin for now.
  if (parsed.allCourses || parsed.course === null) {
    return { events: [], problem: "Bütün dersleri etkileyen duyuru: elle girilmeli" };
  }

  const { course } = parsed;
  const base = {
    courseCode: course.courseCode,
    section: course.section,
    type: parsed.type,
    room: parsed.room,
    title: parsed.title,
    note: `Mailden otomatik: ${subject}`.slice(0, 500),
    status: parsed.confident ? ("confirmed" as const) : ("unconfirmed" as const),
  };

  if (!SESSION_CHANGES.includes(parsed.type)) {
    // Exam, make-up: an event of its own on each date.
    const events = parsed.dates
      .flatMap((r) => [...eachDay(r, semester)])
      .map((date) => ({ ...base, date, startTime: parsed.startTime, endTime: parsed.endTime }));
    return events.length > 0 ? { events, problem: null } : { events: [], problem: "Tarih dönem dışında" };
  }

  // Cancel / online / room change: find the real sessions it hits.
  const courseMeetings = meetings.filter(
    (m) => m.courseCode === course.courseCode && (course.section === null || m.section === course.section),
  );
  if (courseMeetings.length === 0) return { events: [], problem: "Bu dersin ders programında saati yok" };

  const events: EventInput[] = [];
  for (const range of parsed.dates) {
    for (const date of eachDay(range, semester)) {
      const weekday = isoWeekday(date);
      if (parsed.weekdays && !parsed.weekdays.includes(weekday)) continue;
      let hit = courseMeetings.filter((m) => m.weekday === weekday);
      if (parsed.kind) {
        hit = hit.filter(
          (m) => meetingKind(m, courseMeetings.filter((o) => o.section === m.section)) === parsed.kind,
        );
      }
      if (parsed.startTime) hit = hit.filter((m) => toHHMM(m.startTime) === parsed.startTime);
      if (hit.length === 0) continue;

      if (!parsed.kind && !parsed.startTime) {
        // Not said which one: every session of the course that day.
        events.push({ ...base, date, startTime: null, endTime: null });
      } else {
        for (const startTime of new Set(hit.map((m) => toHHMM(m.startTime)))) {
          events.push({ ...base, date, startTime, endTime: null });
        }
      }
    }
  }
  if (events.length === 0) return { events: [], problem: "Mailin söylediği gün/saatte bu dersin oturumu yok" };
  // "October 5 and 6" plus "the week of October 5" name the same day twice.
  const unique = events.filter(
    (e, i) => events.findIndex((o) => o.date === e.date && o.startTime === e.startTime) === i,
  );
  return { events: unique, problem: null };
}
