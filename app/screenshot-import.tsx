"use client";

import { useState } from "react";
import type { EditCourse } from "@/lib/db/queries";
import { findCourseRows } from "@/lib/extract";
import { coursesFromOcr } from "./actions";

// Small text on a full-page screenshot reads badly (codes like "coup 201");
// upscaling before OCR fixed every code in tests. Capped so huge phone
// screenshots don't run out of memory.
const TARGET_WIDTH = 4500;
const MAX_SCALE = 3;

async function upscale(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.max(1, Math.min(MAX_SCALE, TARGET_WIDTH / bitmap.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

// Runs entirely in this browser. The image and the OCR text stay in
// memory here; only code / section / course name of the course rows are
// sent on (see CLAUDE.md → Privacy rules). Nothing here is logged.
async function readCourseRows(file: File) {
  // Loaded on demand: the OCR engine is several MB and most visits don't need it.
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const canvas = await upscale(file);
    const { data } = await worker.recognize(canvas);
    return findCourseRows(data.text);
  } finally {
    await worker.terminate();
  }
}

type Status =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "done"; found: number; fromCatalog: number }
  | { kind: "error"; message: string };

export function ScreenshotImport({ onCourses }: { onCourses: (courses: EditCourse[]) => void }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setStatus({ kind: "reading" });
    try {
      const rows = await readCourseRows(file);
      if (rows.length === 0) {
        setStatus({
          kind: "error",
          message:
            "Ders listesi okunamadı. Ekran görüntüsünde sayfanın altındaki ders listesinin (DERS KODU, DERS ADI, SECTION…) göründüğünden emin ol ya da dersleri aşağıya elle gir.",
        });
        return;
      }
      const courses = await coursesFromOcr(rows);
      if (!courses) throw new Error("bad rows");
      onCourses(courses);
      setStatus({
        kind: "done",
        found: courses.length,
        fromCatalog: courses.filter((c) => c.source === "catalog").length,
      });
    } catch {
      setStatus({
        kind: "error",
        message: "Görüntü okunamadı. Tekrar dene ya da dersleri aşağıya elle gir.",
      });
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="font-medium">Ekran görüntüsünden doldur</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        SIS → Ders Programı sayfasının ekran görüntüsünü seç. Görüntü{" "}
        <strong>kendi cihazında okunur</strong>, hiçbir yere yüklenmez; sadece bulunan ders kodları
        ve şubeler kullanılır.
      </p>
      <label className="self-start cursor-pointer rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-700">
        {status.kind === "reading" ? "Okunuyor…" : "Ekran görüntüsü seç"}
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          disabled={status.kind === "reading"}
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = ""; // allow picking the same file again
          }}
        />
      </label>
      {status.kind === "reading" && (
        <p role="status" className="text-sm text-zinc-500">
          Görüntü okunuyor. İlk seferde okuma motoru indirildiği için biraz sürebilir.
        </p>
      )}
      {status.kind === "done" && (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
          ✓ {status.found} ders bulundu ({status.fromCatalog} tanesi ders programından). Aşağıda
          kontrol edip kaydet.
        </p>
      )}
      {status.kind === "error" && (
        <p role="alert" className="text-sm text-amber-700 dark:text-amber-400">
          {status.message}
        </p>
      )}
    </section>
  );
}
