// Runs the same OCR + extraction as the browser on a local image, to debug
// screenshots that don't read well.
// Usage: pnpm ocr:debug <image> [scale]
//
// Prints only the text below the "DERS KODU" header (the course list), never
// the top of the page with the student's name and TC Kimlik No.
import { createWorker } from "tesseract.js";
import { findCourseRows } from "../lib/extract";

const [image] = process.argv.slice(2);
if (!image) throw new Error("Usage: pnpm ocr:debug <image>");

const worker = await createWorker("eng", undefined, { cachePath: "node_modules/.cache/tesseract" });
const { data } = await worker.recognize(image);
await worker.terminate();

const lines = data.text.split("\n");
const header = lines.findIndex((l) => /DERS\s*KODU/i.test(l));
console.log(`confidence ${data.confidence}, header ${header >= 0 ? "found" : "NOT found"}`);
if (header >= 0) console.log(lines.slice(header).filter(Boolean).join("\n"));
console.log("rows:", findCourseRows(data.text).map((r) => `${r.code}-${r.section}`).join(" ") || "(none)");
