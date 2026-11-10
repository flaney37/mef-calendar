"use client";

import { useState, useTransition } from "react";
import { displayCourseCode } from "@/lib/course-code";
import type { VolunteerStatus } from "@/lib/db/volunteers";
import { becomeVolunteer, leaveVolunteering } from "../../actions";

const sectionClass = "flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800";

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "medium", timeStyle: "short" });
}

export function VolunteerSection({
  editToken,
  status: initialStatus,
  sections,
}: {
  editToken: string;
  status: VolunteerStatus;
  sections: { code: string; section: string }[];
}) {
  const [status, setStatus] = useState(initialStatus);
  const [script, setScript] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<"rotate" | "leave" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const issue = () =>
    startTransition(async () => {
      setError(null);
      const res = await becomeVolunteer(editToken);
      setConfirm(null);
      if (!res.ok) return setError(res.error);
      setScript(res.script);
      setCopied(false);
      setStatus((s) => s ?? { since: new Date().toISOString(), lastSeenAt: null });
    });

  const leave = () =>
    startTransition(async () => {
      setError(null);
      const res = await leaveVolunteering(editToken);
      setConfirm(null);
      if (!res.ok) return setError(res.error);
      setStatus(null);
      setScript(null);
    });

  const copy = async () => {
    if (!script) return;
    await navigator.clipboard.writeText(script);
    setCopied(true);
  };

  const covered = sections.map((s) => `${displayCourseCode(s.code)}-${s.section}`).join(", ");

  return (
    <section className={sectionClass}>
      <h2 className="font-medium">İptal maillerini otomatik yakala (gönüllü ol)</h2>

      {!status && (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Okul Gmail hesabında küçük bir script çalıştırırsın. Hocalardan ve Blackboard&apos;dan gelen
            iptal, sınav, online ders gibi duyuruları 10 dakikada bir buraya gönderir; o section&apos;daki
            herkesin takvimi kendiliğinden güncellenir.
          </p>
          <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
            <li>Sadece MEF ve Blackboard&apos;dan gelen, bu tür kelimeler içeren mailler gönderilir.</li>
            <li>Maillerin metni burada saklanmaz; sadece içinden çıkan olay kaydedilir.</li>
            <li>Selamlamadaki isimler (&quot;Merhaba Ad Soyad&quot;) mail Gmail&apos;den çıkmadan silinir.</li>
            <li>Kapsadığın section&apos;lar: {covered || "henüz ders yok"}.</li>
            <li>İstediğin zaman bırakabilirsin.</li>
          </ul>
          <button
            type="button"
            disabled={pending || sections.length === 0}
            onClick={issue}
            className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "Hazırlanıyor…" : "Gönüllü ol"}
          </button>
        </>
      )}

      {status && !script && (
        <>
          <p className="text-sm">
            ✅ Gönüllüsün ({covered}).{" "}
            {status.lastSeenAt
              ? `Script en son ${formatWhen(status.lastSeenAt)} tarihinde mail gönderdi.`
              : "Script henüz hiç mail göndermedi; kurulumu bitirdiysen ilk uygun mailde görünecek."}
          </p>
          {confirm === "rotate" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Eski script çalışmayı bırakacak, yenisini yapıştırman gerekecek. Emin misin?</span>
              <button type="button" disabled={pending} onClick={issue} className="font-medium text-amber-700">
                Evet, yeni kod oluştur
              </button>
              <button type="button" onClick={() => setConfirm(null)} className="text-zinc-500">
                Vazgeç
              </button>
            </div>
          ) : confirm === "leave" ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Script&apos;in gönderdikleri artık kabul edilmeyecek. Emin misin?</span>
              <button type="button" disabled={pending} onClick={leave} className="font-medium text-red-600">
                Evet, bırak
              </button>
              <button type="button" onClick={() => setConfirm(null)} className="text-zinc-500">
                Vazgeç
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-4 text-sm">
              <button type="button" onClick={() => setConfirm("rotate")} className="text-zinc-600 underline dark:text-zinc-400">
                Script kodunu kaybettim / yeni kod oluştur
              </button>
              <button type="button" onClick={() => setConfirm("leave")} className="text-red-600">
                Gönüllülüğü bırak
              </button>
            </div>
          )}
        </>
      )}

      {script && (
        <>
          <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
            Bu kod sana özel bir anahtar içeriyor ve sadece şimdi gösteriliyor. Kimseyle paylaşma; kaybedersen
            buradan yenisini oluşturabilirsin.
          </p>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            <li>
              <b>Okul hesabınla</b> (@mef.edu.tr){" "}
              <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer" className="text-blue-600 underline">
                script.google.com&apos;da yeni proje
              </a>{" "}
              aç.
            </li>
            <li>Açılan Code.gs dosyasının içini tamamen sil, aşağıdaki kodu yapıştır ve kaydet (Ctrl+S).</li>
            <li>
              Üstteki fonksiyon listesinden <code>setup</code>&apos;ı seç, <b>Çalıştır</b>&apos;a bas ve izinleri onayla
              (Gmail&apos;i okuma ve dış bağlantı). Google &quot;doğrulanmamış uygulama&quot; derse: Gelişmiş → projeye git.
            </li>
            <li>
              Bitti. Script artık her 10 dakikada bir çalışır; Yürütme günlüğünde &quot;mef-calendar: N mail
              gönderildi&quot; yazar.
            </li>
          </ol>
          <button
            type="button"
            onClick={copy}
            className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {copied ? "Kopyalandı ✓" : "Kodu kopyala"}
          </button>
          <textarea
            readOnly
            value={script}
            rows={10}
            className="w-full rounded-md border border-zinc-300 bg-zinc-50 p-2 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-900"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" onClick={() => setScript(null)} className="self-start text-sm text-zinc-500">
            Kurdum, kapat
          </button>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </section>
  );
}
