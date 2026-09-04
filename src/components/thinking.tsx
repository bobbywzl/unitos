"use client";

import { StopIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

// The model is working. Two shared pieces so every tool shows the same state
// the same way: ThinkingIndicator — a spark that breathes beside a label a
// sheen sweeps left to right, with a Stop pill when the caller can abort the
// run — where a word fits; LoadingDots — three dots that swell in turn — for
// tight spots like buttons and chips.

// Filled version of the workspace sparkle: solid reads better than a 2.75
// stroke at this size while it pulses.
function Spark({ size = 12 }: { size?: number }) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className="thinking-spark shrink-0 text-clay"
    >
      <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
    </svg>
  );
}

export function ThinkingIndicator({
  label,
  className,
  onStop,
  stopLabel,
  stopTitle,
}: {
  label?: string;
  className?: string;
  // Abort the run. Every AI tool passes it where no other Stop control sits,
  // so a reader can always stop a run mid-way (SPEC.md §6).
  onStop?: () => void;
  stopLabel?: string;
  stopTitle?: string;
}) {
  const t = useT();
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex flex-wrap items-center gap-1.5 ${className ?? ""}`}
    >
      <Spark />
      <span className="thinking-label font-medium">{label ?? t("reader.thinking")}</span>
      {onStop && (
        <button
          type="button"
          onClick={onStop}
          data-tip={stopTitle ?? t("reader.stopRunTitle")}
          className="ml-1 inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          <StopIcon size={9} />
          {stopLabel ?? t("common.stop")}
        </button>
      )}
    </span>
  );
}

export function LoadingDots({ label }: { label?: string }) {
  const t = useT();
  return (
    <span role="status" aria-label={label ?? t("reader.loading")} className="inline-flex items-center gap-1">
      <span className="loading-dot" />
      <span className="loading-dot" />
      <span className="loading-dot" />
    </span>
  );
}
