"use client";

import type { TierState } from "@/lib/tiers";
import { useLang, useT } from "@/components/lang-provider";

// The tier mark (TIERS.md): the symbol that says an account's tier wherever
// the account shows — beside the person's badge, in the dashboard header,
// in the reader header, under Plan in Settings, on the admin accounts page.
// Unitos Ultra is the black diamond. Unitos Premium is the white crystal;
// on a trial the crystal is the same, and after the trial ends it is hollow.
// One drawing per tier, at every size, so the mark is learned once.

// Which of the two drawings a state shows, and how.
export function tierLook(state: TierState): "ultra" | "premium" | "expired" {
  return state === "ultra" ? "ultra" : state === "expired" ? "expired" : "premium";
}

export function TierMark({
  state,
  size = 14,
  className,
}: {
  state: TierState;
  size?: number;
  className?: string;
}) {
  const look = tierLook(state);
  if (look === "ultra") {
    // The black diamond: a brilliant cut seen from the side — crown, girdle,
    // pavilion — in obsidian, a gold hairline so it reads on a dark ground,
    // one white glint on the crown.
    return (
      <svg
        aria-hidden
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={`tier-mark tier-mark-ultra shrink-0 ${className ?? ""}`}
      >
        <path d="M7 4h10l4.5 5.5L12 21 2.5 9.5Z" fill="#1a1713" />
        <path d="M7 4h10l-2 5.5H9Z" fill="#5a524a" />
        <path d="M2.5 9.5 7 4l2 5.5Z" fill="#3a342e" />
        <path d="M21.5 9.5 17 4l-2 5.5Z" fill="#3a342e" />
        <path d="M9 9.5h6L12 21Z" fill="#433c35" />
        <path d="M7 4h10l4.5 5.5L12 21 2.5 9.5Z" fill="none" stroke="#d6b26a" strokeOpacity="0.9" strokeWidth="1" strokeLinejoin="round" />
        <path d="M2.5 9.5h19" stroke="#d6b26a" strokeOpacity="0.6" strokeWidth="0.7" />
        <path d="M8.6 6.3 10 5.2" stroke="#fff" strokeOpacity="0.9" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
    );
  }
  if (look === "expired") {
    // The white crystal, hollow: the trial ended and nothing was granted.
    return (
      <svg
        aria-hidden
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={`tier-mark tier-mark-expired shrink-0 ${className ?? ""}`}
      >
        <path d="M12 2l6 6v9l-6 5-6-5V8Z" fill="none" stroke="currentColor" strokeOpacity="0.55" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M12 2v20M6 8l6 3.5L18 8" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="0.8" />
      </svg>
    );
  }
  // The white crystal: a quartz point — two long faces and a bright inner
  // facet — in white and pale sand, a thin sand hairline so it reads on
  // paper and on a white card.
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`tier-mark tier-mark-premium shrink-0 ${className ?? ""}`}
    >
      <path d="M12 2l6 6v9l-6 5-6-5V8Z" fill="#ffffff" />
      <path d="M12 2v20l6-5V8Z" fill="#e9e3d8" />
      <path d="M12 2l6 6-6 3.5Z" fill="#f7f4ee" />
      <path d="M12 2 6 8l6 3.5Z" fill="#ffffff" />
      <path d="M12 11.5V22l-6-5V8Z" fill="#f3efe7" />
      <path d="M12 2l6 6v9l-6 5-6-5V8Z" fill="none" stroke="#a89c88" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M6 8l6 3.5L18 8M12 11.5V22" fill="none" stroke="#b9ad99" strokeOpacity="0.8" strokeWidth="0.7" />
      <path d="M9.2 6.2 11 4.4" stroke="#fff" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

// The tier's name: "Unitos Ultra" or "Unitos Premium", and on a trial or
// after it, the trial's end.
export function useTierLabel(): (state: TierState, trialEndsAt: string | null) => string {
  const t = useT();
  const lang = useLang();
  // UTC on both server and client, so the first render matches.
  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-GB", {
      year: "numeric",
      month: "long",
      day: "numeric",
      timeZone: "UTC",
    });
  return (state, trialEndsAt) => {
    if (state === "ultra") return t("common.tierUltra");
    if (state === "premium") return t("common.tierPremium");
    const date = trialEndsAt ? fmtDate(trialEndsAt) : "";
    return t(state === "trial" ? "common.tierTrial" : "common.tierExpired", { date });
  };
}

// The tier chip: the mark and the tier's name in one pill. Ultra is obsidian
// with a gold hairline; Premium is pearl; expired is plain sand. Short keeps
// the chip to the tier's name — a header has no room for the trial's end —
// and puts the whole label in the tooltip.
export function TierChip({
  state,
  trialEndsAt,
  size = "sm",
  short,
  className,
}: {
  state: TierState;
  // ISO date, for a trial's end.
  trialEndsAt: string | null;
  size?: "sm" | "md";
  short?: boolean;
  className?: string;
}) {
  const t = useT();
  const label = useTierLabel();
  const look = tierLook(state);
  const full = label(state, trialEndsAt);
  const text = short ? t(state === "ultra" ? "common.tierUltra" : "common.tierPremium") : full;
  return (
    <span
      className={`tier-chip tier-chip-${look} ${size === "md" ? "tier-chip-md" : ""} ${className ?? ""}`}
      data-tip={full}
    >
      <TierMark state={state} size={size === "md" ? 16 : 13} />
      <span className="truncate">{text}</span>
    </span>
  );
}

// The band over a page: a hairline at the top in the tier's material. The
// dashboard and the reader show it. Expired shows none.
export function TierBand({ state }: { state: TierState }) {
  const look = tierLook(state);
  if (look === "expired") return null;
  return <div aria-hidden className={`tier-band tier-band-${look}`} />;
}
