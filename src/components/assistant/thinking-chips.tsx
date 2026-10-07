"use client";

import { useSyncExternalStore } from "react";
import {
  DEFAULT_THINKING,
  readThinking,
  subscribeThinking,
  writeThinking,
  type Thinking,
} from "@/lib/assistant/thinking";
import { useT } from "@/components/lang-provider";
import type { TKey } from "@/lib/i18n/dictionaries";

const MODES: Record<Thinking, { next: Thinking; labelKey: TKey; hintKey: TKey }> = {
  fast: { next: "deep", labelKey: "assistant.thinkingFast", hintKey: "assistant.thinkingFastHint" },
  deep: { next: "fast", labelKey: "assistant.thinkingDeep", hintKey: "assistant.thinkingDeepHint" },
};

/** The reader's thinking choice, read where an assistant request is sent. The
    server's render and the first client render agree on Deep. */
export function useThinking(): Thinking {
  return useSyncExternalStore(subscribeThinking, readThinking, () => DEFAULT_THINKING);
}

/** The thinking choice (SPEC.md §7): one chip that names it, Fast Thinking or
    Deep Thinking; a click switches to the other. The same chip on every
    assistant surface: the panel, the reader's chat, the media pane's chat. One
    choice for the whole app, so switching here switches it everywhere. */
export function ThinkingChips({ className = "", small = false }: { className?: string; small?: boolean }) {
  const t = useT();
  const thinking = useThinking();
  const mode = MODES[thinking];
  return (
    <button
      type="button"
      onClick={() => writeThinking(mode.next)}
      data-track={`assistant-thinking:${mode.next}`}
      data-tip={t(mode.hintKey)}
      className={`shrink-0 rounded-full bg-card font-semibold text-sand-700 shadow-soft hover:text-clay-800 ${
        small ? "px-2.5 py-0.5 text-[11px] pointer-coarse:py-1.5" : "px-3 py-1 text-xs"
      } ${className}`}
    >
      {t(mode.labelKey)}
    </button>
  );
}
