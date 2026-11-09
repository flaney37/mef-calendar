# mef-calendar

An automatic class calendar for MEF University students. A student uploads a screenshot of their SIS class schedule, gets a personal calendar subscription link (.ics), and subscribes to it in Apple / Google / Outlook Calendar. When class cancellations, exam dates or room changes are entered into the system (later: picked up automatically from emails), everyone's calendar updates on its own.

Goal: first a zero-cost MVP (my own class + friends), then offer it to the school as a free service. No SaaS / sales goal.

---

## Core decisions (ask before changing)

- **No accounts.** A student is identified by a random, unguessable token (at least 128 bits, URL-safe). Calendar link: `/cal/<token>.ics`. A separate secret link for editing: `/edit/<editToken>`.
- **Schedule input = screenshot + crop.** The student uploads a screenshot of the "Ders Programı" (class schedule) page in SIS and, in the browser, crops **only the weekly grid + the course list below it**. Only the cropped image is sent to the server and to the AI.
- **Image reading = Gemini free tier** (current Flash model, structured JSON output). Because free-tier data may be used by Google, cropping is mandatory and the server performs a second check as well (see Privacy below).
- **AI output is always confirmed by the student.** Before saving, an editable "review" screen is shown.
- **Sharing key = course code + section** (`COMP 201` + `1` → `COMP201-1`). Events such as cancellations/exams are attached to a section (or to the whole course) and show up in the calendar of everyone who selected that section.
- **Never log into SIS automatically with anyone's credentials.** A scraper / course catalog may be added later, only as a manually run tool.

## Tech stack

- **Next.js** (App Router, TypeScript, strict) — on Vercel, free plan
- **Postgres** — Neon via the Vercel Marketplace (free plan), ORM: **Drizzle**
- **Tailwind CSS** — UI
- **Cropping:** `react-easy-crop` (or similar, client-side)
- **Image reading:** `@google/genai` (Gemini API), with a JSON schema
- **Tests:** Vitest (especially for .ics generation and date calculations)
- Package manager: pnpm

Environment variables (`.env.local`, never commit):
```
DATABASE_URL=
GEMINI_API_KEY=
ADMIN_PASSWORD=          # for the fallback panel in Phase 3
INGEST_SECRET=           # for the mail scripts in Phase 4
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
               type: cancel | makeup | room_change | exam | other,
               date, start_time, end_time, room, title, note,
               status: confirmed | unconfirmed, source: manual | mail, created_at
```

`meetings` is stored per section: the second student who uploads the same section reuses the existing record. On a conflict (two students' screenshots say different times), log it and keep the first confirmed one; a correction flow will be added later.

## Calendar (.ics) rules

- Endpoint: `GET /cal/[token].ics` — generated from the database on every request, `Content-Type: text/calendar; charset=utf-8`, short cache (`max-age=300`).
- The subscription link is also shown to the user with the `webcal://` scheme (Apple subscribes in one tap).
- Time zone: **Europe/Istanbul** (fixed UTC+3, no daylight saving). Either include a `VTIMEZONE` or write times converted to UTC; don't mix the two.
- **Do not use recurrence rules (RRULE); generate every class session as a separate VEVENT** (from semester start to end, excluding holidays). This makes marking cancellations and changing a single session much simpler.
- Every VEVENT must have a **stable UID**: `<course>-<section>-<YYYYMMDD>-<HHMM>@mef-calendar`. Otherwise calendar apps duplicate events on every refresh.
- Cancellation: the event is not deleted; the title becomes `❌ İPTAL – COMP 201` and `STATUS:CANCELLED` is added.
- Unconfirmed cancellation: title `❓ Muhtemelen iptal – COMP 201`, the event is not cancelled.
- Exam: separate VEVENT, title `📝 COMP 201 Vize`.
- Room change: that session's `LOCATION` is updated and a note is added to the description.
- `DESCRIPTION` contains the course name, section and instructor.

## Privacy rules (strict)

- The top of the SIS page contains the **national ID number (TC Kimlik No), first name and last name**. These are never stored, never logged, and never knowingly sent to the AI.
- Cropping happens in the browser; the original screenshot is never uploaded to the server.
- The server holds the cropped image **in memory only**, sends it to Gemini and discards it. The image is never written to disk or the database.
- The Gemini prompt asks only for the class table. If the response contains an 11-digit number or a field resembling "TC Kimlik", the response is rejected and the user is asked to crop again.
- State it clearly in the UI (in Turkish): "Crop out the top part that contains your ID number. The image is not stored; it is deleted after being read."
- Tokens are truncated in logs (`abc1…`).

## Coding conventions

- UI text in Turkish; code, variable names and commit messages in English.
- Date/time logic lives in a single module (`lib/schedule.ts`) and is tested.
- Everything sent to/received from Gemini lives in `lib/extract.ts`; returned data is validated with a **Zod** schema.
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
- [ ] `/edit/[editToken]` page (the link is shown after saving but 404s until this exists)
- [ ] **Acceptance:** I enter my own schedule and can subscribe in Apple Calendar (Mac + iPhone); classes appear on the right day and time

### Phase 2 — Import from screenshot
- [ ] Upload screen (including phone camera/gallery)
- [ ] Client-side cropping, guide text and an example image ("select only this part")
- [ ] `POST /api/extract`: cropped image → Gemini → course list validated with Zod (`code, name, section, weekday, start, end, room`)
- [ ] Check that rejects responses containing ID/identity data
- [ ] "Review" screen: the Phase 1 form, pre-filled with the AI output; the student corrects and saves
- [ ] Courses without a time slot (e.g. HISTR 213, TURK 114): not put on the calendar but kept in `enrollments`
- [ ] Error cases: Gemini quota exceeded / unreadable → fall back to the manual input form
- [ ] **Acceptance:** I upload my own screenshot and get the correct calendar in under a minute

### Phase 3 — Cancellations, exams and room changes (manual input, fallback panel)
- [ ] `/admin` — simple panel protected by `ADMIN_PASSWORD`
- [ ] Add event: course + section (or all sections), type, date, time, room, note, status (confirmed/unconfirmed)
- [ ] The feed applies these events (cancellation title, exam event, room update)
- [ ] Event list, edit and delete
- [ ] **Acceptance:** I enter a cancellation in the panel; after Apple Calendar refreshes, the class shows as "❌ İPTAL"

### Phase 4 — Automatic capture from emails
- [ ] `POST /api/ingest` — endpoint protected by a per-volunteer token (`volunteers` table: token, name, sections covered)
- [ ] Google Apps Script (in the `apps-script/` folder): scans Gmail every 10 minutes; sends new mails from `@mef.edu.tr` / Blackboard that contain cancellation/exam keywords to `/api/ingest` with student names stripped; labels the processed ones
- [ ] Parser: rule-based first (course code regex; "iptal / yapılmayacak / cancel / telafi / sınav / vize / final"; date expressions including "yarın" (tomorrow) and "bu Çarşamba" (this Wednesday), relative to the mail's date); Gemini if not confident
- [ ] Confidence level: `confirmed` if certain, otherwise `unconfirmed` (❓)
- [ ] If the same mail arrives from two volunteers, process it once (Message-ID / content hash)
- [ ] Volunteer setup page: copy the script, paste the token, set up the trigger
- [ ] Coverage map: which sections have a volunteer
- [ ] Later (optional): inbound email service for mails manually forwarded to an `iptal@…` address
- [ ] **Acceptance:** a real cancellation email from an instructor lands in calendars within 15 minutes without anyone doing anything

### Phase 5 — Blackboard assignments and pilot
- [ ] Optional: the student adds their Blackboard calendar link; the feed merges assignments (with an option to filter noise such as "In-class:" items). The link is stored encrypted and can be deleted.
- [ ] Mobile-friendly UI polish, subscription instructions (iPhone / Mac / Google / Outlook)
- [ ] Pilot: my own section + 10-20 friends, 2-3 weeks; collect feedback
- [ ] Simple usage metrics (number of feeds, number of events) — without personal data

### Phase 6 — Later (before presenting to the school)
- [ ] Full course catalog (manually run scraper) → validate AI output and apply room changes in bulk
- [ ] Notifications for urgent cancellations (email or web push)
- [ ] KVKK (Turkish data protection law) privacy notice, privacy page
- [ ] Present to the school: IT / Student Affairs — official data access, mail reading as an internal Google app, a `mef.edu.tr` subdomain

---

## Academic calendar (source: mef.edu.tr → Öğrenci İşleri → Akademik Takvim, "Lisans" sheet)

- **2026-2027 Fall:** classes 2026-09-14 (Mon) → 2026-12-11 (Fri, "Derslerin Son Günü"). Holidays with no class: 2026-10-28, 2026-10-29 (Cumhuriyet Bayramı), 2026-10-30 (all three listed as full days). 2026-10-06 is an emergency drill ("Acil Durum Tatbikatı"), not a holiday. 2026-12-14 → 12-31 is the project/presentation period (no regular classes).
- Law faculty has its own sheet ("Lisans Hukuk"); not checked.

## Open questions
- 2026-2027 Spring dates (same sheet, not read yet)
- Project name and domain (for now `mef-calendar.vercel.app`)
- Finals week: answered for Fall 2026 — classes end 2026-12-11, then the project/presentation period. Should that period appear in the calendar at all?
- How are makeup classes usually announced (same mail or separate)?
- Meeting conflicts are only logged (Vercel logs, `meetings conflict for …`). If the first student entered wrong times, nobody can fix them yet: the correction flow is still open.
- "Current semester" = the one with the latest `start_date`. Revisit when Spring is seeded before Fall ends.

## Decisions made during Phase 1

- Course name and instructor live in a `sections` table (per section, not per meeting).
- Course codes are stored as `COMP201` (`normalizeCourseCode`: strip spaces, ASCII uppercase — not Turkish locale, which would turn "histr" into "HİSTR") and shown as `COMP 201` (`displayCourseCode`). Sections drop leading zeros ("01" → "1"). All in `lib/course-code.ts`.
- `.ics` times are written in UTC (`…Z`), no `VTIMEZONE`.

## Environment notes (learned during setup)

- Node 24 LTS from Homebrew (`node@24`, keg-only → added to fish PATH with `fish_add_path /opt/homebrew/opt/node@24/bin`). pnpm comes from corepack, pinned in `package.json` → `packageManager`.
- Next.js 16.4 with `cacheComponents` on. Its APIs differ from older Next; read `node_modules/next/dist/docs/` before writing routes (see `AGENTS.md`).
- pnpm 12 blocks dependency build scripts by default; allowed ones are listed in `pnpm-workspace.yaml` → `allowBuilds` (esbuild is allowed, drizzle-kit needs it).
- `pnpm typecheck` runs `next typegen` first, because global types like `LayoutProps` are generated.
- Scripts: `pnpm dev | build | lint | typecheck | test | db:generate | db:migrate | db:studio`.
- Neon was added through the Vercel integration with prefix `DATABASE` (→ `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, plus `PG*` / `POSTGRES_*` aliases), Auth off, "Sensitive" off so the value can be copied for Development. Local copy lives in `.env.local` (gitignored).
- New migration flow: edit `lib/db/schema.ts` → `pnpm db:generate` → review the SQL in `drizzle/` → `pnpm db:migrate` (applies to the Neon DB in `.env.local`, which is the same DB production uses).
