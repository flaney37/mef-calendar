import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 py-10">
      <h2 className="text-xl font-semibold">Sayfa bulunamadı</h2>
      <p className="text-zinc-600 dark:text-zinc-400">
        Bağlantı yanlış ya da kayıt silinmiş olabilir. Bağlantıyı eksiksiz kopyaladığından emin ol.
      </p>
      <Link href="/" className="text-blue-600">
        Ana sayfaya dön
      </Link>
    </div>
  );
}
