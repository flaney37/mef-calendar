import type { Metadata } from "next";
import { Suspense } from "react";
import { currentSemester, listEvents } from "@/lib/db/admin-queries";
import { isAdmin } from "./actions";
import { AdminPanel } from "./admin-panel";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Yönetim · MEF Ders Takvimi",
  robots: { index: false, follow: false },
};

// The heading is static; whether you're logged in depends on the cookie
// (runtime data), so that part waits inside <Suspense>.
export default function AdminPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <h1 className="text-3xl font-semibold">Yönetim</h1>
      <Suspense fallback={<p className="text-zinc-500">Yükleniyor…</p>}>
        <AdminGate />
      </Suspense>
    </main>
  );
}

async function AdminGate() {
  if (!(await isAdmin())) return <LoginForm />;
  const semester = await currentSemester();
  return (
    <AdminPanel
      semester={{ name: semester.name, startDate: semester.startDate, endDate: semester.endDate }}
      initialEvents={await listEvents(semester.id)}
    />
  );
}
