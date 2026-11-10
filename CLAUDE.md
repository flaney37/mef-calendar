# mef-calendar

An automatic class calendar for MEF University students. A student uploads a screenshot of their SIS class schedule (read on their own device), gets a personal calendar subscription link (.ics), and subscribes to it in Apple / Google / Outlook Calendar. When class cancellations, exam dates or room changes are entered into the system (later: picked up automatically from emails), everyone's calendar updates on its own.

Goal: first a zero-cost MVP (my own class + friends), then offer it to the school as a free service. No SaaS / sales goal.

## Working with the owner

- Owner: 2nd-year Computer Engineering student at MEF University, Istanbul, learning as we go. **Talk to them in Turkish**; code, identifiers and commit messages in English; UI text in Turkish.
- Go phase by phase. Before a phase: a short plan. At the end: exact steps to test it themselves, incl. subscribing on iPhone/Mac. Explain non-obvious choices briefly — they want to understand the code, not just receive it.
- Tick the roadmap boxes here as items are done; add what we learn to the relevant section or "Open questions".
- When a fix fails, try up to 3 times, then stop and report the error.
- Zero cost: free tiers only (Vercel Hobby, Neon free). Never add a payment method anywhere.
- Never commit secrets. Ask before creating accounts or running anything that needs their credentials. Never put secrets (DB URL, admin password, feed/edit tokens) into chat; write them to `.env.local` directly or let the owner paste them.
- The production DB is the only DB: test with fake courses (`TEST999`, tokens `TESTfeedToken…`) and delete them afterwards, so friends' calendars never show test data.

## Context: MEF's systems

- **SIS** (sis.mef.edu.tr): no public API, server-rendered HTML behind a login. The student's schedule page (`/ogrenciler/belge/ogrdersprogrami`) has Excel/PDF export; the Excel export shifts day columns (ECON 114 on Wednesday lands under Thursday), but its course list (code, name, section, instructor, credits) is reliable. The top of that page shows TC Kimlik No, first and last name.
- Full catalog of every section: `/dersler/dersprogrami/tumprogram` (see "Course catalog"). An existing student project, mefcourseplanner.vercel.app, scraped it once into static JSON.
- Some courses have no fixed slot (HISTR 213, TURK 114): in the course list, not in the weekly grid or catalog.
- **Email** runs on Google Workspace (MX → Google), hence Google Apps Script for Phase 4.
- **Blackboard Learn Ultra** (mef.blackboard.com) gives each student a personal iCal feed with assignment due dates but no class times (instructors don't enter them). Phase 5 merges it optionally.
- Instructors won't use a new tool: cancellations must come from emails (Phase 4); `/admin` is the fallback.

## Status (update when it changes)

- Phases 0–3 done and accepted on a real iPhone/Mac (2026-11-10). Live at https://mef-calendar.vercel.app, repo `flaney37/mef-calendar`, pushes to `main` deploy automatically.
- **Next: Phase 4** (emails → events). Start with a short plan.
- Small leftovers: an orphaned student record of the owner's (they lost its edit link; harmless, delete on request); `.claude/launch.json` is local-only (absolute Mac path), not committed.
- New machine setup: Node 24 LTS, `corepack enable pnpm`, `pnpm install`. `.env.local` is not in git: the owner copies it over themselves (DATABASE_URL can also be copied from Vercel → Settings → Environment Variables; ADMIN_PASSWORD is in their notes). `data/` (catalog export, OCR samples) is gitignored too; only needed to re-import the catalog (`pnpm db:import-catalog`), the DB already has it.

---

## Core decisions (ask before changing)

- **No accounts.** A student is identified by a random, unguessable token (at least 128 bits, URL-safe). Calendar link: `/cal/<token>.ics`. A separate secret link for editing: `/edit/<editToken>`.
- **Schedule input = screenshot, read in the browser.** The student picks a screenshot of the "Ders Programı" (class schedule) page in SIS. OCR runs **on the student's device** and only the course codes + sections found in it are sent to the server. Section times come from the course catalog, so the image only needs to yield code + section.
- **Image reading = Tesseract.js in the browser** (decided 2026-11-10, replaces "Gemini free tier"). Reasons: the image never leaves the device (no TC Kimlik No can reach any server or Google), no API key, no quota, no cost. OCR mistakes are corrected against the catalog.
- **OCR output is always confirmed by the student.** Before saving, an editable "review" screen is shown.
- **Sharing key = course code + section** (`COMP 201` + `1` → `COMP201-1`). Events such as cancellations/exams are attached to a section (or to the whole course) and show up in the calendar of everyone who selected that section.
- **Never log into SIS automatically with anyone's credentials.** A scraper / course catalog may be added later, only as a manually run tool.

## Tech stack

- **Next.js** (App Router, TypeScript, strict) — on Vercel, free plan
- **Postgres** — Neon via the Vercel Marketplace (free plan), ORM: **Drizzle**
- **Tailwind CSS** — UI
- **Image reading:** `tesseract.js` (WebAssembly OCR, runs in a Web Worker in the browser)
- **Tests:** Vitest (especially for .ics generation and date calculations)
- Package manager: pnpm

Environment variables (`.env.local`, never commit):
```
DATABASE_URL=
GEMINI_API_KEY=          # only if Phase 4's mail parser needs an LLM fallback
ADMIN_PASSWORD=          # for the fallback panel in Phase 3
INGEST_SECRET=           # not needed: volunteer tokens are stored as plain SHA-256 hashes (192-bit random tokens)
```

## Data model (draft)

```
semesters      id, name ("2026-2027 Fall"), start_date, end_date, holidays (date[])
students       id, feed_token, edit_token, semester_id, created_at
               (NO name, email, student number or national ID)
enrollments    student_id, course_code, section
sections       semester_id, course_code, section, course_name, instructor
               (unique per section; shared; later students only fill empty fields)
meetings       semester_id, course_code, section, weekday (1-7), start_time, end_time, room
               (one record per weekly slot of a section; shared across students;
               unique on semester + course + section + weekday + start_time)
course_events  id, semester_id, course_code, section (null = all sections),
               type: cancel | makeup | room_change | exam | other | online,
               date, start_time, end_time, room, title, note,
               status: confirmed | unconfirmed, source: manual | mail, created_at
```

`meetings` is stored per section. **Catalog sections** (`sections.source = 'catalog'`, imported from SIS) are the source of truth: their meetings come only from the catalog and student input for them is ignored. **Other sections** (`source = 'student'`, e.g. a course missing from the catalog): the second student who enters the same section reuses the existing record; on a conflict, log it and keep the first one; a correction flow will be added later.

## Course catalog (SIS "Tüm Ders Programı")

- Page: `sis.mef.edu.tr/dersler/dersprogrami/tumprogram` — one table, columns: Ders Kodu, Ders Adı, Section, Öğretim Elemanı, Derslik / Gün / Saat (one `<br>`-separated line per slot: `A101 / Pazartesi / 09:00 - 11:50`), kontenjan, programs, prerequisites. No semester label on the page.
- How it is pulled (manual, by the owner, decided 2026-11-10): log in to SIS yourself in Chrome, open the page, export the table to `data/mef-catalog-<term>.json` (code, name, section, instructors, slot lines only — no quota/program columns). Claude did this once through the Chrome extension in the owner's logged-in session; it never enters credentials. `data/` is gitignored.
- Load: `pnpm db:import-catalog data/mef-catalog-2026-fall.json` (one transaction; replaces meetings of catalog sections, leaves student sections alone; safe to re-run after room/time changes).
- 2026-2027 Fall export: 532 sections, 668 slots (SIS listed FIN 525 and FIN 526 slots twice; the parser drops exact duplicates). Courses without a fixed slot (HISTR 213, TURK 114) are not in the catalog.
- The form looks up code + section on blur (`lookupSection` action) and shows the catalog slots read-only; manual entry only for sections not in the catalog.

## Calendar (.ics) rules

- Endpoint: `GET /cal/[token].ics` — generated from the database on every request, `Content-Type: text/calendar; charset=utf-8`, short cache (`max-age=300`).
- The subscription link is also shown to the user with the `webcal://` scheme (Apple subscribes in one tap).
- Time zone: **Europe/Istanbul** (fixed UTC+3, no daylight saving). Either include a `VTIMEZONE` or write times converted to UTC; don't mix the two.
- **Do not use recurrence rules (RRULE); generate every class session as a separate VEVENT** (from semester start to end, excluding holidays). This makes marking cancellations and changing a single session much simpler.
- Every VEVENT must have a **stable UID**: `<course>-<section>-<YYYYMMDD>-<HHMM>@mef-calendar`. Otherwise calendar apps duplicate events on every refresh. Separate events (exam, makeup, other) use `event-<course_events.id>@mef-calendar`, so editing their date/time updates the same entry.
- **Lab label** (decided 2026-11-10): when a section meets more than once a week, slots shorter than its longest slot are the lab: `COMP 201 Lab` (COMP 201-1: Mon 09:00–11:50 lecture, Mon 13:00–14:50 lab). Equal lengths → no lab. Computed from meetings (`meetingKind` in `lib/schedule.ts`), not stored; the UID does not change.
- **Lecture and lab are independent** (owner: it's usually the lab that gets cancelled, and a 3-hour lecture went online while the lab stayed face-to-face). Session changes (cancel, online, room_change) target one session via `course_events.start_time`; `start_time` null means every session of that course on that date.
- Icons (owner, 2026-11-10): 🧪 before lab sessions (`🧪 COMP 201 Lab`), 💻 before online ones — both courses whose room is "Online" (ECON 114) and sessions moved online. A lab moved online shows 💻.
- Cancellation: the event is not deleted; the title becomes `❌ İPTAL – COMP 201` (or `… 🧪 COMP 201 Lab`) and `STATUS:CANCELLED` is added. A cancellation wins over other changes to the same session.
- Unconfirmed cancellation: title `❓ Muhtemelen iptal – COMP 201`, the event is not cancelled.
- Online (event type `online`, added 2026-11-10): title `COMP 201 (Online)`, `LOCATION:Online`, note in the description (e.g. where the link is). Unconfirmed: `❓ COMP 201 (Muhtemelen online)`, location unchanged.
- Room change: that session's `LOCATION` is updated and `Sınıf değişti: A → B` is added to the description. Unconfirmed: `LOCATION` shows both, `A101 - ? A415` (owner, 2026-11-10), plus a description note. Unconfirmed online likewise: `A101 - ? Online`.
- Exam: separate VEVENT, title `📝 COMP 201 Vize` (`title` column; default "Sınav"). Make-up: `🔁 COMP 201 Telafi`. Other: `ℹ️ COMP 201 – <title>`. No start time → all-day event; start but no end → 1 hour. Unconfirmed → `❓ ` prefix.
- `DESCRIPTION` contains change notes first (if any), then the course name, section and instructor.

## Privacy rules (strict)

- The top of the SIS page contains the **national ID number (TC Kimlik No), first name and last name**. These are never stored, never logged, and never sent anywhere.
- The screenshot and the full OCR text **never leave the browser**: no upload, no API call, no analytics, no `console.log` of OCR text. Only the extracted `{code, section}` pairs go to the server (through the normal review form).
- `lib/extract.ts` keeps only lines that look like a course row (course code + section); everything else in the OCR text (names, ID numbers, advisor) is discarded before it reaches React state.
- State it clearly in the UI (in Turkish): the image is read on your own device and is not uploaded anywhere.
- Tokens are truncated in logs (`abc1…`).

## Coding conventions

- UI text in Turkish; code, variable names and commit messages in English.
- Date/time logic lives in a single module (`lib/schedule.ts`) and is tested.
- Turning OCR text into courses lives in `lib/extract.ts`: pure functions, no OCR or DOM imports, tested with real OCR output.
- Input to Server Actions and Route Handlers is always validated with Zod.
- Small, frequent commits. At the end of every phase, deploy to Vercel and test the subscription on a real phone.

---

## Roadmap

### Phase 0 — Setup
- [x] Next.js + TypeScript + Tailwind + pnpm project
- [x] Drizzle + Neon connection, first migration (`semesters`, `students`, `enrollments`, `meetings`, `course_events`)
- [x] Vercel project, environment variables, first deploy — repo `flaney37/mef-calendar`, Vercel team "yigit n friends" (Hobby), Neon free in Frankfurt
- [x] Seed a 2026-2027 Fall row in `semesters` — `scripts/seed-semesters.mts`, run with `pnpm db:seed` (idempotent, matches by name)

### Phase 1 — Manual input → working calendar link (first end-to-end version)
Goal: a subscription that works on a phone, by the shortest path, without AI.
- [x] Simple form: course code, section, day, start-end time, room (add/remove rows) — `app/schedule-form.tsx`, one card per course with 0+ slots
- [x] Save → create `students` + `enrollments` + `meetings`, show the feed and edit links — `lib/db/save-schedule.ts`, one `db.batch` transaction
- [x] `lib/schedule.ts`: semester + holidays + weekly meetings → list of individual sessions
- [x] `GET /cal/[token].ics` endpoint, stable UIDs — `app/cal/[token]/route.ts`, pure `lib/feed.ts` + `lib/ics.ts`
- [x] Vitest: skipping holidays, semester boundaries, UID stability, time zone (tests run with `TZ=America/Los_Angeles`)
- [x] `/edit/[editToken]` page — same form pre-filled; save keeps the feed URL; "Bağlantımı yenile" (new feed token, old one 404s) and "Kaydımı sil" (deletes student + enrollments). For a non-catalog section the editor may change its slots only if no other student is in it; otherwise the existing slots are kept and the form warns.
- [x] **Acceptance:** I enter my own schedule and can subscribe in Apple Calendar (Mac + iPhone); classes appear on the right day and time
  - 2026-11-10 iPhone ✅ (one course, COMP 201): right day/time/room, no duplicates after refresh, 26 Oct shown and 28–30 Oct skipped, nothing after 11 Dec, no "(GMT)" after the VTIMEZONE switch. Mac ✅ (File → New Calendar Subscription, every Monday incl. 26 Oct).
  - 2026-11-10 full schedule ✅: 7 courses (5 from the catalog, HISTR 213 / TURK 114 without slots), 98 events; the week of 9–13 Nov in Apple Calendar matches the SIS weekly grid exactly (days, times, rooms).

### Phase 2 — Import from screenshot
- [x] Spike: run Tesseract.js on a real SIS screenshot and look at the raw text — at original size (2000 px wide page) codes came out garbled ("coup 201", "eE209", "wa 211"), course names were fine; **upscaled 3x every code and section was exact** (confidence 66 → 85)
- [x] `lib/extract.ts`: OCR text → `{code, section, name}` rows under the "DERS KODU" header; codes not in the catalog are repaired by course name + section (Dice similarity ≥ 0.7). Tests use both real OCR outputs; both give all 7 courses right, also against the full catalog
- [x] Upload screen (`app/screenshot-import.tsx`): file picker (`accept="image/*"`), `tesseract.js` imported only when a file is picked (it runs its own Web Worker; worker, WASM core and `eng` data come from the jsDelivr CDN and are cached by the browser)
- [x] OCR robustness (after the first phone test found only 3–4 of 7): the row parser ignores the credit column, takes the section between course name and the all-caps instructor (1 may read as `| ' ] l`), and snaps misread department prefixes (HSTR → HISTR). The image is read **twice** (PSM 6 "single block", upscaled to ~3600 and ~4400 px wide, canvas capped at 16 Mpx for iPhone Safari) and the rows are merged; `matchToCatalog` keeps one entry per course and drops unknown departments. A 12-way test (4 scales × 3 PSM modes) on one screenshot found 0–7 rows depending on the setting, each missing a different row, hence the merge. Upscaling 5x made it worse (JPEG artifacts). Debug a bad image with `pnpm ocr:debug <image>` (prints only the course list part).
- [x] "Review" screen: the Phase 1 form, pre-filled with the OCR result (catalog fills the times); the student corrects and saves
- [x] Courses without a time slot (e.g. HISTR 213, TURK 114): not put on the calendar but kept in `enrollments`
- [x] Error cases: OCR finds nothing / fails → message, the (empty) manual form stays below
- Verified locally: OCR of the sample took ~6 s in Chromium; the only request to our server was 504 bytes of code/section/name for 7 rows (no image, no instructor or advisor names).
- [x] **Acceptance:** I upload my own screenshot and get the correct calendar in under a minute
  - 2026-11-10 ✅ 7/7 courses on Mac and iPhone, with two different screenshots (the full-page desktop one and a closer one taken on the phone).

### Phase 3 — Cancellations, exams and room changes (manual input, fallback panel)
- [x] `/admin` — simple panel protected by `ADMIN_PASSWORD` (`lib/admin-auth.ts`: constant-time password check, cookie `mef_admin` = `<expiry>.<HMAC(password)>`, httpOnly, SameSite=strict, 7 days; wrong password waits 1 s; changing the password logs everyone out). Every action in `app/admin/actions.ts` re-checks the cookie — verified with a cookieless `saveEvent` POST (rejected, nothing written).
- [x] Add event: course + section (or all sections), type, date, time, room, note, status (confirmed/unconfirmed). The form loads the course's sections and sessions (Ders / 🧪 Lab, narrowed to the date's weekday); `lib/event-input.ts` validates and rejects session changes that don't hit a real session (wrong weekday, wrong time, holiday, outside the semester).
- [x] The feed applies these events (cancellation title, exam event, room update) — plus lab labels and the `online` type; 20 feed tests, checked against the DB with a fake course
- [x] Event list, edit and delete (upcoming list + collapsed past events; two-step delete)
- [ ] Later (owner: not now): `time_change` event type — a session moved to another time. Needs new columns for the new start/end (`start_time` already picks the session). Confirmed → move the session, same UID. Unconfirmed → keep it, title `❓ COMP 201 (belki 10:00–11:50)` (a calendar event has only one time, so the `A101 - ? A415` trick doesn't work here). Today this has to be entered as cancel + make-up.
- Local testing of `/admin`: start the server with a throwaway password (`ADMIN_PASSWORD=… pnpm start`); an already-set env var wins over `.env.local`, so the real password never has to be typed into a test browser.
- [x] **Acceptance:** I enter a cancellation in the panel; after Apple Calendar refreshes, the class shows as "❌ İPTAL"
  - 2026-11-10 ✅ owner tested on the live site: cancellation, online and unconfirmed (❓) events show up in Apple Calendar, 🧪/💻 icons in place.

### Phase 4 — Automatic capture from emails
- [x] `POST /api/ingest` — endpoint protected by a per-volunteer token (`volunteers` table: token, name, sections covered)
  - `app/api/ingest/route.ts` (HTTP), `lib/ingest-plan.ts` (pure, tested: Zod body `{messageId, from, subject, body, sentAt}`, sender check on the real `<address>` — `@mef.edu.tr` / `@mef.blackboard.com`, token hash, dedupe key, rules), `lib/db/ingest.ts`. Response is only `{status, events}`; the mail body is never stored or logged.
  - **Every event read from a mail is written `unconfirmed` (❓) and waits for a person** (owner, 2026-11-10: these happen at most about once a week, so manual review is cheap and a wrong ❌ is worse). `/admin` shows them first under "Onay bekleyen (mailden)" with Onayla / Düzenle / Sil; what the parser was unsure about is appended to the note ("Emin olunmayan: …"). Revisit auto-confirming once the measured accuracy is high enough.
  - Events only for the volunteer's own sections. A course code without a section → the volunteer's section, unconfirmed. No course key → the subject prefix ("Calculus II: …") is matched against the volunteer's course names.
  - The subject is stored only when the mail is about one of the volunteer's courses (a personal mail that slips through keeps nothing but its hash).
  - Dedupe in two layers: `ingested_mails.dedupe_key` (a mail that was only ignored/unsure may be retried by another volunteer who is in the section), and per event (same course/section/type/date/time is not added again — Blackboard likely gives every student a copy with its own Message-ID).
  - `pnpm ingest:smoke` (with `pnpm dev` running): end-to-end against the real DB with TEST999 + TEST tokens, cleans up after itself. 2026-11-10 ✅ 10/10 (processed, duplicate, second copy, non-MEF sender, 401, 400, DB row, feed shows İPTAL on the lab and leaves the lecture).
- [ ] Google Apps Script (in the `apps-script/` folder): scans Gmail every 10 minutes; sends new mails from `@mef.edu.tr` / Blackboard that contain cancellation/exam keywords to `/api/ingest` with student names stripped; labels the processed ones
- [x] DB: `volunteers` (student_id unique, SHA-256 `token_hash`, no name/email; covered sections = that student's enrollments) and `ingested_mails` (unique `dedupe_key` = hashed Message-ID, subject, outcome processed/ignored/unsure; body never stored); `course_events.mail_id`. Migration `0004_phase4_mail_ingest` applied 2026-11-10.
- [ ] Parser: rule-based first (course code regex; "iptal / yapılmayacak / cancel / telafi / sınav / vize / final"; date expressions including "yarın" (tomorrow) and "bu Çarşamba" (this Wednesday), relative to the mail's date); Gemini if not confident
  - Rule-based parser done: `lib/mail-parse.ts` (`parseMail` → `mailToEvents`), tests built from real inbox mails. Gemini left out for now (would send instructors' mails to Google); unsure cases become ❓ or go to `/admin`.
  - What real MEF mails look like (2026-11-10): nearly all course mail comes via Blackboard (`do-not-reply@mef.blackboard.com`) with a course key `2026-2027-01-COMP201-01` in the body → exact course + section. The subject usually states what happened; the body has the exact date. The Blackboard footer says "…viewed online" (cut it). Mails mention past dates as context (dropped). Weekdays can name a group ("Thursday session", "Perşembe grubu") — not a date.
  - Traps found in real lab mails: rule sentences ("If there is no lab on a particular week, you will be informed", "there will be no make-up labs") are not events — conditional sentences are skipped and "no make-up" is stripped. "Held in A415 instead of A303": the room after "instead of"/"from" is the old one. Permanent changes ("Starting this week, Wednesday lab sessions will be held in A415", "from now on") become one event per matching session until semester end, only on the weekday named. "The week of October 5" = that week; "October 5 and October 6" = two days (fine for a cancellation, suspicious for an exam).
  - Inbox sweep (2026-11-10): the parser was run in the browser over 400 of the owner's mails (226 Blackboard, 174 direct `@mef.edu.tr`; texts never left the browser, only results). Fixed from it: negations ("decided not to hold the sessions online", "online olmayacaktır" — "olmayacak" alone reads as a cancel), poll options ("Option 1: …"), "[EVERYONE]" alone is not school-wide (every bulk mail has it), "TÜBİTAK 2209" is not a course, score/objection/assignment mails, exams need one day in their own sentence ("Video quizzes next week", "practice problems for the midterm"), dates come from the sentence that says what happened first ("dersler yapılmayacaktır … telafi dersleri 24 Mart'ta"), 12-hour times, "from 14:00 to 14:40", plural "Exams"/"quizzes", "next week" in a weekend mail = the coming week.
  - Fetching Gmail print views quickly (~500 in a minute) triggered Google's "Unusual Usage – Account Temporarily Locked Down" (about 1 hour). If the inbox is read through the browser again: a few mails per minute, never in parallel.
  - Some older Blackboard mails have no course key in the body, only "Calculus II: …" in the subject. Idea for ingest: pass the volunteer's own sections with course names so the subject prefix can be matched.
  - One mail can hold two events (cancelled days + make-up days): only the first is taken today.
  - Not handled yet: school-wide notices (`[EVERYONE] … tüm dersler online`) need a "all courses" event (schema requires a course); postponements ("ertelendi") need a new date; 12-hour times ("2:59 PM").
- [x] Confidence level: `confirmed` if certain, otherwise `unconfirmed` (❓)
- [x] If the same mail arrives from two volunteers, process it once (Message-ID / content hash)
- [ ] Volunteer setup page: copy the script, paste the token, set up the trigger
- [ ] Coverage map: which sections have a volunteer
  - Coverage must be **per section, never per cohort/year** (owner, 2026-11-10): students taking courses from a lower year (alttan ders) or a mixed schedule don't share all courses with "their" class, so a volunteer from the normal cohort does not receive that section's mails. Count volunteers per `course_code + section` from their own enrollments.
  - Show it to students: on the result/edit page, mark sections with no volunteer ("bu section için otomatik iptal takibi yok") so nobody assumes coverage they don't have; invite them to become the volunteer for it.
- [ ] Later (optional): inbound email service for mails manually forwarded to an `iptal@…` address
- [ ] **Acceptance:** a real cancellation email from an instructor lands in calendars within 15 minutes without anyone doing anything

### Phase 5 — Blackboard assignments and pilot
- [ ] Optional: the student adds their Blackboard calendar link; the feed merges assignments (with an option to filter noise such as "In-class:" items). The link is stored encrypted and can be deleted.
- [ ] Mobile-friendly UI polish, subscription instructions (iPhone / Mac / Google / Outlook)
- [ ] "Send my links by email": losing the edit link is easy (it already happened once in testing, and the only fix was a new record). Send the feed + edit links to an address the student types, **without storing the address** (the `students` table must stay free of email). Needs a free transactional email service; check the privacy rules before choosing one.
- [ ] Screenshot-only warning on the upload screen: tell students clearly to upload a **screenshot**, not a camera photo of a screen (OCR is much less accurate on photos). Could also detect likely photos (EXIF camera data, size/aspect) and warn.
- [ ] Optional terminal-style theme (and a light/dark toggle): move hard-coded Tailwind colors to CSS variables first. Owner showed a mockup on 2026-11-10; no command line or personal events, only the look.
- [ ] Pilot: my own section + 10-20 friends, 2-3 weeks; collect feedback
- [ ] Simple usage metrics (number of feeds, number of events) — without personal data

### Phase 6 — Later (before presenting to the school)
- [x] Full course catalog (manually run scraper) → moved earlier, done in Phase 1 (see "Course catalog"); still to do: use it to validate AI output in Phase 2, re-import for room changes
- [ ] Notifications for urgent cancellations (email or web push)
- [ ] KVKK (Turkish data protection law) privacy notice, privacy page
- [ ] Present to the school: IT / Student Affairs — official data access, mail reading as an internal Google app, a `mef.edu.tr` subdomain

---

## Academic calendar (source: mef.edu.tr → Öğrenci İşleri → Akademik Takvim, "Lisans" sheet)

- **2026-2027 Fall:** classes 2026-09-14 (Mon) → 2026-12-11 (Fri, "Derslerin Son Günü"). Holidays with no class: 2026-10-28, 2026-10-29 (Cumhuriyet Bayramı), 2026-10-30 (all three listed as full days). 2026-10-06 is an emergency drill ("Acil Durum Tatbikatı"), not a holiday. 2026-12-14 → 12-31 is the project/presentation period (no regular classes).
- Law faculty has its own sheet ("Lisans Hukuk"); not checked.

## Open design question: exam rooms (deliberately undecided)

Midterm/final rooms are usually assigned **by student**, e.g. by student number or surname range ("2021001–2021120 → A101"). Putting each student's own exam room into their feed needs a per-student key, which clashes with "no name, no student number" (Core decisions, Privacy rules). Options, cheapest privacy cost first:
1. **No personal key:** the exam event carries the whole assignment table in its description; the student finds their row. Zero new data. Clumsy on a phone.
2. **Key kept in the browser only:** the student types their number/surname range on the edit page, it is stored in `localStorage`, and the page shows "your room: A101". The feed (server-generated) can't use it, so the calendar still shows option 1.
3. **Minimal stored key:** store only what the assignment rule needs (e.g. the range bucket or the first letter of the surname), never the full number/name. Personal feed shows the exact room. A real change to the privacy rules: ask the owner, update the KVKK notice.
4. **Full student number:** simplest to automate, most expensive. Avoid.

Don't build any of this until the owner decides; until then exams use option 1 (room or "see description" in `LOCATION`).

## Open questions
- 2026-2027 Spring dates (same sheet, not read yet)
- Project name and domain (for now `mef-calendar.vercel.app`)
- Finals week: answered for Fall 2026 — classes end 2026-12-11, then the project/presentation period. Should that period appear in the calendar at all?
- How are makeup classes usually announced (same mail or separate)?
- Meeting conflicts are only logged (Vercel logs, `meetings conflict for …`), and now only matter for sections outside the catalog. If the first student entered wrong times for such a section, nobody can fix them yet.
- **Look at later:** a student-entered section `STAT101-2` ("Statics", instructor given) exists in the DB but not in the Fall 2026 catalog. Wrong code, or a course the catalog misses?
- The catalog page has no semester label; the import assumes the current semester. Check the page title/filters next time for a term selector.
- "Current semester" = the one with the latest `start_date`. Revisit when Spring is seeded before Fall ends.

## Decisions made during Phase 1

- Course name and instructor live in a `sections` table (per section, not per meeting).
- Course codes are stored as `COMP201` (`normalizeCourseCode`: strip spaces, ASCII uppercase — not Turkish locale, which would turn "histr" into "HİSTR") and shown as `COMP 201` (`displayCourseCode`). Sections drop leading zeros ("01" → "1"). All in `lib/course-code.ts`.
- `/edit/[editToken]` streams its content inside `<Suspense>` (Next 16 Cache Components), so an unknown token shows the not-found page with HTTP 200, not 404. Fine: nothing leaks. The page sets `robots: noindex` and `referrer: no-referrer`.
- Feeds are sent with `max-age=300`, so after a link rotation or delete, a calendar app or browser may still show the old feed for up to 5 minutes.
- `.ics` event times are written as `DTSTART;TZID=Europe/Istanbul:…` with a fixed +03:00 `VTIMEZONE` block (only `DTSTAMP` is UTC, as RFC 5545 requires). First version used UTC `…Z` times; iPhone then showed "09:00 (06:00 GMT)" on every event. UIDs did not change with the switch.

## Environment notes (learned during setup)

- Node 24 LTS from Homebrew (`node@24`, keg-only → added to fish PATH with `fish_add_path /opt/homebrew/opt/node@24/bin`). pnpm comes from corepack, pinned in `package.json` → `packageManager`.
- Windows PC (2026-11-10): project at `C:\Dev\mef-calendar` (not the OneDrive Desktop, so `.env.local` isn't synced to the cloud). Node 24 via `winget install OpenJS.NodeJS.LTS --version 24.22.1` (the LTS id now points at 26, and corepack no longer ships from Node 25 on). `corepack enable pnpm` can't write to `C:\Program Files\nodejs` without admin → `corepack enable pnpm --install-directory "$env:APPDATA\npm"` (already on the user PATH). In Windows PowerShell 5.1, pass multi-line commit messages with `git commit -F <file>`.
- Next.js 16.4 with `cacheComponents` on. Its APIs differ from older Next; read `node_modules/next/dist/docs/` before writing routes (see `AGENTS.md`).
- pnpm 12 blocks dependency build scripts by default; allowed ones are listed in `pnpm-workspace.yaml` → `allowBuilds` (esbuild is allowed, drizzle-kit needs it).
- `pnpm typecheck` runs `next typegen` first, because global types like `LayoutProps` are generated.
- Scripts: `pnpm dev | build | lint | typecheck | test | db:generate | db:migrate | db:studio`.
- Neon was added through the Vercel integration with prefix `DATABASE` (→ `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, plus `PG*` / `POSTGRES_*` aliases), Auth off, "Sensitive" off so the value can be copied for Development. Local copy lives in `.env.local` (gitignored).
- New migration flow: edit `lib/db/schema.ts` → `pnpm db:generate` → review the SQL in `drizzle/` → `pnpm db:migrate` (applies to the Neon DB in `.env.local`, which is the same DB production uses).
