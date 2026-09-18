import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { authEnabled, currentUser } from "@/lib/auth";
import { peopleByIds, roleOf } from "@/lib/collab";
import { loggedTurns, TOOL_DERIVATIONS, toolKindOf } from "@/lib/conversation";
import { parseTurnContent } from "@/lib/assistant/attachments";
import { db } from "@/lib/db";
import { ANNOTATIONS_SECTION_TITLE } from "@/lib/derive/config";
import { serverT } from "@/lib/i18n/server";
import { formatTimeRange } from "@/lib/video/types";
import { ArrowLeftIcon } from "@/components/icons";
import { AccountGuard } from "@/components/account-guard";
import {
  AssistantHistory,
  type HistoryConversation,
} from "@/components/assistant/assistant-history";

export const dynamic = "force-dynamic";

// Assistant history (SPEC.md §7): every assistant conversation of this
// project, newest first, each on its own panel, each labelled with the
// contributor who started it and saying where it comes from — the selection
// chat (the popover's assistant on a highlighted text), a tool's output
// continued into a conversation, or the sidebar assistant's own. An anchored
// panel links back to the highlighted text it started from; the sidebar's
// says it lives in the assistant tab of the side panel and links nowhere.
// Conversations are notes in the hidden Annotations section (SPEC.md §21), so
// this page reads that section alone; a side chat is left out.
export default async function AssistantHistoryPage(props: { params: Promise<{ notebookId: string }> }) {
  const { notebookId } = await props.params;
  const user = await currentUser();
  if (!user) redirect("/signin");
  const notebook = await db.notebook.findUnique({
    where: { id: notebookId },
    include: { collaborators: true },
  });
  if (!notebook) notFound();
  const myRole = authEnabled() ? roleOf(notebook, user) : "owner";
  if (!myRole) notFound();
  const t = await serverT();

  // Every conversation of this project, whoever had it, each labelled with
  // the contributor who started it (SPEC.md §7, §19) — the Annotations tab
  // shows the same work. A side chat belongs to the conversation it came
  // from and opens from that chat box alone, so it is never listed here.
  const notes = await db.note.findMany({
    where: {
      section: { notebookId, hidden: true, title: ANNOTATIONS_SECTION_TITLE },
      sideChatOfId: null,
      OR: [
        { derivationType: "SYNTHESIS" },
        { derivationType: { in: [...TOOL_DERIVATIONS] }, conversation: { not: { equals: null } } },
      ],
    },
    orderBy: { updatedAt: "desc" },
    include: {
      sources: {
        include: { document: { select: { id: true, title: true } } },
      },
    },
  });

  const conversations: HistoryConversation[] = notes
    .map((n): HistoryConversation | null => {
      const kind = n.derivationType === "SYNTHESIS" ? "assistant" : toolKindOf(n.derivationType);
      if (!kind) return null;
      const turns = loggedTurns(n);
      if (turns.length === 0) return null;
      const source = n.sources[0] ?? null;
      const anchor = source
        ? {
            documentId: source.documentId,
            documentTitle: source.document.title,
            sourceId: source.id,
            quotedText:
              source.quotedText ||
              (source.startTime !== null
                ? formatTimeRange(source.startTime, source.endTime ?? source.startTime)
                : ""),
            orphaned: source.orphaned,
          }
        : null;
      const origin: HistoryConversation["origin"] =
        kind !== "assistant" ? "tool" : anchor ? "selection" : "sidebar";
      return {
        id: n.id,
        kind,
        origin,
        anchor,
        authorId: n.createdById,
        updatedAt: n.updatedAt.toISOString(),
        turns: turns.map((turn) =>
          turn.role === "user"
            ? { role: "user" as const, ...parseTurnContent(turn.content) }
            : { role: "assistant" as const, content: turn.content },
        ),
      };
    })
    .filter((c): c is HistoryConversation => c !== null);

  return (
    <main className="mx-auto w-full max-w-[760px] px-6 pt-[26px] pb-24">
      <AccountGuard userId={user.id} enabled={authEnabled()} />
      <header className="mb-[34px] flex items-center gap-2">
        <Link
          href={`/n/${notebook.id}`}
          className="flex items-center gap-2 rounded-full bg-sand-100 py-[7px] pr-4 pl-3 text-[13px] text-sand-700 shadow-soft hover:bg-clay-100 hover:text-clay-800"
        >
          <ArrowLeftIcon size={15} />
          {t("outline.reader")}
        </Link>
        <h1 className="ml-2 font-display text-[18px]">{t("assistant.historyPageTitle")}</h1>
        <span className="ml-auto truncate text-[13px] text-sand-600">{notebook.title}</span>
      </header>
      <AssistantHistory
        notebookId={notebook.id}
        conversations={conversations}
        people={await peopleByIds(notes.flatMap((n) => (n.createdById ? [n.createdById] : [])))}
        shared={authEnabled() && notebook.collaborators.length > 0}
      />
    </main>
  );
}
