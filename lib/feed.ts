// Turns a student's sections and meetings into the .ics text. Pure: the
// route handler loads the data, this decides what the calendar shows.

import { displayCourseCode } from "./course-code";
import { buildCalendar, type IcsEvent } from "./ics";
import { expandSessions, type Meeting, type Semester, type Session } from "./schedule";

export const CALENDAR_NAME = "MEF Ders Takvimi";

export type SectionInfo = {
  courseCode: string;
  section: string;
  courseName: string | null;
  instructor: string | null;
};

export type FeedInput = {
  semester: Semester;
  meetings: Meeting[];
  sections: SectionInfo[];
  now: Date;
};

const sectionKey = (courseCode: string, section: string) => `${courseCode}-${section}`;

function describe(session: Session, info: SectionInfo | undefined): string {
  const lines = [];
  if (info?.courseName) lines.push(info.courseName);
  lines.push(`Şube: ${session.section}`);
  if (info?.instructor) lines.push(`Öğretim üyesi: ${info.instructor}`);
  return lines.join("\n");
}

export function buildFeed({ semester, meetings, sections, now }: FeedInput): string {
  const infoByKey = new Map(sections.map((s) => [sectionKey(s.courseCode, s.section), s]));

  const events: IcsEvent[] = expandSessions(semester, meetings).map((session) => ({
    uid: session.uid,
    start: session.start,
    end: session.end,
    summary: displayCourseCode(session.courseCode),
    location: session.room,
    description: describe(session, infoByKey.get(sectionKey(session.courseCode, session.section))),
  }));

  return buildCalendar({ name: CALENDAR_NAME, events, now });
}
