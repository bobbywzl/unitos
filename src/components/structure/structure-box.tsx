"use client";

import { useEffect, useRef, useState } from "react";
import { ClearConversation } from "@/components/assistant/clear-conversation";
import { useCollab } from "@/components/collab/collab-context";
import { SparkleIcon, StopIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { ThinkingIndicator } from "@/components/thinking";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";
import { runHeartbeat } from "@/lib/derive/heartbeat-client";
import { useImeGuard } from "@/lib/ime";
import { useChatDraft, useKeptChat, writeChatDraft, type KeptTurn } from "@/lib/kept-chat";
import type { StructureBody } from "@/lib/structure";
import type { StructureProposal, StructureTurnResult } from "@/lib/structure-assist";
import { useStructure } from "@/components/structure/structure-context";

// The structure assistant (SPEC.md §32): the column at the left of the
// canvas. The reader talks with it about how to sort the document — by its
// parts, by keywords, by what the paragraphs share — and asks for a
// structure; every answer that carries one shows as a proposal card: what
// it changes, the buckets it makes, and Apply or Discard. Apply puts the
// proposal on the canvas (one undo step); nothing lands on its own. The
// conversation is kept for the account per document (lib/kept-chat.ts), so
// closing the structure, leaving the page, or a reload keeps it; Clear
// conversation removes it.

type TurnData = { proposal?: StructureProposal; outcome?: "applied" | "discarded" };
type Turn = KeptTurn & { data?: TurnData };

const SUGGESTIONS = [
  "structure.suggestParts",
  "structure.suggestThemes",
  "structure.suggestQuestions",
  "structure.suggestConnect",
] as const;

export function StructureBox({
  notebookId,
  documentId,
  onApply,
}: {
  notebookId: string;
  documentId: string;
  onApply: (structure: StructureBody) => void;
}) {
  const t = useT();
  const ime = useImeGuard();
  const { canEdit } = useCollab();
  const { structure } = useStructure();
  const kept = useKeptChat<Turn>(notebookId, `structure:${documentId}`);
  const { turns, setTurns } = kept;
  const running = kept.busy;
  const draftKey = `structure:${notebookId}:${documentId}`;
  const [message, setMessageState] = useState("");
  useChatDraft(draftKey, setMessageState);
  function setMessage(text: string) {
    setMessageState(text);
    writeChatDraft(draftKey, text);
  }
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [turns.length, running, open]);

  async function send(text = message.trim()) {
    if (!text || running) return;
    setError(null);
    setMessage("");
    const history = turns
      .filter((turn) => turn.content.trim())
      .slice(-20)
      .map((turn) => ({ role: turn.role, content: turn.content }));
    setTurns((prev) => [...prev, { role: "user", content: text }]);
    const controller = kept.begin();
    try {
      const result = await runHeartbeat<StructureTurnResult>(
        `/api/notebooks/${notebookId}/documents/${documentId}/structure/assist`,
        { message: text, history },
        controller.signal,
      );
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.reply || (result.proposal ? t("structure.proposalNoReply") : ""),
          data: result.proposal ? { proposal: result.proposal } : undefined,
        },
      ]);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : t("common.requestFailed"));
      }
    } finally {
      kept.end(controller);
    }
  }

  function settle(index: number, outcome: "applied" | "discarded") {
    setTurns((prev) => prev.map((turn, i) => (i === index ? { ...turn, data: { ...turn.data, outcome } } : turn)));
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-track="structure-box-expand"
        aria-label={t("structure.assistantExpand")}
        data-tip={t("structure.assistantTitle")}
        className="absolute top-4 left-4 z-20 flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-paper shadow-float hover:bg-clay-800"
      >
        <SparkleIcon size={14} />
        {t("structure.assistant")}
        {turns.length > 0 && <span className="rounded-full bg-paper/20 px-1.5 text-[11px] tabular-nums">{turns.length}</span>}
      </button>
    );
  }

  return (
    <div
      className="flex w-[380px] shrink-0 flex-col border-r border-line bg-card/60 max-md:hidden"
      role="region"
      aria-label={t("structure.assistant")}
    >
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <SparkleIcon size={15} className="shrink-0 text-clay" />
        <span className="font-display text-[16px]">{t("structure.assistant")}</span>
        <span className="ml-auto flex items-center gap-1">
          {turns.length > 0 && !running && <ClearConversation onClear={kept.clear} track="structure-clear" />}
          <button
            onClick={() => setOpen(false)}
            data-track="structure-box-collapse"
            aria-label={t("structure.assistantCollapse")}
            data-tip={t("structure.assistantCollapse")}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
        </span>
      </div>
      <p className="px-4 pb-2 text-[11px] text-sand-500">{t("structure.assistantHint")}</p>

      <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 pt-1 pb-3">
        {turns.length === 0 && (
          <p className="rounded-2xl bg-sand-100 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-sand-700">
            {t(structure.buckets.length === 0 ? "structure.assistantWelcome" : "structure.assistantWelcomeAgain")}
          </p>
        )}
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <p key={i} className="ml-auto max-w-[88%] rounded-2xl bg-sand-100 px-3.5 py-2 text-[13px] text-sand-800">
              {turn.content}
            </p>
          ) : (
            <div key={i} className="flex max-w-[95%] flex-col gap-1.5 text-[13px] text-sand-800">
              {turn.content && <Markdown>{turn.content}</Markdown>}
              {turn.data?.proposal && (
                <ProposalCard
                  proposal={turn.data.proposal}
                  outcome={turn.data.outcome ?? null}
                  canEdit={canEdit}
                  onApply={() => {
                    onApply(turn.data!.proposal!.structure);
                    settle(i, "applied");
                  }}
                  onDiscard={() => settle(i, "discarded")}
                />
              )}
            </div>
          ),
        )}
        {running && <ThinkingIndicator label={t("structure.assistantRunning")} onStop={kept.stop} stopLabel={t("common.stop")} />}
        {turns.length === 0 && canEdit && (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((key) => (
              <button
                key={key}
                onClick={() => {
                  setMessage(t(key));
                  inputRef.current?.focus();
                }}
                data-track={`structure-suggest:${key.replace("structure.suggest", "").toLowerCase()}`}
                className="rounded-full bg-sand-100 px-3 py-1 text-[12px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
              >
                {t(key)}
              </button>
            ))}
          </div>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {canEdit ? (
        <form
          className="flex items-end gap-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={inputRef}
            data-structure-field
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            {...ime.props}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !ime.isImeEnter(e)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t("structure.assistantPlaceholder")}
            rows={2}
            aria-label={t("structure.assistant")}
            className="min-h-[38px] flex-1 resize-none rounded-2xl bg-sand-100 px-4 py-2.5 text-sm outline-none placeholder:text-sand-500"
          />
          <VoiceTypingButton field={inputRef} track="structure-voice-typing" className="size-[38px]" size={15} />
          {running ? (
            <button
              type="button"
              onClick={kept.stop}
              data-track="structure-stop"
              className="flex h-[38px] items-center gap-1.5 rounded-full border border-line px-4 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              <StopIcon size={12} />
              {t("common.stop")}
            </button>
          ) : (
            <button
              type="submit"
              data-track="structure-send"
              disabled={!message.trim()}
              className="h-[38px] rounded-full bg-clay px-5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {t("structure.assistantSend")}
            </button>
          )}
        </form>
      ) : (
        <p className="border-t border-line px-4 py-3 text-xs text-sand-500">{t("structure.assistantViewer")}</p>
      )}
    </div>
  );
}

// What a proposal changes, the buckets it holds, and Apply or Discard. Once
// settled, the card says which and keeps the buckets for the record.
function ProposalCard({
  proposal,
  outcome,
  canEdit,
  onApply,
  onDiscard,
}: {
  proposal: StructureProposal;
  outcome: "applied" | "discarded" | null;
  canEdit: boolean;
  onApply: () => void;
  onDiscard: () => void;
}) {
  const t = useT();
  const { summary, structure } = proposal;
  const tops = structure.buckets.filter((b) => !b.parentId);
  const countIn = (id: string) => structure.pieces.filter((p) => p.bucketId === id).length;
  const children = (id: string) => structure.buckets.filter((b) => b.parentId === id);
  return (
    <div className="rounded-2xl border border-line bg-card p-3 shadow-soft">
      <p className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">{t("structure.proposal")}</p>
      <p className="mt-1 text-[12px] text-sand-700">
        {t("structure.proposalSummary", {
          buckets: structure.buckets.length,
          placed: structure.pieces.length,
          added: summary.bucketsAdded,
          removed: summary.bucketsRemoved,
          moved: summary.piecesMoved,
          connections: summary.connectionsAdded,
        })}
      </p>
      <ul className="mt-2 flex flex-col gap-0.5">
        {tops.map((b) => (
          <li key={b.id} className="text-[12px]">
            <span className="font-semibold">{b.title || t("structure.bucketUntitled")}</span>
            <span className="text-sand-500"> · {t("structure.proposalBlocks", { n: countIn(b.id) })}</span>
            {children(b.id).length > 0 && (
              <ul className="ml-3 flex flex-col gap-0.5 border-l border-line pl-2">
                {children(b.id).map((c) => (
                  <li key={c.id} className="text-[11.5px]">
                    {c.title || t("structure.bucketUntitled")}
                    <span className="text-sand-500"> · {t("structure.proposalBlocks", { n: countIn(c.id) })}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2.5 flex items-center gap-2">
        {outcome === null && canEdit ? (
          <>
            <button
              onClick={onApply}
              data-track="structure-apply"
              data-tip={t("structure.applyTitle")}
              className="rounded-full bg-sage-600 px-3.5 py-1 text-[12px] font-semibold text-sage-fg hover:bg-sage-700"
            >
              {t("structure.apply")}
            </button>
            <button
              onClick={onDiscard}
              data-track="structure-discard"
              data-tip={t("structure.discardTitle")}
              className="rounded-full border border-line px-3 py-1 text-[12px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("structure.discard")}
            </button>
          </>
        ) : (
          <span className="text-[11px] text-sand-500">
            {t(outcome === "applied" ? "structure.proposalApplied" : outcome === "discarded" ? "structure.proposalDiscarded" : "structure.proposalPending")}
          </span>
        )}
      </div>
    </div>
  );
}
