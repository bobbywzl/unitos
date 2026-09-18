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

const MODES: { id: Thinking; labelKey: TKey; hintKey: TKey }[] = [
  { id: "fast", labelKey: "assistant.thinkingFast", hintKey: "assistant.thinkingFastHint" },
  { id: "deep", labelKey: "assistant.thinkingDeep", hintKey: "assistant.thinkingDeepHint" },
];

/** The reader's thinking choice, read where an assistant request is sent. The
    server's render and the first client render agree on Deep. */
export function useThinking(): Thinking {
  return useSyncExternalStore(subscribeThinking, readThinking, () => DEFAULT_THINKING);
}

/** The two thinking options (SPEC.md §7). The same pair on every assistant
    surface: the panel, the reader's chat, the media pane's chat. One choice for
    the whole app, so picking one here picks it everywhere. */
export function ThinkingChips({ className = "", small = false }: { className?: string; small?: boolean }) {
  const t = useT();
  const thinking = useThinking();
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      {MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => writeThinking(m.id)}
          data-track={`assistant-thinking:${m.id}`}
          aria-pressed={thinking === m.id}
          data-tip={t(m.hintKey)}
          className={`rounded-full font-semibold ${
            small ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
          } ${
            thinking === m.id
              ? "bg-ink text-paper"
              : "bg-card text-sand-600 shadow-soft hover:text-clay-800"
          }`}
        >
          {t(m.labelKey)}
        </button>
      ))}
    </div>
  );
}
