"use client";

import { useState } from "react";
import type { EditCourse } from "@/lib/db/queries";
import { ScheduleForm } from "./schedule-form";
import { ScreenshotImport } from "./screenshot-import";

// Home page body: OCR import on top, the review/manual form below. A new
// OCR result remounts the form (new key) so it starts from those courses.
export function NewSchedule() {
  const [imported, setImported] = useState<{ key: number; courses: EditCourse[] }>({
    key: 0,
    courses: [],
  });

  return (
    <div className="flex flex-col gap-6">
      <ScreenshotImport
        onCourses={(courses) => setImported((prev) => ({ key: prev.key + 1, courses }))}
      />
      <ScheduleForm key={imported.key} initialCourses={imported.courses} />
    </div>
  );
}
