import { describe, expect, it } from "vitest";
import { cleanBody, fold, mailToEvents, parseMail, type MailInput, type ParsedMail } from "./mail-parse";
import type { Meeting, Semester } from "./schedule";

// Real MEF mails from 2026-10/11, copied from the owner's inbox. Instructor
// and student names are replaced; layout, wording and dates are as received.
// Times are when Gmail showed them (Istanbul), written as UTC instants.

const FOOTER = `View Announcement
Any multimedia items must be viewed online
Email brought to you by
Blackboard
Want to change how you receive these emails? *
Manage your notification settings`;

const econMidterm: MailInput = {
  subject: "INSTRUCTOR sent you a new message in Economics for Engineering",
  sentAt: new Date("2026-11-09T18:17:00Z"), // Mon 9 Nov, 21:17
  body: `2026-2027-01-ECON114-01
Economics for Engineering
New message from INSTRUCTOR

Dear Students,

The online midterm will take place on Wednesday, 11 November 2026 at 09:00 on the McGraw-Hill Connect system.

You will need to join Microsoft Teams on your smartphone. The camera position should be as explained in the previous lecture.

Best,

INSTRUCTOR

View Message
${FOOTER}`,
};

const comp201NoLabs: MailInput = {
  subject: "Data Structures and Algorithms: No Labs This Week – Self-Study Exercise and Preparation for Next Week's Lab",
  sentAt: new Date("2026-11-08T17:37:00Z"), // Sun 8 Nov, 20:37
  body: `2026-2027-01-COMP201-01
Data Structures and Algorithms
New announcement from TEACHING ASSISTANT

No Labs This Week – Self-Study Exercise and Preparation for Next Week's Lab

Dear COMP 201 Students,

There will be no lab sessions this week (November 9–10). Lab sessions will resume the following week.

I have uploaded a self-study exercise to the Labs folder on Blackboard for you to work on this week.

You can also find the lab materials for the next week (Lab 6) in the same folder. I encourage you to review these materials in advance to help you prepare for the next lab.

Best,

Teaching Assistant
${FOOTER}`,
};

const comp205Online: MailInput = {
  subject: "Systems Programming: Lecture 7 is online on 6th Nov Friday at 10:00.",
  sentAt: new Date("2026-11-05T12:00:00Z"),
  body: `2026-2027-01-COMP205-01
Systems Programming
New announcement from INSTRUCTOR

Lecture 7 is online on 6th Nov Friday at 10:00.

Dear All,

Due to the health issues Lecture 7 and quiz will be online on MS Teams.
${FOOTER}`,
};

const math211Cancelled: MailInput = {
  subject: "Linear Algebra: The online Lecture 7 is cancelled",
  sentAt: new Date("2026-11-04T14:00:00Z"), // Wed 4 Nov
  body: `2026-2027-01-MATH211-03
Linear Algebra
New announcement from INSTRUCTOR

The online Lecture 7 is cancelled

Dear Students of MATH 211 (Thursday session),. Due to rain and bad traffic conditions, our online lecture tonight is cancelled.
${FOOTER}`,
};

const everyoneOnline: MailInput = {
  subject:
    "[EVERYONE] 16 Ekim Cuma (Yarın) Derslerin Online Olması Hk. / Classes Online Tomorrow, Friday, 16 October",
  sentAt: new Date("2026-10-15T12:00:00Z"),
  body: "Due to adverse weather conditions in İstanbul and forecasts of continued rainfall, all classes tomorrow, Friday, 16 October will also be online.",
};

const econPostponed: MailInput = {
  subject: "INSTRUCTOR sent you a new message in Economics for Engineering",
  sentAt: new Date("2026-10-26T09:00:00Z"),
  body: `2026-2027-01-ECON114-01
Economics for Engineering

Dear Students,

As the university has announced a public holiday on 28 October 2026, the online midterm has been postponed. It will be held on an alternative date.
${FOOTER}`,
};

const comp205RoomChange: MailInput = {
  subject: "Systems Programming: COMP 205 – Wednesday Lab Room Change",
  sentAt: new Date("2026-11-09T10:00:00Z"), // Mon 9 Nov
  body: `2026-2027-01-COMP205-01
Systems Programming
New announcement from INSTRUCTOR

COMP 205 – Wednesday Lab Room Change

Dear Students,

Starting this week, COMP 205 Wednesday laboratory sessions will be held in A415 instead of A303.

Please make sure to attend your lab sessions in A415 from now on.

Best regards,

INSTRUCTOR
${FOOTER}`,
};

const comp205LabTomorrow: MailInput = {
  subject: "Systems Programming: Lab Tomorrow",
  sentAt: new Date("2026-09-22T10:00:00Z"), // Tue 22 Sep
  body: `2026-2027-01-COMP205-01
Systems Programming
New announcement from INSTRUCTOR

Lab Tomorrow

Hi everyone,

We will have our first lab tomorrow. Starting from this week, labs will be held every week unless announced otherwise in advance. If there is no lab on a particular week, you will be informed beforehand.

Attendance is mandatory, and there will be no make-up labs. You are also required to attend the lab in your assigned section. Please make sure to attend your scheduled lab session regularly.

See you tomorrow, and good luck!
${FOOTER}`,
};

const ee203Prelab: MailInput = {
  subject: "Digital Systems Design: Pre-lab due date for Lab 3-4",
  sentAt: new Date("2026-11-03T10:00:00Z"),
  body: `2026-2027-01-EE203-01
Digital Systems Design
New announcement from INSTRUCTOR

Pre-lab due date for Lab 3-4

Dear All,

Please note that the deadline for the Lab 3–4 pre-lab has been corrected.

The due date is Wednesday at 2:59 PM.
${FOOTER}`,
};

const comp201NoLabsOctober: MailInput = {
  subject: "Data Structures and Algorithms: No Lab Sessions Next Week (October 5 and October 6)",
  sentAt: new Date("2026-10-01T10:00:00Z"), // Thu 1 Oct
  body: `2026-2027-01-COMP201-01
Data Structures and Algorithms
New announcement from TEACHING ASSISTANT

No Lab Sessions Next Week (October 5 and October 6)

Dear COMP 201 Students.

As the next lecture will focus on a theoretical topic, there will be no lab sessions in the week of October 5.

Lab sessions will resume in the following week as usual.

Teaching Assistant
${FOOTER}`,
};

const comp201AboutLabs: MailInput = {
  subject: "Data Structures and Algorithms: About the Labs",
  sentAt: new Date("2026-09-11T10:00:00Z"), // Fri 11 Sep, before term
  body: `2026-2027-01-COMP201-01
Data Structures and Algorithms
New announcement from TEACHING ASSISTANT

About the Labs

Dear COMP 201 students.

There will be no lab sessions during the first week (the week of September 14). Lab sessions will begin next week.

You can find information about the labs in the Labs folder on Blackboard. I have also uploaded some self-study exercises on Java fundamentals under Lab 0.

I wish you success in the upcoming semester.
${FOOTER}`,
};

const econOnlineLecture: MailInput = {
  subject: "INSTRUCTOR sent you a new message in Economics for Engineering",
  sentAt: new Date("2026-09-15T10:00:00Z"), // Tue 15 Sep
  body: `2026-2027-01-ECON114-01
Economics for Engineering
New message from INSTRUCTOR

Dear Students,

Tomorrow, 16/9/2026 Lecture will be online via Microsoft Teams. this is the link:

Microsoft Teams Online Lecture Link

Best Regards,

INSTRUCTOR

View Message
${FOOTER}`,
};

const semester: Semester = {
  startDate: "2026-09-14",
  endDate: "2026-12-11",
  holidays: ["2026-10-28", "2026-10-29", "2026-10-30"],
};

const meetings: Meeting[] = [
  // COMP 201-1: Monday lecture + Monday lab (the real catalog slots).
  { courseCode: "COMP201", section: "1", weekday: 1, startTime: "09:00:00", endTime: "11:50:00", room: "A101" },
  { courseCode: "COMP201", section: "1", weekday: 1, startTime: "13:00:00", endTime: "14:50:00", room: "B201" },
  // COMP 205-1: Friday lecture, Wednesday lab (shorter → "lab").
  { courseCode: "COMP205", section: "1", weekday: 5, startTime: "10:00:00", endTime: "12:50:00", room: "A202" },
  { courseCode: "COMP205", section: "1", weekday: 3, startTime: "13:00:00", endTime: "14:50:00", room: "A303" },
  { courseCode: "ECON114", section: "1", weekday: 3, startTime: "09:00:00", endTime: "11:50:00", room: "Online" },
  { courseCode: "MATH211", section: "3", weekday: 4, startTime: "18:00:00", endTime: "19:50:00", room: "Online" },
];

function event(p: ParsedMail) {
  if (p.outcome !== "event") throw new Error(`expected an event, got ${p.outcome}: ${p.reason}`);
  return p;
}

describe("fold", () => {
  it("lowercases Turkish and English the same way", () => {
    expect(fold("ÇARŞAMBA İptal Iğdır")).toBe("carsamba iptal igdir");
  });
});

describe("cleanBody", () => {
  it("cuts the Blackboard footer, whose 'viewed online' isn't an online notice", () => {
    expect(cleanBody(comp201NoLabs.body)).not.toMatch(/viewed online|Blackboard\n/);
    expect(cleanBody(comp201NoLabs.body)).toContain("November 9–10");
  });
});

describe("parseMail — real mails", () => {
  it("ECON 114: online midterm with date, weekday and time", () => {
    const p = event(parseMail(econMidterm));
    expect(p.course).toEqual({ courseCode: "ECON114", section: "1", fromKey: true });
    expect(p.type).toBe("exam");
    expect(p.title).toBe("Vize");
    expect(p.room).toBe("Online");
    expect(p.dates).toEqual([{ start: "2026-11-11", end: "2026-11-11" }]);
    expect(p.startTime).toBe("09:00");
    expect(p.confident).toBe(true);
  });

  it("COMP 201: 'no labs this week (November 9–10)' → lab cancellation over a range", () => {
    const p = event(parseMail(comp201NoLabs));
    expect(p.course).toEqual({ courseCode: "COMP201", section: "1", fromKey: true });
    expect(p.type).toBe("cancel");
    expect(p.kind).toBe("lab");
    expect(p.dates).toEqual([{ start: "2026-11-09", end: "2026-11-10" }]);
    expect(p.confident).toBe(true);
  });

  it("COMP 205: lecture online, type and time from the subject", () => {
    const p = event(parseMail(comp205Online));
    expect(p.type).toBe("online"); // not "exam", although the body mentions a quiz
    expect(p.kind).toBe("lecture");
    expect(p.dates).toEqual([{ start: "2026-11-06", end: "2026-11-06" }]);
    expect(p.startTime).toBe("10:00");
    expect(p.confident).toBe(true);
  });

  it("MATH 211: 'online lecture tonight is cancelled' → cancel, today", () => {
    const p = event(parseMail(math211Cancelled));
    expect(p.course?.section).toBe("3");
    expect(p.type).toBe("cancel");
    expect(p.dates).toEqual([{ start: "2026-11-04", end: "2026-11-04" }]);
  });

  it("[EVERYONE] classes online tomorrow → all courses, Turkish and English date agree", () => {
    const p = event(parseMail(everyoneOnline));
    expect(p.allCourses).toBe(true);
    expect(p.course).toBeNull();
    expect(p.type).toBe("online");
    expect(p.dates).toEqual([{ start: "2026-10-16", end: "2026-10-16" }]);
  });

  it("'Lab Tomorrow': an 'if there is no lab…' rule and 'no make-up labs' are not events", () => {
    expect(parseMail(comp205LabTomorrow)).toMatchObject({ outcome: "ignored" });
  });

  it("a pre-lab deadline is not a class event", () => {
    expect(parseMail(ee203Prelab)).toMatchObject({ outcome: "ignored" });
  });

  it("postponed midterm → unsure, no event", () => {
    const p = parseMail(econPostponed);
    expect(p.outcome).toBe("unsure");
  });

  it.each([
    ["Submission received", "2026-2027-01-COMP201-01 Assignment submitted Lab 5"],
    ["Daily Notifications", "Your updates Assessments In-class: Array-based representation of a binary tree"],
    ["Data Structures and Algorithms: First Midterm Results", "The first midterm exam scores are now available."],
    ["Linear Algebra: Midterm Exam 1 Paper Review", "You can see your MT papers next week on 09/11 Monday."],
    [
      "Data Structures and Algorithms: Current Lecture Attendance Record",
      "So far, we have conducted eight lecture sessions, one of which was held online.",
    ],
  ])("ignores notification-like mail: %s", (subject, body) => {
    expect(parseMail({ subject, body, sentAt: new Date("2026-11-07T10:00:00Z") }).outcome).toBe("ignored");
  });
});

describe("parseMail — dates and wording", () => {
  const at = (iso: string, subject: string, body = "") => parseMail({ subject, body, sentAt: new Date(iso) });

  it("Turkish 'yarınki … yapılmayacaktır', course code from the text", () => {
    // Sunday 15 Nov → tomorrow is Monday 16 Nov.
    const p = event(at("2026-11-15T10:00:00Z", "Duyuru", "Sayın öğrenciler, yarınki COMP 201 dersi yapılmayacaktır."));
    expect(p.course).toEqual({ courseCode: "COMP201", section: null, fromKey: false });
    expect(p.type).toBe("cancel");
    expect(p.kind).toBe("lecture");
    expect(p.dates).toEqual([{ start: "2026-11-16", end: "2026-11-16" }]);
    expect(p.confident).toBe(false); // no Blackboard key, no section
  });

  it("'bu Çarşamba' = the coming Wednesday", () => {
    // Monday 9 Nov → Wednesday 11 Nov.
    const p = event(at("2026-11-09T08:00:00Z", "2026-2027-01-COMP205-01", "Bu Çarşamba laboratuvar iptal."));
    expect(p.kind).toBe("lab");
    expect(p.dates).toEqual([{ start: "2026-11-11", end: "2026-11-11" }]);
  });

  it("a weekday naming a group ('Perşembe grubu') is not a date", () => {
    // Wednesday 4 Nov: "bu akşam" = today, not Thursday 5 Nov.
    const p = event(
      at("2026-11-04T10:00:00Z", "2026-2027-01-MATH211-03 Duyuru", "Perşembe grubu öğrencileri, bu akşamki online ders iptal."),
    );
    expect(p.dates).toEqual([{ start: "2026-11-04", end: "2026-11-04" }]);
  });

  it("drops past dates mentioned as context", () => {
    const p = event(
      at(
        "2026-11-02T10:00:00Z",
        "2026-2027-01-MATH211-03 Linear Algebra: Online lecture 7 on Wednesday night, Nov. 4th.",
        "Since we had no lecture on October 29th, we will meet online.",
      ),
    );
    expect(p.type).toBe("online");
    expect(p.dates).toEqual([{ start: "2026-11-04", end: "2026-11-04" }]);
  });

  it("a weekday that contradicts the date makes it unconfirmed", () => {
    // 11 November 2026 is a Wednesday, not a Thursday.
    const p = event(at("2026-11-09T08:00:00Z", "2026-2027-01-COMP205-01", "The lecture on Thursday, 11 November is cancelled."));
    expect(p.confident).toBe(false);
    expect(p.notes).toContain("Gün adı tarihle uyuşmuyor");
  });

  it("guesses the year: '5 January' in a December mail is next year", () => {
    const p = event(at("2026-12-20T08:00:00Z", "2026-2027-01-COMP205-01", "The final exam is on 5 January."));
    expect(p.dates).toEqual([{ start: "2027-01-05", end: "2027-01-05" }]);
  });

  it("room change needs the new room", () => {
    const p = event(at("2026-11-09T08:00:00Z", "2026-2027-01-COMP205-01 Room change", "On 13 November the lecture will be held in B-315."));
    expect(p.type).toBe("room_change");
    expect(p.room).toBe("B315");
  });

  it("no date → unsure", () => {
    expect(at("2026-11-09T08:00:00Z", "2026-2027-01-COMP205-01", "The lab is cancelled.").outcome).toBe("unsure");
  });

  it("two course codes → unsure", () => {
    expect(at("2026-11-09T08:00:00Z", "Duyuru", "COMP 201 ve COMP 205 dersleri yarın iptal.").outcome).toBe("unsure");
  });
});

// Found by running the parser over 400 inbox mails (2026-11-10). Each was
// read wrongly before the fix next to it.
describe("parseMail — inbox sweep", () => {
  const mail = (iso: string, subject: string, body: string) => parseMail({ subject, body, sentAt: new Date(iso) });

  it("'decided not to hold the sessions online' is not an online notice", () => {
    const p = mail(
      "2026-10-15T08:00:00Z",
      "Digital Systems Design: Update on Lab Sections 3.1 & 4.1",
      `2026-2027-01-EE203-01
Regarding today's lab sessions: given the hands-on nature of the labs, and because we care about all sections working under the same conditions, we have decided not to hold the sessions online.`,
    );
    expect(p.outcome).not.toBe("event");
  });

  it("Turkish 'online olmayacaktır' is not a cancellation", () => {
    const p = mail("2026-11-09T08:00:00Z", "2026-2027-01-COMP205-01 Duyuru", "Yarınki ders online olmayacaktır, sınıfta işlenecektir.");
    expect(p.outcome).not.toBe("event");
  });

  it("a poll's options are not decisions", () => {
    const p = mail(
      "2026-10-20T08:00:00Z",
      "Systems Programming: Lab Schedule This Week (Quick Poll)",
      `2026-2027-01-COMP205-01
So for this week's labs, I have two options for you:
Option 1: Hold the Wednesday and Friday lab sessions online.
Option 2: Cancel this week's labs and start directly on campus week after.`,
    );
    expect(p.outcome).not.toBe("event");
  });

  it("PHYS 104L: cancelled days and make-up days in one mail → only the cancelled ones", () => {
    const p = event(
      mail(
        "2026-03-12T08:00:00Z",
        "Physics II Lab: Dersler Hk.",
        `2025-2026-02-PHYS104L-01
Merhaba, 17 Mart ( Salı) , 19 Mart (Perşembe) ve 20 Mart (Cuma ) günlerindeki dersler Ramazan Bayramı dolayısıyla yapılmayacaktır. 24 Mart (Salı ), 26 Mart (Perşembe ) ve 27 Mart (Cuma) günleri telafi dersleri yapılacaktır.`,
      ),
    );
    expect(p.type).toBe("cancel");
    expect(p.dates.map((r) => r.start)).toEqual(["2026-03-17", "2026-03-19", "2026-03-20"]);
  });

  it("'Lecture 6 and quiz will be online on MS Teams' moves the lecture, it's not an exam", () => {
    const p = event(
      mail(
        "2026-10-22T08:00:00Z",
        "Systems Programming: Lecture 6 on 23rd October Friday, on teams",
        "2026-2027-01-COMP205-01\nDue to the health issues Lecture 6 and quiz will be online on MS Teams.",
      ),
    );
    expect(p.type).toBe("online");
    expect(p.kind).toBe("lecture");
    expect(p.dates).toEqual([{ start: "2026-10-23", end: "2026-10-23" }]);
  });

  it("'TÜBİTAK 2209' is not a course code, '[EVERYONE] … Online Açılış Töreni' is not school-wide", () => {
    expect(
      mail("2026-10-19T08:00:00Z", "[STUDENTS] TÜBİTAK 2209-A ve 2209-B 2026 Çağrıları", "Toplantı 21 Ekim'de online yapılacaktır."),
    ).toMatchObject({ outcome: "unsure", course: null });
    expect(
      mail("2026-09-10T08:00:00Z", "[EVERYONE] 2026-2027 Akademik Yılı Online Açılış Töreni Davetiyesi", "Tören 12 Eylül'de online yapılacaktır."),
    ).toMatchObject({ outcome: "unsure", course: null });
  });

  it("score / objection mails are ignored", () => {
    expect(mail("2026-06-04T08:00:00Z", "Calculus II: Final Exam Scores and Objection Times", "Objection on 9 June at 15:00.").outcome).toBe("ignored");
  });

  it("an exam needs one day in its own sentence", () => {
    // "Video quizzes" for a whole week: homework, not an exam event.
    expect(mail("2026-09-26T08:00:00Z", "2026-2027-01-MATH211-01 Video Quizzes", "Please solve the video quizzes next week.").outcome).toBe("unsure");
    // Practice problems mentioning the midterm, and a weekday elsewhere.
    expect(
      mail(
        "2026-10-07T08:00:00Z",
        "Linear Algebra: Practice problems from the book",
        "2026-2027-01-MATH211-01\nAs I mentioned during the lecture on Monday, here is a list of practice problems.\nThey will help you prepare for the midterm.",
      ).outcome,
    ).toBe("unsure");
  });

  it("12-hour times: 'today at 2:00 PM' → 14:00", () => {
    const p = event(
      mail(
        "2026-02-21T07:00:00Z",
        "Physics II Lab: Safety makeup reminder",
        "2025-2026-02-PHYS104L-01\nThe makeup exam for students who were unable to attend will be held today at 2:00 PM.",
      ),
    );
    expect(p.startTime).toBe("14:00");
  });

  it("'from 14:00 to 14:40' is a time range", () => {
    const p = event(
      mail("2026-02-13T08:00:00Z", "2025-2026-02-PHYS104-01 Exams Schedule", "Online Test 1: Saturday, February 28th, from 14:00 to 14:40. In-class exam at 10 am."),
    );
    expect(p).toMatchObject({ startTime: "14:00", endTime: "14:40" });
  });

  it("a Saturday mail about 'next week' means the coming Monday's week", () => {
    // Sat 10 Oct 2026 → week of Mon 12 Oct.
    const p = event(
      mail("2026-10-10T08:00:00Z", "Data Structures and Algorithms: Preparing for Next Week's Online Lecture", "2026-2027-01-COMP201-01\nNext week's lecture will be online."),
    );
    expect(p.dates).toEqual([{ start: "2026-10-12", end: "2026-10-18" }]);
  });

  it("'Classroom update' + 'Today's lab will take place in A415' → lab room change", () => {
    const p = event(
      mail("2026-11-04T08:00:00Z", "Systems Programming: Classroom update", "2026-2027-01-COMP205-01\nToday's lab will take place in A415."),
    );
    expect(p).toMatchObject({ type: "room_change", kind: "lab", room: "A415", dates: [{ start: "2026-11-04", end: "2026-11-04" }] });
  });
});

// From the held-out measurement (126 mails the parser had not seen,
// 2026-11-10). Each case was read wrongly by the version measured there.
describe("parseMail — held-out set fixes", () => {
  const mail = (iso: string, subject: string, body: string) => parseMail({ subject, body, sentAt: new Date(iso) });

  it("'Extra online lecture on November 27 at 18:00' is an extra session, not an existing lecture going online", () => {
    const p = event(
      mail(
        "2025-11-26T09:00:00Z",
        "2025-2026-01-MATH101-01 Calculus I: Extra online lecture on November 27, Thursday",
        "There will be an extra online lecture on November 27, Thursday at 18:00. The link will be shared prior to the lecture.",
      ),
    );
    expect(p).toMatchObject({ type: "makeup", title: "Ek ders", startTime: "18:00", dates: [{ start: "2025-11-27", end: "2025-11-27" }] });
  });

  it("'Topics included in the midterm exam' mails are not exam dates", () => {
    // The date is when topics were covered, in the same sentence as "exam".
    const p = mail(
      "2025-11-06T09:00:00Z",
      "Calculus I: Topics included in the midterm exam-1",
      "2025-2026-01-MATH101-01\nThe topics included in the first midterm exam are all the topics covered, excluding the ones that are to be covered on Friday, November 7.",
    );
    expect(p.outcome).toBe("ignored");
  });

  it("an exam named in the subject needs its date from a sentence about the exam", () => {
    const p = mail(
      "2025-11-06T09:00:00Z",
      "2025-2026-01-MATH101-01 Calculus I: Midterm exam-1",
      "Please review the material.\nThe lecture notes from November 7 are on Blackboard.",
    );
    expect(p.outcome).toBe("unsure");
  });

  it("'Midterm I will be on 04.11.25 between 18:00-20:00' (two-digit year)", () => {
    const p = event(mail("2025-10-27T09:00:00Z", "2025-2026-01-COMP100-01 midterm I", "Midterm I will be on 04.11.25 between 18:00-20:00 @A101,A116"));
    expect(p).toMatchObject({ type: "exam", startTime: "18:00", endTime: "20:00", dates: [{ start: "2025-11-04", end: "2025-11-04" }] });
  });

  it("'postponed to be held on the 9th of November, Sunday, 18:00' → exam on the new date", () => {
    const p = event(
      mail("2025-10-20T09:00:00Z", "2025-2026-01-MATH101-01 Calculus I: 1st Midterm Exam is postponed", "The first midterm exam is postponed to be held on the 9th of November, Sunday, 18:00."),
    );
    expect(p).toMatchObject({ type: "exam", startTime: "18:00", dates: [{ start: "2025-11-09", end: "2025-11-09" }] });
  });

  it("a postponement without a new date stays unsure", () => {
    expect(
      mail("2026-10-26T09:00:00Z", "2026-2027-01-ECON114-01", "As the university has announced a public holiday on 28 October 2026, the online midterm has been postponed.").outcome,
    ).toBe("unsure");
  });
});

describe("mailToEvents", () => {
  const run = (mail: MailInput) => mailToEvents(parseMail(mail), semester, meetings, mail.subject);

  it("COMP 201 'no labs 9–10 Nov' cancels only the Monday lab, not the lecture", () => {
    const { events, problem } = run(comp201NoLabs);
    expect(problem).toBeNull();
    expect(events).toEqual([
      expect.objectContaining({
        courseCode: "COMP201",
        section: "1",
        type: "cancel",
        date: "2026-11-09",
        startTime: "13:00",
        status: "confirmed",
      }),
    ]);
  });

  it("COMP 205 online lecture hits the Friday 10:00 session", () => {
    const { events } = run(comp205Online);
    expect(events).toEqual([expect.objectContaining({ type: "online", date: "2026-11-06", startTime: "10:00" })]);
  });

  it("ECON 114 midterm becomes its own exam event", () => {
    const { events } = run(econMidterm);
    expect(events).toEqual([
      expect.objectContaining({
        courseCode: "ECON114",
        section: "1",
        type: "exam",
        date: "2026-11-11",
        startTime: "09:00",
        room: "Online",
        title: "Vize",
        status: "confirmed",
      }),
    ]);
    expect(events[0].note).toMatch(/^Mailden otomatik: /);
  });

  it("an extra session that isn't in the schedule → problem, no event", () => {
    // MATH 211-3 meets on Thursdays; the cancelled online lecture was a Wednesday extra.
    const { events, problem } = run(math211Cancelled);
    expect(events).toEqual([]);
    expect(problem).toMatch(/oturumu yok/);
  });

  it("COMP 205 permanent room change: every Wednesday lab from now to the end of term, new room not old", () => {
    const p = event(parseMail(comp205RoomChange));
    expect(p.type).toBe("room_change");
    expect(p.room).toBe("A415"); // "held in A415 instead of A303"
    expect(p.kind).toBe("lab");
    expect(p.weekdays).toEqual([3]);

    const { events } = run(comp205RoomChange);
    expect(events.map((e) => e.date)).toEqual(["2026-11-11", "2026-11-18", "2026-11-25", "2026-12-02", "2026-12-09"]);
    expect(events.every((e) => e.startTime === "13:00" && e.room === "A415" && e.status === "confirmed")).toBe(true);
  });

  it("COMP 201 'no lab sessions … October 5 and October 6 … week of October 5' → one Monday lab, once", () => {
    const { events, problem } = run(comp201NoLabsOctober);
    expect(problem).toBeNull();
    expect(events).toEqual([
      expect.objectContaining({ type: "cancel", date: "2026-10-05", startTime: "13:00", status: "confirmed" }),
    ]);
  });

  it("COMP 201 'no lab sessions during the first week (the week of September 14)'", () => {
    const { events } = run(comp201AboutLabs);
    expect(events).toEqual([expect.objectContaining({ type: "cancel", date: "2026-09-14", startTime: "13:00" })]);
  });

  it("ECON 114 'Tomorrow, 16/9/2026 Lecture will be online'", () => {
    const { events } = run(econOnlineLecture);
    expect(events).toEqual([expect.objectContaining({ type: "online", date: "2026-09-16", startTime: "09:00" })]);
  });

  it("school-wide notices are left for /admin", () => {
    expect(run(everyoneOnline).problem).toMatch(/Bütün dersleri/);
  });

  it("an uncertain parse becomes unconfirmed (❓)", () => {
    const mail = { subject: "Duyuru", body: "Yarınki COMP 201 dersi yapılmayacaktır.", sentAt: new Date("2026-11-15T10:00:00Z") };
    const { events } = run(mail);
    expect(events).toEqual([
      expect.objectContaining({ section: null, date: "2026-11-16", startTime: "09:00", status: "unconfirmed" }),
    ]);
  });
});
