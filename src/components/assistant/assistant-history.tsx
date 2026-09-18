"use client";

import Link from "next/link";
import type { ToolKind } from "@/lib/conversation";
import { imageUrl } from "@/lib/images";
import type { TKey } from "@/lib/i18n/dictionaries";
import type { Person } from "@/lib/person";
import { PersonBadge } from "@/components/collab/person-badge";
import { useT } from "@/components/lang-provider";
import { PaperclipIcon } from "@/components/icons";
import { Markdown } from "@/components/markdown";

// One conversation of the assistant history page (SPEC.md §7). A user turn
// carries the attachments the transcript embedded (lib/assistant/attachments.ts).
export type HistoryConversation = {
  id: string;
  kind: "assistant" | ToolKind;
  // Where the conversation comes from (SPEC.md §7): the sidebar assistant
  // (the assistant tab of the side panel, anchored nowhere), the selection
  // chat (the popover's assistant on a highlighted text), or a tool card
  // continued into a conversation (SPEC.md §21).
  origin: "sidebar" | "selection" | "tool";
  // The highlighted text the conversation started from; null for the
  // sidebar assistant's own conversation.
  anchor: {
    documentId: string;
    documentTitle: string;
    sourceId: string;
    quotedText: string;
    orphaned: boolean;
  } | null;
  updatedAt: string; // ISO
  // The contributor who started the conversation (SPEC.md §19); null before
  // attribution existed. The badge renders on shared projects only.
  authorId: string | null;
  turns: (
    | { role: "assistant"; content: string }
    | {
        role: "user";
        content: string;
        images: { id: string; name: string }[];
        files: { name: string }[];
      }
  )[];
};

// The title each kind carries: the assistant's own, or the tool with its
// plus (the same names the Annotations tab uses, SPEC.md §21).
const KIND_TITLE: Record<HistoryConversation["kind"], TKey> = {
  assistant: "panels.assistant",
  explain: "reader.explainPlus",
  simplify: "reader.simplifyPlus",
  analyze: "reader.analyzePlus",
  visualize: "reader.visualizePlus",
};

// The origin line each conversation carries: where it comes from, in the
// reader's words, and what the reader can do with it.
const ORIGIN_LABEL: Record<HistoryConversation["origin"], TKey> = {
  sidebar: "assistant.historyOriginSidebar",
  selection: "assistant.historyOriginSelection",
  tool: "assistant.historyOriginTool",
};
const ORIGIN_HINT: Record<HistoryConversation["origin"], TKey> = {
  sidebar: "assistant.historyOriginSidebarHint",
  selection: "assistant.historyOriginSelectionHint",
  tool: "assistant.historyOriginToolHint",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Every conversation as its own panel, newest first: the kind, where it
// comes from, and its turns whole — the reader's messages as chat bubbles,
// the assistant's as markdown, the same shapes as the card beside the
// article. A conversation anchored in a document opens the reader at its
// highlighted text; the sidebar assistant's conversation is not anchored
// anywhere, so its panel says where it lives and carries no link.
export function AssistantHistory({
  notebookId,
  conversations,
  people,
  shared,
}: {
  notebookId: string;
  conversations: HistoryConversation[];
  // Everyone whose conversations are listed. Labels render on shared
  // projects only (SPEC.md §19); solo work stays unlabelled.
  people: Record<string, Person>;
  shared: boolean;
}) {
  const t = useT();
  if (conversations.length === 0) {
    return <p className="text-[13px] text-sand-600">{t("assistant.historyEmpty")}</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      {conversations.map((c) => {
        const href = c.anchor
          ? `/n/${notebookId}?doc=${c.anchor.documentId}&src=${c.anchor.sourceId}`
          : null;
        return (
          <section key={c.id} className="rounded-2xl bg-card p-5 shadow-soft">
            <header className="mb-3 flex flex-wrap items-start gap-x-3 gap-y-1.5 border-b border-line pb-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {shared && c.authorId && people[c.authorId] && (
                    <span className="flex items-center gap-1.5">
                      <PersonBadge person={people[c.authorId]} size={18} />
                      <span className="text-[12px] text-sand-600">{people[c.authorId].name}</span>
                    </span>
                  )}
                  <span className="text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
                    {t(KIND_TITLE[c.kind])}
                  </span>
                  <span
                    data-origin={c.origin}
                    className="rounded-full bg-sand-100 px-2 py-0.5 text-[10.5px] font-semibold tracking-[0.04em] text-sand-700 uppercase"
                  >
                    {t(ORIGIN_LABEL[c.origin])}
                  </span>
                  <span className="text-[12px] text-sand-500">{formatDate(c.updatedAt)}</span>
                  <span className="text-[12px] text-sand-500">
                    {t("assistant.historyTurns", { n: String(c.turns.length) })}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-sand-700">
                  {c.anchor ? (
                    <>
                      <span className="font-semibold text-sand-800">{c.anchor.documentTitle}</span>
                      {c.anchor.quotedText && (
                        <>
                          {" · "}
                          <span className="line-clamp-2 inline text-sand-600">“{c.anchor.quotedText}”</span>
                        </>
                      )}
                      {c.anchor.orphaned && (
                        <span className="ml-2 text-[12px] text-red-600">{t("assistant.historyAnchorOrphaned")}</span>
                      )}
                    </>
                  ) : (
                    <span className="text-sand-600">{t(ORIGIN_HINT[c.origin])}</span>
                  )}
                </p>
              </div>
              {href && (
                <Link
                  href={href}
                  data-track="assistant-history-open"
                  data-tip={t("assistant.historyOpenAnchorTitle")}
                  className="shrink-0 rounded-full bg-clay-100 px-3 py-1 text-xs font-semibold text-clay-800 hover:bg-clay-200"
                >
                  {t("assistant.historyOpenInReader")}
                </Link>
              )}
            </header>
            <div className="flex flex-col gap-2.5">
              {c.turns.map((turn, i) =>
                turn.role === "user" ? (
                  <div key={i} className="ml-10 flex flex-col items-end gap-1.5">
                    {turn.images.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1.5">
                        {turn.images.map((img) => (
                          // eslint-disable-next-line @next/next/no-img-element -- a stored image, its own size
                          <img
                            key={img.id}
                            src={imageUrl(img.id)}
                            alt={img.name}
                            className="max-h-40 max-w-full rounded-xl bg-sand-100 object-contain"
                          />
                        ))}
                      </div>
                    )}
                    {turn.files.length > 0 && (
                      <div className="flex flex-wrap justify-end gap-1">
                        {turn.files.map((f, j) => (
                          <span
                            key={j}
                            className="inline-flex max-w-full items-center gap-1 rounded-full bg-sand-100 px-2.5 py-0.5 text-xs text-sand-700"
                          >
                            <PaperclipIcon size={11} />
                            <span className="truncate">{f.name}</span>
                          </span>
                        ))}
                      </div>
                    )}
                    {turn.content && (
                      <p className="rounded-2xl bg-clay-100 px-3.5 py-2 text-[13.5px] whitespace-pre-wrap text-clay-800">
                        {turn.content}
                      </p>
                    )}
                  </div>
                ) : (
                  <div key={i} className="text-[14px]">
                    <Markdown>{turn.content}</Markdown>
                  </div>
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
