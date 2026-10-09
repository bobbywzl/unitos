"use client";

import { useT } from "@/components/lang-provider";

// Clear conversation (SPEC.md §21): the one way a kept conversation goes
// (lib/kept-chat.ts). It asks nothing, as every delete: the turns leave at
// once and the Undo pill puts them back; the server's copy goes when the
// pill goes.
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
      onClick={onClear}
      data-track={track}
      data-tip={t("assistant.clearConversationTitle")}
      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] text-sand-600 hover:bg-clay-100 hover:text-clay-800 ${className}`}
    >
      {t("assistant.clearConversation")}
    </button>
  );
}
