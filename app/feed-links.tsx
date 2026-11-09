"use client";

import { useSyncExternalStore, useState } from "react";

export const inputClass =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-base dark:border-zinc-700 dark:bg-zinc-900";

// window.location only exists in the browser; during server rendering we
// fall back to an empty origin and the real one fills in after hydration.
const subscribe = () => () => {};
function useOrigin() {
  return useSyncExternalStore(
    subscribe,
    () => window.location.origin,
    () => "",
  );
}

export function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        <input readOnly value={value} className={`${inputClass} font-mono text-sm`} />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
          }}
          className="shrink-0 rounded-md border border-zinc-300 px-3 text-sm dark:border-zinc-700"
        >
          {copied ? "Kopyalandı" : "Kopyala"}
        </button>
      </div>
    </div>
  );
}

export function FeedLinks({ feedToken, editToken }: { feedToken: string; editToken?: string }) {
  const origin = useOrigin();
  const https = `${origin}/cal/${feedToken}.ics`;
  const webcal = https.replace(/^https?:/, "webcal:");

  return (
    <div className="flex flex-col gap-4">
      <a
        href={webcal}
        className="rounded-md bg-zinc-900 py-3 text-center font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        iPhone / Mac: Takvime abone ol
      </a>
      <CopyRow label="Google Takvim / Outlook için bağlantı" value={https} />
      {editToken && <CopyRow label="Düzenleme bağlantısı" value={`${origin}/edit/${editToken}`} />}
    </div>
  );
}
