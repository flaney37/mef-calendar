import { ScheduleForm } from "./schedule-form";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">MEF Ders Takvimi</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Derslerini gir, kişisel takvim bağlantını al. İptaller, sınavlar ve sınıf
          değişiklikleri takvimine kendiliğinden düşsün.
        </p>
      </header>
      <ScheduleForm />
    </main>
  );
}
