"use client";

import { formatBytes } from "@/lib/bytes";
import type { AccountStorage } from "@/lib/storage";
import { useT } from "@/components/lang-provider";

// Storage in Settings (TIERS.md): one bar for the account's files — the
// documents, the images, and the videos, each its own color in the bar —
// against the tier's limit, and one line saying how much is used. While the
// tier has no limit set (lib/tiers.ts) the bar stays empty and the line says
// so; the limit is one number to set later.
export function StorageBar({
  storage,
  limit,
  tierName,
}: {
  storage: AccountStorage;
  /** The tier's storage limit in bytes; null = not set yet. */
  limit: number | null;
  /** The tier's name, for the line while no limit is set. */
  tierName: string;
}) {
  const t = useT();
  const scale = limit && limit > 0 ? limit : 0;
  const width = (bytes: number) => (scale ? `${Math.min(100, (bytes / scale) * 100)}%` : "0%");
  // The note colors, one per kind (globals.css .text-color-*).
  const kinds = [
    { key: "documents", bytes: storage.documents, label: t("settings.storageDocuments"), color: "var(--clay)" },
    { key: "images", bytes: storage.images, label: t("settings.storageImages"), color: "var(--sage-600)" },
    { key: "videos", bytes: storage.videos, label: t("settings.storageVideos"), color: "#a78bfa" },
  ];
  const over = limit !== null && storage.used > limit;
  return (
    <div className="space-y-2.5 rounded-2xl bg-card p-5 shadow-soft">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold text-sand-800">{t("settings.storage")}</span>
        <span className={`text-xs ${over ? "text-red-500" : "text-sand-600"}`}>
          {limit === null
            ? t("settings.storageUsed", { used: formatBytes(storage.used) })
            : t("settings.storageOf", { used: formatBytes(storage.used), limit: formatBytes(limit) })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("settings.storage")}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-valuenow={storage.used}
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-sand-200"
      >
        {kinds.map((kind) => (
          <span key={kind.key} className="h-full" style={{ width: width(kind.bytes), background: kind.color }} />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-sand-600">
        {kinds.map((kind) => (
          <span key={kind.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-full" style={{ background: kind.color }} />
            {kind.label} · {formatBytes(kind.bytes)}
          </span>
        ))}
      </div>
      {limit === null && (
        <p className="text-[11px] text-sand-500">{t("settings.storageNoLimit", { tier: tierName })}</p>
      )}
    </div>
  );
}
