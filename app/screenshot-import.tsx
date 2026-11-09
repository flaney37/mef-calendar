"use client";

import { useState } from "react";
import type { EditCourse } from "@/lib/db/queries";
import { findCourseRows } from "@/lib/extract";
import { coursesFromOcr } from "./actions";

// Small text on a full-page screenshot reads badly, so the image is
// upscaled first. Which scale reads best varies from image to image (one
// misses EE 203, another COMP 205), so it is read twice at two widths and
// the rows are merged; matchToCatalog removes duplicates and junk.
// Measured on a 1280 px SIS screenshot: 3200–4500 px wide works, much
// larger makes it worse (JPEG artifacts grow too).
const PASS_WIDTHS = [3600, 4400];
const MAX_SCALE = 4;
// iPhone Safari refuses canvases above ~16.7 million pixels.
const MAX_PIXELS = 16_000_000;

function drawScaled(bitmap: ImageBitmap, targetWidth: number): HTMLCanvasElement {
  const fit = Math.sqrt(MAX_PIXELS / (bitmap.width * bitmap.height));
  const scale = Math.min(Math.max(1, Math.min(MAX_SCALE, targetWidth / bitmap.width)), fit);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

// Runs entirely in this browser. The image and the OCR text stay in
// memory here; only code / section / course name of the course rows are
// sent on (see CLAUDE.md → Privacy rules). Nothing here is logged.
async function readCourseRows(file: File, onPass: (pass: number) => void) {
  // Loaded on demand: the OCR engine is several MB and most visits don't need it.
  const { createWorker, PSM } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const bitmap = await createImageBitmap(file);
  try {
    // "Single uniform block of text" read the course table most reliably.
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
    const rows = [];
    for (const [i, width] of PASS_WIDTHS.entries()) {
      onPass(i + 1);
      const { data } = await worker.recognize(drawScaled(bitmap, width));
      rows.push(...findCourseRows(data.text));
    }
    return rows;
  } finally {
    bitmap.close();
    await worker.terminate();
  }
}

type Status =
  | { kind: "idle" }
  | { kind: "reading"; pass: number }
  | { kind: "done"; found: number; fromCatalog: number }
  | { kind: "error"; message: string };

export function ScreenshotImport({ onCourses }: { onCourses: (courses: EditCourse[]) => void }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setStatus({ kind: "reading", pass: 0 });
    try {
      const rows = await readCourseRows(file, (pass) => setStatus({ kind: "reading", pass }));
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
        ve section&apos;lar kullanılır.
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
          {status.pass === 0
            ? "Okuma motoru yükleniyor. İlk seferde biraz sürebilir…"
            : `Görüntü okunuyor (${status.pass}/${PASS_WIDTHS.length})…`}
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
