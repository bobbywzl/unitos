"use client";

import { useT } from "@/components/lang-provider";

// Clear conversation (SPEC.md §21): the one way a kept conversation goes
// (lib/kept-chat.ts). It asks first; the conversation cannot be brought back.
export function ClearConversation({
  onClear,
  track,
  className = "",
}: {
  onClear: () => void;
  track: string;
  className?: string;
}) {
  const t = useT();
  return (
    <button
      type="button"
      data-no-drag
      onClick={() => {
        if (confirm(t("assistant.clearConversationConfirm"))) onClear();
      }}
      data-track={track}
      data-tip={t("assistant.clearConversationTitle")}
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] text-sand-600 hover:bg-clay-100 hover:text-clay-800 ${className}`}
    >
      {t("assistant.clearConversation")}
    </button>
  );
}
