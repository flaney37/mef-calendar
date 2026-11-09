import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { loadEditData } from "@/lib/db/queries";
import { TOKEN_PATTERN } from "@/lib/token";
import { EditPanel } from "./edit-panel";

export const metadata: Metadata = {
  title: "Programını düzenle · MEF Ders Takvimi",
  // The URL itself is the password: keep it out of search engines and out
  // of the Referer header sent to other sites.
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// Not async: the heading is part of the static shell, and only the part
// that needs the token (runtime data) waits inside <Suspense>.
export default function EditPage({ params }: PageProps<"/edit/[editToken]">) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">Programını düzenle</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Değişiklikler takvim bağlantını değiştirmez; abone olduğun takvim kendiliğinden
          güncellenir.
        </p>
      </header>
      <Suspense fallback={<p className="text-zinc-500">Yükleniyor…</p>}>
        <EditLoader params={params} />
      </Suspense>
    </main>
  );
}

async function EditLoader({ params }: { params: PageProps<"/edit/[editToken]">["params"] }) {
  const { editToken } = await params;
  if (!TOKEN_PATTERN.test(editToken)) notFound();
  const data = await loadEditData(editToken);
  if (!data) notFound();
  return <EditPanel editToken={editToken} feedToken={data.feedToken} courses={data.courses} />;
}
