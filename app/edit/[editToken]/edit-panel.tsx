"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type { EditCourse } from "@/lib/db/queries";
import type { VolunteerStatus } from "@/lib/db/volunteers";
import { VolunteerSection } from "./volunteer-section";
import { deleteSchedule, rotateFeed } from "../../actions";
import { FeedLinks } from "../../feed-links";
import { ScheduleForm } from "../../schedule-form";

const sectionClass = "flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";

export function EditPanel({
  editToken,
  feedToken: initialFeedToken,
  courses,
  volunteer,
}: {
  editToken: string;
  feedToken: string;
  courses: EditCourse[];
  volunteer: VolunteerStatus;
}) {
  const [feedToken, setFeedToken] = useState(initialFeedToken);
  const [rotated, setRotated] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (deleted) {
    return (
      <div className="flex flex-col gap-3">
        <p>Kaydın silindi. Takvim bağlantın artık çalışmıyor; aboneliği takviminden de kaldırabilirsin.</p>
        <Link href="/" className="text-blue-600">
          Ana sayfaya dön
        </Link>
      </div>
    );
  }

  const rotate = () =>
    startTransition(async () => {
      const res = await rotateFeed(editToken);
      setConfirmRotate(false);
      if (!res.ok) return setError(res.error);
      setFeedToken(res.feedToken);
      setRotated(true);
    });

  const remove = () =>
    startTransition(async () => {
      const res = await deleteSchedule(editToken);
      if (!res.ok) return setError(res.error);
      setDeleted(true);
    });

  return (
    <div className="flex flex-col gap-6">
      <section className={sectionClass}>
        <h2 className="font-medium">Takvim bağlantın</h2>
        <FeedLinks feedToken={feedToken} />
        {rotated && (
          <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
            Yeni bağlantı oluşturuldu. Eski bağlantı artık çalışmıyor: eski aboneliği kaldırıp
            yukarıdaki bağlantıya yeniden abone ol.
          </p>
        )}
        {confirmRotate ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Eski bağlantı çalışmayı bırakacak. Emin misin?</span>
            <button type="button" disabled={pending} onClick={rotate} className="font-medium text-amber-700">
              Evet, yenile
            </button>
            <button type="button" onClick={() => setConfirmRotate(false)} className="text-zinc-500">
              Vazgeç
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRotate(true)}
            className="self-start text-sm text-zinc-600 underline dark:text-zinc-400"
          >
            Bağlantımı yenile (biriyle paylaştıysan)
          </button>
        )}
      </section>

      <ScheduleForm editToken={editToken} initialCourses={courses} />

      <VolunteerSection editToken={editToken} status={volunteer} sections={courses} />

      <section className={sectionClass}>
        <h2 className="font-medium">Kaydımı sil</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Derslerin ve takvim bağlantın silinir. Bu geri alınamaz.
        </p>
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Emin misin?</span>
            <button type="button" disabled={pending} onClick={remove} className="font-medium text-red-600">
              Evet, sil
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="text-zinc-500">
              Vazgeç
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="self-start text-sm text-red-600"
          >
            Kaydımı sil
          </button>
        )}
      </section>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
