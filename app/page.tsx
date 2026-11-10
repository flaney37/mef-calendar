import Link from "next/link";
import { NewSchedule } from "./new-schedule";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 pb-10 pt-16 sm:pt-10">
      {/* Positioned against the page, not the centred column, so it sits in
          the top-right corner of the window on wide screens too. */}
      <Link
        href="/admin"
        className="absolute right-4 top-4 rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        Admin panel
      </Link>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">MEF Ders Takvimi</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Derslerini gir, kişisel takvim bağlantını al. İptaller, sınavlar ve sınıf
          değişiklikleri takvimine kendiliğinden düşsün.
        </p>
      </header>
      <NewSchedule />
    </main>
  );
}
