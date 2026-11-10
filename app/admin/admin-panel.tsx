"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { displayCourseCode } from "@/lib/course-code";
import type { AdminEvent, AdminSection } from "@/lib/db/admin-queries";
import { SESSION_CHANGE_TYPES, type EventType } from "@/lib/event-input";
import { isoWeekday } from "@/lib/schedule";
import { inputClass } from "../feed-links";
import { adminCourseInfo, logout, removeEvent, saveEvent } from "./actions";

const WEEKDAYS = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];

const TYPE_LABELS: Record<EventType, string> = {
  cancel: "❌ İptal",
  online: "💻 Online'a geçti",
  room_change: "🚪 Sınıf değişikliği",
  exam: "📝 Sınav",
  makeup: "🔁 Telafi dersi",
  other: "ℹ️ Duyuru",
};

type Form = {
  id: number | null; // null = new event
  courseCode: string;
  section: string; // "" = all sections
  type: EventType;
  date: string;
  startTime: string; // session changes: "" = every session that day
  endTime: string;
  room: string;
  title: string;
  note: string;
  status: "confirmed" | "unconfirmed";
};

const emptyForm = (): Form => ({
  id: null,
  courseCode: "",
  section: "",
  type: "cancel",
  date: "",
  startTime: "",
  endTime: "",
  room: "",
  title: "",
  note: "",
  status: "confirmed",
});

const isSessionChange = (type: EventType) => SESSION_CHANGE_TYPES.includes(type);

function formatDate(date: string) {
  const [y, m, d] = date.split("-");
  return `${d}.${m}.${y} ${WEEKDAYS[isoWeekday(date) - 1]}`;
}

export function AdminPanel({
  semester,
  initialEvents,
}: {
  semester: { name: string; startDate: string; endDate: string };
  initialEvents: AdminEvent[];
}) {
  const router = useRouter();
  const [events, setEvents] = useState(initialEvents);
  const [form, setForm] = useState<Form>(emptyForm);
  const [course, setCourse] = useState<{ code: string; sections: AdminSection[] } | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  async function loadCourse(code: string) {
    if (!code.trim()) return setCourse(null);
    const res = await adminCourseInfo(code);
    if (!res.ok) {
      setCourse(null);
      setMessage({ kind: "error", text: res.error });
      return;
    }
    setMessage(null);
    setCourse({ code: res.courseCode, sections: res.sections });
  }

  // Sessions to choose from: the chosen section's (or every section's)
  // weekly slots, narrowed to the chosen date's weekday once there is one.
  const slots = (course?.sections ?? [])
    .filter((s) => form.section === "" || s.section === form.section)
    .flatMap((s) => s.slots)
    .filter((s) => !form.date || s.weekday === isoWeekday(form.date))
    .filter((s, i, all) => all.findIndex((o) => o.weekday === s.weekday && o.startTime === s.startTime) === i)
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));

  function edit(e: AdminEvent) {
    setForm({
      id: e.id,
      courseCode: displayCourseCode(e.courseCode),
      section: e.section ?? "",
      type: e.type,
      date: e.date,
      startTime: e.startTime ?? "",
      endTime: e.endTime ?? "",
      room: e.room ?? "",
      title: e.title ?? "",
      note: e.note ?? "",
      status: e.status,
    });
    void loadCourse(e.courseCode);
    setMessage(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const { id, ...values } = form;
    startTransition(async () => {
      const res = await saveEvent(id, values);
      if (!res.ok) return setMessage({ kind: "error", text: res.error });
      setEvents(res.events);
      setMessage({ kind: "ok", text: id ? "Güncellendi." : "Eklendi. Takvimler bir sonraki yenilemede güncellenecek." });
      setForm(emptyForm());
      setCourse(null);
    });
  }

  function remove(id: number) {
    startTransition(async () => {
      const res = await removeEvent(id);
      setConfirmDelete(null);
      if (!res.ok) return setMessage({ kind: "error", text: res.error });
      setEvents(res.events);
      setMessage({ kind: "ok", text: "Silindi." });
      if (form.id === id) setForm(emptyForm());
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => e.date >= today);
  const past = events.filter((e) => e.date < today).reverse();
  const courseName = course?.sections.find((s) => s.courseName)?.courseName;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
        <span>
          Dönem: {semester.name} ({semester.startDate} – {semester.endDate})
        </span>
        <button
          type="button"
          onClick={() => startTransition(async () => {
            await logout();
            router.refresh();
          })}
          className="underline"
        >
          Çıkış
        </button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="font-medium">{form.id ? "Olayı düzenle" : "Yeni olay"}</h2>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Ders kodu
            <input
              className={inputClass}
              placeholder="COMP 201"
              value={form.courseCode}
              onChange={(e) => {
                set({ courseCode: e.target.value, section: "", startTime: "" });
                setCourse(null);
              }}
              onBlur={(e) => void loadCourse(e.target.value)}
              autoCapitalize="characters"
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Section
            <select
              className={inputClass}
              value={form.section}
              onChange={(e) => set({ section: e.target.value, startTime: "" })}
            >
              <option value="">Tüm section&apos;lar</option>
              {course?.sections.map((s) => (
                <option key={s.section} value={s.section}>
                  Section {s.section}
                </option>
              ))}
            </select>
          </label>
        </div>
        {courseName && <p className="text-sm text-zinc-500">{courseName}</p>}
        {course && course.sections.length === 0 && (
          <p className="text-sm text-amber-700 dark:text-amber-400">Bu ders veritabanında yok.</p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Tür
            <select
              className={inputClass}
              value={form.type}
              onChange={(e) => set({ type: e.target.value as EventType, startTime: "", endTime: "" })}
            >
              {Object.entries(TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tarih
            <input
              type="date"
              className={inputClass}
              min={semester.startDate}
              max={semester.endDate}
              value={form.date}
              onChange={(e) => set({ date: e.target.value, ...(isSessionChange(form.type) ? { startTime: "" } : {}) })}
              required
            />
          </label>
        </div>

        {isSessionChange(form.type) ? (
          <label className="flex flex-col gap-1 text-sm">
            Oturum
            <select className={inputClass} value={form.startTime} onChange={(e) => set({ startTime: e.target.value })}>
              <option value="">O günün tüm oturumları</option>
              {slots.map((s) => (
                <option key={`${s.weekday}-${s.startTime}`} value={s.startTime}>
                  {s.kind === "lab" ? "🧪 Lab" : "Ders"} – {WEEKDAYS[s.weekday - 1]} {s.startTime}–{s.endTime}
                  {s.room ? ` (${s.room})` : ""}
                </option>
              ))}
            </select>
            {form.date && course && slots.length === 0 && (
              <span className="text-amber-700 dark:text-amber-400">Bu tarihte bu dersin oturumu yok.</span>
            )}
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Başlık {form.type === "exam" ? "(ör. Vize, Final)" : "(isteğe bağlı)"}
              <input className={inputClass} value={form.title} onChange={(e) => set({ title: e.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1 text-sm">
                Başlangıç (boş = tüm gün)
                <input type="time" className={inputClass} value={form.startTime} onChange={(e) => set({ startTime: e.target.value })} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Bitiş (isteğe bağlı)
                <input type="time" className={inputClass} value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} />
              </label>
            </div>
          </>
        )}

        {(form.type === "room_change" || !isSessionChange(form.type)) && (
          <label className="flex flex-col gap-1 text-sm">
            {form.type === "room_change" ? "Yeni sınıf" : "Sınıf (isteğe bağlı)"}
            <input
              className={inputClass}
              value={form.room}
              onChange={(e) => set({ room: e.target.value })}
              required={form.type === "room_change"}
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          Not (isteğe bağlı, takvimde açıklamada görünür)
          <textarea className={inputClass} rows={2} value={form.note} onChange={(e) => set({ note: e.target.value })} />
        </label>

        <fieldset className="flex gap-4 text-sm">
          {(["confirmed", "unconfirmed"] as const).map((status) => (
            <label key={status} className="flex items-center gap-1">
              <input
                type="radio"
                name="status"
                checked={form.status === status}
                onChange={() => set({ status })}
              />
              {status === "confirmed" ? "Kesin" : "Belirsiz (❓)"}
            </label>
          ))}
        </fieldset>

        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={`text-sm ${message.kind === "error" ? "text-red-600" : "text-emerald-700 dark:text-emerald-400"}`}
          >
            {message.text}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={pending}
            className="flex-1 rounded-md bg-zinc-900 py-2 font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "Kaydediliyor…" : form.id ? "Güncelle" : "Ekle"}
          </button>
          {form.id && (
            <button
              type="button"
              onClick={() => {
                setForm(emptyForm());
                setCourse(null);
              }}
              className="rounded-md border border-zinc-300 px-4 dark:border-zinc-700"
            >
              Vazgeç
            </button>
          )}
        </div>
      </form>

      <EventList title="Yaklaşan" events={upcoming} onEdit={edit} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} onDelete={remove} />
      {past.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-zinc-500">Geçmiş olaylar ({past.length})</summary>
          <div className="mt-3 opacity-70">
            <EventList title="" events={past} onEdit={edit} confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} onDelete={remove} />
          </div>
        </details>
      )}
    </div>
  );
}

function EventList({
  title,
  events,
  onEdit,
  confirmDelete,
  setConfirmDelete,
  onDelete,
}: {
  title: string;
  events: AdminEvent[];
  onEdit: (e: AdminEvent) => void;
  confirmDelete: number | null;
  setConfirmDelete: (id: number | null) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      {title && <h2 className="font-medium">{title}</h2>}
      {events.length === 0 && <p className="text-sm text-zinc-500">Olay yok.</p>}
      <ul className="flex flex-col gap-2">
        {events.map((e) => (
          <li key={e.id} className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{formatDate(e.date)}</span>
              <span>
                {displayCourseCode(e.courseCode)} · {e.section ? `Section ${e.section}` : "Tüm section'lar"}
              </span>
              {e.status === "unconfirmed" && <span className="text-amber-700 dark:text-amber-400">❓ Belirsiz</span>}
            </div>
            <div>
              {TYPE_LABELS[e.type]}
              {isSessionChange(e.type)
                ? ` · ${e.startTime ? `${e.startTime} oturumu` : "o günün tüm oturumları"}`
                : `${e.title ? ` · ${e.title}` : ""}${e.startTime ? ` · ${e.startTime}${e.endTime ? `–${e.endTime}` : ""}` : " · tüm gün"}`}
              {e.room ? ` · ${e.room}` : ""}
            </div>
            {e.note && <div className="text-zinc-600 dark:text-zinc-400">{e.note}</div>}
            <div className="flex gap-3">
              <button type="button" onClick={() => onEdit(e)} className="text-blue-600">
                Düzenle
              </button>
              {confirmDelete === e.id ? (
                <>
                  <button type="button" onClick={() => onDelete(e.id)} className="font-medium text-red-600">
                    Evet, sil
                  </button>
                  <button type="button" onClick={() => setConfirmDelete(null)} className="text-zinc-500">
                    Vazgeç
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmDelete(e.id)} className="text-red-600">
                  Sil
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
