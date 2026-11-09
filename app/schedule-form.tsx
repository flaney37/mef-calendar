"use client";

import { useState, useTransition } from "react";
import type { CatalogLookup, EditCourse } from "@/lib/db/queries";
import { scheduleSchema } from "@/lib/schedule-input";
import { createSchedule, lookupSection, updateSchedule } from "./actions";
import { FeedLinks, inputClass } from "./feed-links";
import { displayCourseCode } from "@/lib/course-code";

const WEEKDAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

type SlotDraft = { id: number; weekday: string; startTime: string; endTime: string; room: string };
type CourseDraft = {
  id: number;
  code: string;
  section: string;
  courseName: string;
  instructor: string;
  slots: SlotDraft[];
  // Result of the catalog lookup for code + section; null until looked up.
  catalog: CatalogLookup | null;
};

// A plain counter for React keys: deterministic, so the server-rendered
// HTML and the browser agree (random ids would differ between the two).
let nextId = 0;
const newSlot = (): SlotDraft => ({
  id: nextId++,
  weekday: "1",
  startTime: "",
  endTime: "",
  room: "",
});
const newCourse = (): CourseDraft => ({
  id: nextId++,
  code: "",
  section: "",
  courseName: "",
  instructor: "",
  slots: [newSlot()],
  catalog: null,
});

const isUntouchedSlot = (s: SlotDraft) => !s.startTime && !s.endTime && !s.room;

// A saved course, as the edit page loads it, turned back into form state.
function toDraft(course: EditCourse): CourseDraft {
  const base = { ...newCourse(), code: course.code, section: course.section };
  if (course.source === "catalog") {
    return {
      ...base,
      slots: [],
      catalog: { found: true, courseName: course.courseName, instructor: course.instructor, slots: course.slots },
    };
  }
  return {
    ...base,
    courseName: course.courseName ?? "",
    instructor: course.instructor ?? "",
    slots: course.slots.map((s) => ({
      id: nextId++,
      weekday: String(s.weekday),
      startTime: s.startTime.slice(0, 5),
      endTime: s.endTime.slice(0, 5),
      room: s.room ?? "",
    })),
  };
}

// Without editToken: creates a new student. With it: edits that student's
// courses in place (the feed link stays the same).
export function ScheduleForm({
  editToken,
  initialCourses,
}: {
  editToken?: string;
  initialCourses?: EditCourse[];
}) {
  const [courses, setCourses] = useState<CourseDraft[]>(() =>
    initialCourses && initialCourses.length > 0 ? initialCourses.map(toDraft) : [newCourse()],
  );
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [kept, setKept] = useState<string[]>([]);
  const [result, setResult] = useState<{
    feedToken: string;
    editToken: string;
    keptCourses: string[];
  } | null>(null);
  const [pending, startTransition] = useTransition();

  const updateCourse = (id: number, patch: Partial<CourseDraft>) =>
    setCourses((cs) => cs.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const updateSlot = (courseId: number, slotId: number, patch: Partial<SlotDraft>) =>
    setCourses((cs) =>
      cs.map((c) =>
        c.id === courseId
          ? { ...c, slots: c.slots.map((s) => (s.id === slotId ? { ...s, ...patch } : s)) }
          : c,
      ),
    );

  // Runs when the code or section field loses focus.
  async function lookup(course: CourseDraft) {
    if (!course.code.trim() || !course.section.trim()) return;
    const asked = { code: course.code, section: course.section };
    const found = await lookupSection(asked);
    setCourses((cs) =>
      cs.map((c) => {
        // Ignore the answer if the fields changed while it was on the way.
        if (c.id !== course.id || c.code !== asked.code || c.section !== asked.section) return c;
        // Not in the catalog at all: most likely a course without a fixed
        // slot (HISTR 213), so drop the empty slot row the card starts with.
        const noSlotCourse =
          found && !found.found && found.otherSections.length === 0 &&
          c.slots.length === 1 && isUntouchedSlot(c.slots[0]);
        return { ...c, catalog: found, slots: noSlotCourse ? [] : c.slots };
      }),
    );
  }

  function payload() {
    // Catalog sections: the server uses the official slots and details.
    return {
      courses: courses.map((c) =>
        c.catalog?.found
          ? { code: c.code, section: c.section, slots: [] }
          : { code: c.code, section: c.section, courseName: c.courseName, instructor: c.instructor, slots: c.slots },
      ),
    };
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    // Same schema as the server: catch mistakes before the round trip.
    const parsed = scheduleSchema.safeParse(payload());
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Bilgileri kontrol et");
      return;
    }
    setError(null);
    setSaved(false);
    startTransition(async () => {
      // Send the raw form values, not parsed.data: the server parses them
      // again, and its schema expects the form's strings, not parsed output.
      if (editToken) {
        const res = await updateSchedule(editToken, payload());
        if (res.ok) {
          setSaved(true);
          setKept(res.keptCourses);
        } else setError(res.error);
      } else {
        const res = await createSchedule(payload());
        if (res.ok) setResult(res);
        else setError(res.error);
      }
    });
  }

  if (result) return <Result {...result} />;

  return (
    <form
      onSubmit={submit}
      onChange={() => setSaved(false)}
      className="flex flex-col gap-4"
    >
      {courses.map((course, index) => (
        <fieldset
          key={course.id}
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <div className="flex items-center justify-between">
            <legend className="font-medium">Ders {index + 1}</legend>
            {courses.length > 1 && (
              <button
                type="button"
                onClick={() => setCourses((cs) => cs.filter((c) => c.id !== course.id))}
                className="text-sm text-red-600"
              >
                Dersi sil
              </button>
            )}
          </div>

          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Ders kodu
              <input
                className={inputClass}
                placeholder="COMP 201"
                value={course.code}
                onChange={(e) => updateCourse(course.id, { code: e.target.value, catalog: null })}
                onBlur={() => lookup(course)}
                autoCapitalize="characters"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Şube
              <input
                className={inputClass}
                placeholder="1"
                inputMode="numeric"
                value={course.section}
                onChange={(e) => updateCourse(course.id, { section: e.target.value, catalog: null })}
                onBlur={() => lookup(course)}
                required
              />
            </label>
          </div>

          {course.catalog?.found ? (
            <CatalogInfo info={course.catalog} />
          ) : (
            <ManualEntry
              course={course}
              updateCourse={updateCourse}
              updateSlot={updateSlot}
            />
          )}
        </fieldset>
      ))}

      <button
        type="button"
        onClick={() => setCourses((cs) => [...cs, newCourse()])}
        className="rounded-md border border-dashed border-zinc-400 py-2 text-sm"
      >
        + Ders ekle
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          ✓ Kaydedildi. Takvimin bir sonraki yenilemede güncellenecek.
        </p>
      )}
      {saved && <KeptWarning courses={kept} />}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 py-3 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Kaydediliyor…" : editToken ? "Değişiklikleri kaydet" : "Takvimimi oluştur"}
      </button>
    </form>
  );
}

function CatalogInfo({ info }: { info: Extract<CatalogLookup, { found: true }> }) {
  return (
    <div className="flex flex-col gap-1 rounded-md bg-emerald-50 p-3 text-sm dark:bg-emerald-950/40">
      <span className="font-medium">✓ Ders programından bulundu</span>
      {info.courseName && <span>{info.courseName}</span>}
      {info.instructor && <span className="text-zinc-600 dark:text-zinc-400">{info.instructor}</span>}
      <ul className="mt-1 flex flex-col gap-0.5">
        {info.slots.map((s) => (
          <li key={`${s.weekday}-${s.startTime}`}>
            {WEEKDAYS[s.weekday - 1]} {s.startTime.slice(0, 5)}–{s.endTime.slice(0, 5)}
            {s.room ? ` · ${s.room}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ManualEntry({
  course,
  updateCourse,
  updateSlot,
}: {
  course: CourseDraft;
  updateCourse: (id: number, patch: Partial<CourseDraft>) => void;
  updateSlot: (courseId: number, slotId: number, patch: Partial<SlotDraft>) => void;
}) {
  const others = course.catalog && !course.catalog.found ? course.catalog.otherSections : [];
  return (
    <>
      {course.catalog && !course.catalog.found && (
        <p className="text-sm text-amber-700 dark:text-amber-400">
          {others.length > 0
            ? `Ders programında bu şube yok. Bu dersin şubeleri: ${others.join(", ")}.`
            : "Ders programında yok. Sabit saati varsa elle gir, yoksa boş bırak."}
        </p>
      )}

      <label className="flex flex-col gap-1 text-sm">
        Ders adı (isteğe bağlı)
        <input
          className={inputClass}
          placeholder="Data Structures"
          value={course.courseName}
          onChange={(e) => updateCourse(course.id, { courseName: e.target.value })}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Öğretim üyesi (isteğe bağlı)
        <input
          className={inputClass}
          value={course.instructor}
          onChange={(e) => updateCourse(course.id, { instructor: e.target.value })}
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm">Ders saatleri</span>
        {course.slots.length === 0 && (
          <p className="text-sm text-zinc-500">
            Sabit saati yok (ör. HISTR 213). Takvime eklenmez.
          </p>
        )}
        {course.slots.map((slot) => (
          <div
            key={slot.id}
            className="grid grid-cols-2 gap-2 rounded-md bg-zinc-50 p-2 sm:grid-cols-[1.4fr_1fr_1fr_1fr_auto] dark:bg-zinc-900/50"
          >
            <select
              aria-label="Gün"
              className={`${inputClass} col-span-2 sm:col-span-1`}
              value={slot.weekday}
              onChange={(e) => updateSlot(course.id, slot.id, { weekday: e.target.value })}
            >
              {WEEKDAYS.map((day, i) => (
                <option key={day} value={i + 1}>
                  {day}
                </option>
              ))}
            </select>
            <input
              aria-label="Başlangıç"
              type="time"
              className={inputClass}
              value={slot.startTime}
              onChange={(e) => updateSlot(course.id, slot.id, { startTime: e.target.value })}
              required
            />
            <input
              aria-label="Bitiş"
              type="time"
              className={inputClass}
              value={slot.endTime}
              onChange={(e) => updateSlot(course.id, slot.id, { endTime: e.target.value })}
              required
            />
            <input
              aria-label="Sınıf"
              placeholder="Sınıf"
              className={inputClass}
              value={slot.room}
              onChange={(e) => updateSlot(course.id, slot.id, { room: e.target.value })}
            />
            <button
              type="button"
              onClick={() =>
                updateCourse(course.id, { slots: course.slots.filter((s) => s.id !== slot.id) })
              }
              className="text-sm text-red-600"
            >
              Saati sil
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => updateCourse(course.id, { slots: [...course.slots, newSlot()] })}
          className="self-start text-sm text-blue-600"
        >
          + Saat ekle
        </button>
      </div>
    </>
  );
}

function KeptWarning({ courses }: { courses: string[] }) {
  if (courses.length === 0) return null;
  return (
    <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
      {courses.map(displayCourseCode).join(", ")}: girdiğin saatler kullanılmadı. Bu şubenin
      saatleri başka öğrenciler tarafından da kullanılıyor ve farklı girilmiş. Takviminde mevcut
      saatler görünecek; yanlışsa bize haber ver.
    </p>
  );
}

function Result({
  feedToken,
  editToken,
  keptCourses,
}: {
  feedToken: string;
  editToken: string;
  keptCourses: string[];
}) {
  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold">Takvimin hazır 🎉</h2>
      <KeptWarning courses={keptCourses} />
      <FeedLinks feedToken={feedToken} editToken={editToken} />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Bu bağlantıları bir yere kaydet. Hesap olmadığı için kaybedersen geri getiremeyiz.
        Bağlantıyı bilen herkes takvimini görebilir, kimseyle paylaşma.
      </p>
    </div>
  );
}
