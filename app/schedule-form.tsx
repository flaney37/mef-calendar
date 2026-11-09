"use client";

import { useState, useTransition } from "react";
import { scheduleSchema } from "@/lib/schedule-input";
import { createSchedule } from "./actions";

const WEEKDAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

type SlotDraft = { id: number; weekday: string; startTime: string; endTime: string; room: string };
type CourseDraft = {
  id: number;
  code: string;
  section: string;
  courseName: string;
  instructor: string;
  slots: SlotDraft[];
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
});

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900";

export function ScheduleForm() {
  const [courses, setCourses] = useState<CourseDraft[]>(() => [newCourse()]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ feedToken: string; editToken: string } | null>(null);
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

  function submit(event: React.FormEvent) {
    event.preventDefault();
    // Same schema as the server: catch mistakes before the round trip.
    const parsed = scheduleSchema.safeParse({ courses });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Bilgileri kontrol et");
      return;
    }
    setError(null);
    startTransition(async () => {
      // Send the raw drafts, not parsed.data: the server parses them again,
      // and its schema expects the form's strings, not the parsed output.
      const res = await createSchedule({ courses });
      if (res.ok) setResult(res);
      else setError(res.error);
    });
  }

  if (result) return <Result {...result} />;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
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
                onChange={(e) => updateCourse(course.id, { code: e.target.value })}
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
                onChange={(e) => updateCourse(course.id, { section: e.target.value })}
                required
              />
            </label>
          </div>

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
                    updateCourse(course.id, {
                      slots: course.slots.filter((s) => s.id !== slot.id),
                    })
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

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 py-3 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Kaydediliyor…" : "Takvimimi oluştur"}
      </button>
    </form>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        <input readOnly value={value} className={`${inputClass} font-mono text-sm`} />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
          className="shrink-0 rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700"
        >
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
    </div>
  );
}

function Result({ feedToken, editToken }: { feedToken: string; editToken: string }) {
  const { host, origin } = window.location;
  const webcal = `webcal://${host}/cal/${feedToken}.ics`;
  const https = `${origin}/cal/${feedToken}.ics`;
  const edit = `${origin}/edit/${editToken}`;

  return (
    <div className="flex flex-col gap-5">
      <h2 className="text-xl font-semibold">Takvimin hazır 🎉</h2>
      <a
        href={webcal}
        className="rounded-md bg-zinc-900 py-3 text-center font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        iPhone / Mac: Takvime abone ol
      </a>
      <CopyRow label="Google Takvim / Outlook için bağlantı" value={https} />
      <CopyRow label="Düzenleme bağlantısı" value={edit} />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Bu bağlantıları bir yere kaydet. Hesap olmadığı için kaybedersen geri getiremeyiz.
        Bağlantıyı bilen herkes takvimini görebilir, kimseyle paylaşma.
      </p>
    </div>
  );
}
