"use client";

import { useT } from "@/components/lang-provider";

// The queue (SPEC.md §7): the messages sent while an answer runs, under the
// thread, faded, each with ✕ to remove it. One list for every assistant
// chat — the reader's card and its side chats, tool conversations, the
// media pane's assistant; the panel draws its own, since its messages carry
// images and files.
export type QueuedText = { key: string; content: string };

export function queuedKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function QueuedList({
  items,
  onRemove,
  className = "",
}: {
  items: QueuedText[];
  onRemove: (key: string) => void;
  className?: string;
}) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <div className={`flex flex-col items-end gap-1.5 ${className}`}>
      <span className="text-[10px] font-bold tracking-[0.08em] text-sand-500 uppercase">
        {t("assistant.queued", { n: String(items.length) })}
      </span>
      {items.map((m) => (
        <div key={m.key} className="ml-6 flex max-w-full items-start gap-1.5">
          <p className="rounded-2xl bg-clay-100 px-3 py-1.5 text-[12.5px] whitespace-pre-wrap text-clay-800 opacity-60">
            {m.content}
          </p>
          <button
            type="button"
            onClick={() => onRemove(m.key)}
            data-track="assistant-queue-remove"
            aria-label={t("assistant.removeQueued")}
            data-tip={t("assistant.removeQueued")}
            className="mt-1 text-sand-500 hover:text-clay-800"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
