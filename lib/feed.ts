// Turns a student's sections, meetings and course events into the .ics
// text. Pure: the route handler loads the data, this decides what the
// calendar shows. Rules: CLAUDE.md → Calendar (.ics) rules.

import { displayCourseCode } from "./course-code";
import { buildCalendar, type IcsEvent } from "./ics";
import {
  expandSessions,
  istanbulToInstant,
  toHHMM,
  type Meeting,
  type Semester,
  type Session,
} from "./schedule";

export const CALENDAR_NAME = "MEF Ders Takvimi";

export type SectionInfo = {
  courseCode: string;
  section: string;
  courseName: string | null;
  instructor: string | null;
};

// A row of course_events that applies to this student (the query already
// filtered by the student's courses and sections).
export type FeedEvent = {
  id: number;
  courseCode: string;
  section: string | null; // null = every section of the course
  type: "cancel" | "online" | "room_change" | "makeup" | "exam" | "other";
  date: string; // YYYY-MM-DD
  startTime: string | null; // session changes: picks the session; null = all that day
  endTime: string | null;
  room: string | null;
  title: string | null;
  note: string | null;
  status: "confirmed" | "unconfirmed";
};

export type FeedInput = {
  semester: Semester;
  meetings: Meeting[];
  sections: SectionInfo[];
  events?: FeedEvent[];
  now: Date;
};

const sectionKey = (courseCode: string, section: string) => `${courseCode}-${section}`;

const SESSION_CHANGES = new Set<FeedEvent["type"]>(["cancel", "online", "room_change"]);

// Does this session-changing event target this class session?
function targets(event: FeedEvent, session: Session): boolean {
  return (
    event.courseCode === session.courseCode &&
    (event.section === null || event.section === session.section) &&
    event.date === session.date &&
    (event.startTime === null || toHHMM(event.startTime) === session.startTime)
  );
}

function sectionLines(section: string | null, info: SectionInfo | undefined): string[] {
  const lines = [];
  if (info?.courseName) lines.push(info.courseName);
  lines.push(section ? `Section: ${section}` : "Tüm section'lar");
  if (info?.instructor) lines.push(`Öğretim üyesi: ${info.instructor}`);
  return lines;
}

function sessionEvent(session: Session, info: SectionInfo | undefined, changes: FeedEvent[]): IcsEvent {
  const name = displayCourseCode(session.courseCode) + (session.kind === "lab" ? " Lab" : "");
  // Icons the owner asked for: 💻 online (always-online courses like
  // ECON 114, room "Online", and sessions moved online), 🧪 lab.
  const icon = (online: boolean) => (online ? "💻 " : session.kind === "lab" ? "🧪 " : "");
  const usuallyOnline = /^online$/i.test(session.room ?? "");
  let summary = `${icon(usuallyOnline)}${name}`;
  let location = session.room;
  let status: IcsEvent["status"];
  const notes: string[] = [];
  const has = (type: FeedEvent["type"]) => changes.filter((e) => e.type === type);

  // Applied in order of strength: a cancellation outranks everything else.
  for (const e of has("room_change")) {
    if (e.status === "confirmed" && e.room) {
      notes.push(`Sınıf değişti: ${session.room ?? "?"} → ${e.room}`);
      location = e.room;
    } else {
      notes.push(`Sınıf değişmiş olabilir${e.room ? `: ${e.room}` : ""} (kesin değil)`);
    }
  }
  for (const e of has("online")) {
    if (e.status === "confirmed") {
      summary = `${icon(true)}${name} (Online)`;
      location = "Online";
      notes.push("Bu ders online yapılacak.");
    } else {
      summary = `❓ ${icon(usuallyOnline)}${name} (Muhtemelen online)`;
      notes.push("Bu ders online olabilir (kesin değil).");
    }
  }
  const cancels = has("cancel");
  if (cancels.some((e) => e.status === "confirmed")) {
    summary = `❌ İPTAL – ${icon(usuallyOnline)}${name}`;
    status = "CANCELLED";
    notes.push("Bu ders iptal.");
  } else if (cancels.length > 0) {
    summary = `❓ Muhtemelen iptal – ${icon(usuallyOnline)}${name}`;
    notes.push("Bu ders iptal olabilir (kesin değil).");
  }
  for (const e of changes) if (e.note) notes.push(e.note);

  return {
    uid: session.uid,
    start: session.start,
    end: session.end,
    summary,
    location,
    description: [...notes, ...(notes.length > 0 ? [""] : []), ...sectionLines(session.section, info)].join(
      "\n",
    ),
    ...(status ? { status } : {}),
  };
}

const STANDALONE_TITLE: Record<"makeup" | "exam" | "other", (code: string, title: string | null) => string> = {
  exam: (code, title) => `📝 ${code} ${title ?? "Sınav"}`,
  makeup: (code, title) => `🔁 ${code} Telafi${title ? ` – ${title}` : ""}`,
  other: (code, title) => `ℹ️ ${code} – ${title ?? "Duyuru"}`,
};

const HOUR_MS = 60 * 60 * 1000;

// Exams, make-up classes and other announcements are events of their own.
// Their UID comes from the event row, so editing the date or time later
// updates the same calendar entry instead of adding a second one.
function standaloneEvent(e: FeedEvent, info: SectionInfo | undefined): IcsEvent {
  const type = e.type as "makeup" | "exam" | "other";
  const title = STANDALONE_TITLE[type](displayCourseCode(e.courseCode), e.title);
  const when = e.startTime
    ? {
        start: istanbulToInstant(e.date, e.startTime),
        // No end time given: show one hour rather than guessing.
        end: e.endTime
          ? istanbulToInstant(e.date, e.endTime)
          : new Date(istanbulToInstant(e.date, e.startTime).getTime() + HOUR_MS),
      }
    : { allDay: e.date };

  return {
    uid: `event-${e.id}@mef-calendar`,
    summary: e.status === "unconfirmed" ? `❓ ${title}` : title,
    location: e.room,
    description: [...(e.note ? [e.note, ""] : []), ...sectionLines(e.section, info)].join("\n"),
    ...when,
  };
}

export function buildFeed({ semester, meetings, sections, events = [], now }: FeedInput): string {
  const infoByKey = new Map(sections.map((s) => [sectionKey(s.courseCode, s.section), s]));
  // For "all sections" events: any of the student's sections of that course.
  const infoByCourse = new Map(sections.map((s) => [s.courseCode, s]));
  const changes = events.filter((e) => SESSION_CHANGES.has(e.type));

  const sessionEvents = expandSessions(semester, meetings).map((session) =>
    sessionEvent(
      session,
      infoByKey.get(sectionKey(session.courseCode, session.section)),
      changes.filter((e) => targets(e, session)),
    ),
  );

  const extraEvents = events
    .filter((e) => !SESSION_CHANGES.has(e.type))
    .map((e) =>
      standaloneEvent(
        e,
        e.section ? infoByKey.get(sectionKey(e.courseCode, e.section)) : infoByCourse.get(e.courseCode),
      ),
    );

  return buildCalendar({ name: CALENDAR_NAME, events: [...sessionEvents, ...extraEvents], now });
}
