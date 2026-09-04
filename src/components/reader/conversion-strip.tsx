"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";

// Conversion status under the pages of a handwritten document (SPEC.md §16).
// Conversion starts on its own at import; this strip shows Converting…, the
// failure reason with Retry, or the Converted text header with Convert again.
// The auto-fire covers documents whose import-time kick-off died. OFF = the
// reader said not to convert: no auto-fire, the strip offers Convert to text.

export type ConversionInfo = {
  status: "NONE" | "PENDING" | "READY" | "FAILED" | "OFF";
  error: string | null;
  stale: boolean; // PENDING older than 10 minutes: a dead run
};

export function ConversionStrip({
  documentId,
  conversion,
  hasText,
  canEdit,
}: {
  documentId: string;
  conversion: ConversionInfo;
  hasText: boolean; // the document has converted text blocks
  canEdit: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoFired = useRef(false);

  async function convert() {
    if (converting) return;
    setConverting(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${documentId}/convert`, { method: "POST" });
      // 409 = a run started elsewhere (the import already kicked one off); benign.
      if (!res.ok && res.status !== 409) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("common.requestFailedStatus", { status: res.status }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setConverting(false);
      router.refresh();
    }
  }

  // Adding the document already starts conversion server-side; this covers
  // documents from before that, and runs where the kick-off died.
  useEffect(() => {
    if (autoFired.current || !canEdit || hasText || conversion.status !== "NONE") return;
    autoFired.current = true;
    void convert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = converting || (conversion.status === "PENDING" && !conversion.stale);
  const failed =
    error ??
    (conversion.status === "FAILED" ? (conversion.error ?? t("panes.convertFailedPlain")) : null);
  const retryable = !running && canEdit && (failed !== null || conversion.stale);

  const buttonClass =
    "rounded-full bg-card px-3.5 py-1 text-xs font-semibold text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40";

  return (
    <div className="my-8 print:hidden">
      {running ? (
        <p className="flex items-center gap-2 text-[13px] text-sand-600">
          <span aria-hidden className="size-2 animate-pulse rounded-full bg-clay-400" />
          {t("panes.converting")}
        </p>
      ) : failed !== null || conversion.stale ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="text-[13px] text-red-600">
            {t("panes.convertFailed", { reason: failed ?? t("panes.convertStalled") })}
          </p>
          {retryable && (
            <button onClick={() => void convert()} data-track="convert-retry" className={buttonClass}>
              {t("common.retry")}
            </button>
          )}
        </div>
      ) : hasText ? (
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] font-bold tracking-[0.09em] text-clay-700 uppercase">
            {t("panes.convertedText")}
          </span>
          {canEdit && (
            <button onClick={() => void convert()} data-track="convert-again" data-tip={t("panes.convertAgainTitle")} className={buttonClass}>
              {t("panes.convertAgain")}
            </button>
          )}
        </div>
      ) : canEdit ? (
        <button onClick={() => void convert()} data-track="convert-to-text" data-tip={t("panes.convertToTextTitle")} className={buttonClass}>
          {t("panes.convertToText")}
        </button>
      ) : null}
    </div>
  );
}
