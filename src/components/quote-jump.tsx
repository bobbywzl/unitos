"use client";

import { QuoteIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";

const TIP_MAX = 180;

/** The quote symbol in a kind box's head (SPEC.md §6, globals.css
    .kind-box): it stands for the words the annotation is anchored to. Its
    tooltip shows the words, and a click jumps to them in the reader. With
    nowhere to jump (the anchor no longer resolves, the document is gone) it
    shows the words alone. */
export function QuoteJump({
  quote,
  onJump,
  track,
  className = "",
}: {
  quote: string;
  onJump?: () => void;
  track: string;
  className?: string;
}) {
  const t = useT();
  const words = quote.replace(/\s+/g, " ").trim();
  if (!words) return null;
  const clipped = words.length > TIP_MAX ? `${words.slice(0, TIP_MAX - 1)}…` : words;
  const tip = t(onJump ? "outline.annotationQuoteJump" : "outline.annotationQuote", { quote: clipped });
  return (
    <button
      type="button"
      data-track={track}
      data-no-drag
      data-tip={tip}
      aria-label={tip}
      aria-disabled={onJump ? undefined : true}
      className={`kind-box-quote ${className}`}
      onClick={(e) => {
        e.stopPropagation();
        onJump?.();
      }}
    >
      <QuoteIcon size={12} />
    </button>
  );
}
