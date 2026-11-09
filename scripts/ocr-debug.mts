// Runs the same OCR + extraction as the browser on a local image, to debug
// screenshots that don't read well.
// Usage: pnpm ocr:debug <image> [--list-only]
//
// --list-only: second pass like the browser does, OCR only the region from
// the "DERS KODU" header down (pass a larger upscaled image for this).
//
// Prints only the text below the "DERS KODU" header (the course list), never
// the top of the page with the student's name and TC Kimlik No.
import { createWorker } from "tesseract.js";
import { findCourseRows } from "../lib/extract";

const [image, flag] = process.argv.slice(2);
if (!image) throw new Error("Usage: pnpm ocr:debug <image> [--list-only]");

const worker = await createWorker("eng", undefined, { cachePath: "node_modules/.cache/tesseract" });
let { data } = await worker.recognize(image, {}, { text: true, blocks: true });

if (flag === "--list-only") {
  const lines = (data.blocks ?? []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines));
  const header = lines.find((l) => /DERS\s*KODU/i.test(l.text));
  if (!header) throw new Error("header not found in first pass");
  const { y0 } = header.bbox;
  const height = Math.max(...lines.map((l) => l.bbox.y1)) - y0 + 20;
  const width = Math.max(...lines.map((l) => l.bbox.x1)) + 20;
  console.log(`second pass on rectangle y=${y0} h=${height} w=${width}`);
  ({ data } = await worker.recognize(image, { rectangle: { top: y0 - 10, left: 0, width, height } }));
}
await worker.terminate();

const lines = data.text.split("\n");
const header = lines.findIndex((l) => /DERS\s*KODU/i.test(l));
console.log(`confidence ${data.confidence}, header ${header >= 0 ? "found" : "NOT found"}`);
if (header >= 0) console.log(lines.slice(header).filter(Boolean).join("\n"));
console.log("rows:", findCourseRows(data.text).map((r) => `${r.code}-${r.section}`).join(" ") || "(none)");
