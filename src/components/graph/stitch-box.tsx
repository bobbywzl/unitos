"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SaveAsNote } from "@/components/assistant/save-as-note";
import { useCollab } from "@/components/collab/collab-context";
import { useGraphNotes } from "@/components/graph/graph-notes";
import { useCoarsePointer, useGraphContent } from "@/components/graph/graph-content";
import { StitchCitationChip, StitchPassageCard, type StitchCitation } from "@/components/graph/stitch-passage-card";
import { ChevronDownIcon, ChevronRightIcon, SparkleIcon, StopIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Markdown } from "@/components/markdown";
import { RatingButtons } from "@/components/rating-buttons";
import { ThinkingIndicator } from "@/components/thinking";
import { STITCH_READS_GENERATED } from "@/lib/derive/config";
import { runHeartbeat } from "@/lib/derive/heartbeat-client";
import { useImeGuard } from "@/lib/ime";
import type { GraphNode, StitchDocument, StitchResult } from "@/lib/types";
import { transcriptErrorKey } from "@/lib/video/types";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";

// Stitch (SPEC.md §22): the box at the foot of the graph, ready for any
// command across the project's documents — gather every passage on a
// topic, connect the passages that answer a question, find the
// contradictions, write a new page. The command reads the documents picked
// in the graph, or every document when none is picked: the box says which,
// lists the pick as chips, and Pick documents turns a node click into a
// pick. Every turn is one command; the reply says what was done, links
// await Accept under Recommended links, and a written page opens from
// Generated content. Under every reply, what was read of each document: a
// video or audio document reads as its transcript, and a document with
// nothing to read says why (the transcript still being written, or failed
// with the stored reason). The conversation is kept per project for the
// browser tab, so closing the graph and opening it again keeps it. The box
// folds to a pill so the canvas is clear.
//
// A citation in a reply names its document and opens the passage card in
// the graph; Open in reader goes to the block. A command enters the
// conversation only with its reply: a failed one stays in the text box with
// Retry, and never goes to the model as history. Esc in the box closes the
// passage card, ends picking, or leaves the text box; it never closes the
// graph from there.

// The route adds `cited` (the document and words of every [block] tag in the
// reply); a reply from before it has none, and its chips stay ¶.
type StitchReply = StitchResult & { cited?: Record<string, StitchCitation> };
// savedNote: the answer was saved as a note (Save as note keeps its line).
type Turn = {
  role: "user" | "assistant";
  content: string;
  result?: StitchReply;
  savedNote?: { noteId: string; section: string };
};
const threads = new Map<string, Turn[]>();
// The unsent command per project, kept when the graph closes (CLAUDE.md
// rule zero §6).
const drafts = new Map<string, string>();

// The route's caps: a longer command is refused, a longer history turn cut.
const COMMAND_MAX = 4_000;
const HISTORY_TURN_MAX = 8_000;

// Each chip fills its template; the cursor lands at {topic}, or at the end
// of a template without {topic}. No chip runs on its own.
const SUGGESTIONS = [
  { label: "stitch.stitchSuggestAsk", template: "stitch.stitchSuggestAskTemplate" },
  { label: "stitch.stitchSuggestGather", template: "stitch.stitchSuggestGatherTemplate" },
  { label: "stitch.stitchSuggestConnect", template: "stitch.stitchSuggestConnectTemplate" },
  { label: "stitch.stitchSuggestContradict", template: "stitch.stitchSuggestContradict" },
  { label: "stitch.stitchSuggestSynthesis", template: "stitch.stitchSuggestSynthesisTemplate" },
] as const;
const TOPIC = "{topic}";

// The documents a reply cites, in the order the reply cites them.
function citedDocumentIds(result: StitchReply): string[] {
  const ids: string[] = [];
  for (const match of result.reply.matchAll(/\[block ([a-zA-Z0-9]+)\]/g)) {
    const documentId = result.cited?.[match[1]]?.documentId;
    if (documentId && !ids.includes(documentId)) ids.push(documentId);
  }
  return ids;
}

export function StitchBox({
  notebookId,
  nodes,
  generatedIds,
  selectedIds,
  picking,
  onPickingChange,
  onUnpick,
  onClearPick,
  onOpenDocument,
  onShowRecommended,
  onCited,
  onProposed,
  prefill,
  open: openProp,
  onOpenChange,
}: {
  notebookId: string;
  nodes: GraphNode[];
  // The pages Stitch generated: left out of the every-document read while
  // STITCH_READS_GENERATED is false, so the scope does not count them.
  generatedIds?: string[];
  // The documents picked in the graph; empty = every document.
  selectedIds: Set<string>;
  picking: boolean;
  onPickingChange: (picking: boolean) => void;
  onUnpick: (documentId: string) => void;
  onClearPick: () => void;
  onOpenDocument: () => void;
  // The fold, when the graph overlay controls it (it folds the box on a
  // narrow screen and under a side list). Unset: the box keeps its own.
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  // Opens the Recommended links list (the overlay's).
  onShowRecommended?: () => void;
  // After each reply: the documents it cites, for the graph to light.
  onCited?: (documentIds: string[]) => void;
  // [view2] After each reply: the recommended links it proposed, for the
  // graph to light; and a command Find hands over (seq: one per hand-over),
  // put in the box for the reader to send.
  onProposed?: (linkIds: string[]) => void;
  prefill?: { text: string; seq: number } | null;
}) {
  const t = useT();
  const router = useRouter();
  const ime = useImeGuard();
  const { canEdit } = useCollab();
  const [turns, setTurnsState] = useState<Turn[]>(() => threads.get(notebookId) ?? []);
  const [command, setCommandState] = useState(() => drafts.get(notebookId) ?? "");
  const [running, setRunning] = useState(false);
  // The command on its way, drawn as the user turn until the reply comes;
  // failed = the request failed, and Retry sends it again.
  const [pending, setPending] = useState<{ text: string; failed: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openState, setOpenState] = useState(true);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [passage, setPassage] = useState<{ blockId: string; citation: StitchCitation } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLSpanElement>(null);

  function setTurns(update: (turns: Turn[]) => Turn[]) {
    setTurnsState((prev) => {
      const next = update(prev);
      threads.set(notebookId, next);
      return next;
    });
  }

  function setCommand(value: string) {
    drafts.set(notebookId, value);
    setCommandState(value);
  }

  // [view2] Find's Ask Stitch: the question goes in the box after any words
  // already typed (never over them), and the cursor waits at its end.
  const [prefillSeq, setPrefillSeq] = useState(prefill?.seq ?? 0);
  if (prefill && prefill.seq !== prefillSeq) {
    setPrefillSeq(prefill.seq);
    setCommand(command.trim() ? `${command.trimEnd()}\n${prefill.text}` : prefill.text);
  }
  useEffect(() => {
    if (prefillSeq === 0) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [prefillSeq]);

  // Esc in the box: the passage card closes first, then picking ends, then
  // the text box lets go of focus. Only an Esc none of these takes reaches
  // the graph, which closes. Capture phase, registered before the overlay's
  // listener (a child's effect runs first).
  const escRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    escRef.current = () => {
      if (passage) {
        setPassage(null);
        return true;
      }
      if (picking) {
        onPickingChange(false);
        return true;
      }
      // The focus goes to the box's title, never to the page (WALK4-07).
      const active = document.activeElement;
      if (active instanceof HTMLElement && regionRef.current?.contains(active) && active !== titleRef.current) {
        titleRef.current?.focus({ preventScroll: true });
        return true;
      }
      return false;
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.isComposing || e.defaultPrevented) return;
      if (!escRef.current()) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // The graph opened: the project's skeletons build now, not at the first
  // command (SPEC.md §22). Fire and forget; nothing builds for a short project.
  useEffect(() => {
    if (canEdit) void fetch(`/api/notebooks/${notebookId}/stitch/warm`, { method: "POST" }).catch(() => {});
  }, [canEdit, notebookId]);

  // Expanding from the pill puts the cursor in the text box.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (open && !wasOpen.current) inputRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  // The newest turn stays in view.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [turns.length, running, open, pending]);

  function stop() {
    abortRef.current?.abort();
  }

  const picked = nodes.filter((n) => selectedIds.has(n.id));
  const coarse = useCoarsePointer();
  const everyCount = STITCH_READS_GENERATED ? nodes.length : nodes.filter((n) => !generatedIds?.includes(n.id)).length;
  // Why Send is off, said under the text box: a command over the route's
  // limit, or a pick of one document (Stitch reads two or more).
  const length = command.trim().length;
  const blocked =
    length > COMMAND_MAX
      ? t("stitch.stitchTooLong", { n: length, max: COMMAND_MAX })
      : picked.length === 1
        ? t("stitch.stitchPickOneMore")
        : null;

  async function send(override?: string) {
    const text = (override ?? command).trim();
    if (!text || running || text.length > COMMAND_MAX || picked.length === 1) return;
    setError(null);
    // Retry sends the failed command again: a new command typed since stays.
    if (override === undefined || command.trim() === text) setCommand("");
    setPassage(null);
    onPickingChange(false);
    // The graph drops the last reply's cited documents.
    onCited?.([]);
    onProposed?.([]); // [view2]
    // Only a command that got its reply is in `turns`, so the history holds
    // no failed or stopped command. A turn with no text (an answer that was
    // only links or a page) has nothing for the model to read, and the
    // route refuses an empty one; a long one the route would cut anyway.
    const history = turns
      .filter((turn) => turn.content.trim())
      .slice(-20)
      .map((turn) => ({ role: turn.role, content: turn.content.slice(0, HISTORY_TURN_MAX) }));
    setPending({ text, failed: false });
    setRunning(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await runHeartbeat<StitchReply>(
        `/api/notebooks/${notebookId}/stitch`,
        {
          command: text,
          history,
          ...(selectedIds.size > 0 ? { documentIds: [...selectedIds] } : {}),
        },
        controller.signal,
      );
      setTurns((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: result.reply, result },
      ]);
      setPending(null);
      onCited?.(citedDocumentIds(result));
      onProposed?.(result.linkIds ?? []); // [view2]
      // The graph's new curves and the generated list arrive with a refresh.
      if (result.linkCount > 0 || result.document) router.refresh();
    } catch (err) {
      // The command goes back into the text box, unless the reader typed a
      // new one meanwhile. Stopped: nothing more is stored, and no error.
      if (!drafts.get(notebookId)?.trim()) setCommand(text);
      if (controller.signal.aborted) {
        setPending(null);
      } else {
        setPending({ text, failed: true });
        setError(err instanceof Error ? err.message : t("common.requestFailed"));
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  }

  function suggest(suggestion: (typeof SUGGESTIONS)[number]) {
    const template = t(suggestion.template, { topic: TOPIC });
    // A template without {topic} fills the whole command: the caret at its
    // end, and Send runs it (WALK4-02).
    const slot = template.indexOf(TOPIC) < 0 ? template.length : template.indexOf(TOPIC);
    setCommand(template.replace(TOPIC, ""));
    // The cursor goes where the topic goes, once the text is in the box.
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(slot, slot);
    });
  }

  function openDocument(documentId: string) {
    router.push(`/n/${notebookId}?doc=${documentId}`);
    onOpenDocument();
  }

  // Open in reader: the reader jumps to ?block= and flashes it.
  function openBlock(documentId: string, blockId: string) {
    router.push(`/n/${notebookId}?doc=${documentId}&block=${blockId}`);
    onOpenDocument();
  }

  // Show on a saved note: the tray sits behind the graph, so the graph
  // closes first.
  // Show on a saved answer: the graph's own Show closes the graph (and its
  // graph=1 entry) and opens the tray on the note.
  const graphNotes = useGraphNotes();
  function showNote(noteId: string) {
    if (graphNotes) {
      graphNotes.showNote(noteId);
      return;
    }
    onOpenDocument();
    setTimeout(() => window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId } })), 0);
  }

  // A citation the reply's `cited` names draws as the document's chip; one it
  // does not (a reply from before `cited`) stays the reader's ¶ chip.
  function citationRenderer(cited: Record<string, StitchCitation> | undefined) {
    return function renderCitation(blockId: string) {
      const citation = cited?.[blockId];
      if (!citation) return null;
      return <StitchCitationChip citation={citation} onOpen={() => setPassage({ blockId, citation })} />;
    };
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        data-track="stitch-expand"
        aria-label={t("stitch.stitchExpand")}
        data-tip={t("stitch.stitchTitle")}
        className="flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-paper shadow-float hover:bg-clay-800 print:hidden"
      >
        <SparkleIcon size={14} />
        {t("stitch.stitch")}
        {turns.length > 0 && (
          <span className="rounded-full bg-paper/20 px-1.5 text-[11px] tabular-nums">{turns.length}</span>
        )}
      </button>
    );
  }

  return (
    <div
      ref={regionRef}
      data-track-surface="sidebar"
      className="relative flex max-h-full min-h-0 w-full flex-col rounded-[22px] border border-line bg-card/95 shadow-float backdrop-blur-md print:hidden"
      role="region"
      aria-label={t("stitch.stitch")}
    >
      {passage && (
        <StitchPassageCard
          citation={passage.citation}
          onOpenInReader={() => openBlock(passage.citation.documentId, passage.blockId)}
          onClose={() => setPassage(null)}
        />
      )}
      <div className="flex items-center gap-2 px-4 pt-3">
        <SparkleIcon size={15} className="shrink-0 text-clay" />
        <span ref={titleRef} tabIndex={-1} data-stitch-title className="font-display text-[16px] outline-none">
          {t("stitch.stitch")}
        </span>
        <span
          data-stitch-hint
          data-tip={t("stitch.stitchHintDetail")}
          className="min-w-0 flex-1 truncate text-xs text-sand-500"
        >
          {t("stitch.stitchHint")}
        </span>
        {turns.length > 0 && !running && (
          <button
            onClick={() => setTurns(() => [])}
            data-track="stitch-new"
            className="shrink-0 rounded-full px-2.5 py-1 text-[11px] text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("stitch.stitchNew")}
          </button>
        )}
        <button
          onClick={() => {
            setOpen(false);
            onPickingChange(false);
            setPassage(null);
          }}
          data-track="stitch-collapse"
          aria-label={t("stitch.stitchCollapse")}
          data-tip={t("stitch.stitchCollapse")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
        >
          <ChevronDownIcon size={16} />
        </button>
      </div>

      {/* The scope: which documents the command reads. */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2 text-[11px] text-sand-600">
          <span className="font-semibold text-sand-700">
            {picked.length === 1
              ? t("stitch.stitchScopePickedOne")
              : picked.length > 0
                ? t("stitch.stitchScopePicked", { n: picked.length })
                : t("stitch.stitchScopeAll", { n: everyCount })}
          </span>
          {picked.map((n) => (
            <button
              key={n.id}
              onClick={() => onUnpick(n.id)}
              data-track="stitch-unpick"
              data-tip={t("stitch.stitchUnpick", { title: n.title })}
              className="flex max-w-[200px] items-center gap-1 rounded-full bg-clay-100 px-2.5 py-0.5 text-clay-800 hover:bg-clay-200"
            >
              <span className="truncate">{n.title}</span>
              <span aria-hidden>✕</span>
            </button>
          ))}
          <button
            onClick={() => onPickingChange(!picking)}
            data-track="stitch-pick"
            aria-pressed={picking}
            data-tip={t(coarse ? "stitch.stitchPickTitleTouch" : "stitch.stitchPickTitle")}
            className={`rounded-full border px-2.5 py-0.5 hover:bg-clay-100 hover:text-clay-800 ${
              picking ? "border-clay bg-clay text-clay-fg hover:bg-clay-600 hover:text-clay-fg" : "border-line"
            }`}
          >
            {t(picking ? "stitch.stitchPickDone" : "stitch.stitchPick")}
          </button>
          {picked.length > 0 && (
            <button
              onClick={onClearPick}
              data-track="stitch-pick-clear"
              data-tip={t("stitch.stitchPickClearTitle")}
              className="rounded-full px-2 py-0.5 text-sand-500 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("stitch.stitchPickClear")}
            </button>
          )}
          {picking && <span className="text-clay-700">{t(coarse ? "stitch.stitchPickHintTouch" : "stitch.stitchPickHint")}</span>}
        </div>
      )}

      {(turns.length > 0 || pending) && (
        // The conversation scrolls inside the box, which the overlay caps
        // (WALK2-04); a screen reader hears each answer land (REV2-11).
        <div ref={bodyRef} role="log" aria-live="polite" className="flex max-h-[40vh] min-h-0 flex-col gap-2.5 overflow-y-auto px-4 pt-3">
          {turns.map((turn, i) =>
            turn.role === "user" ? (
              <p key={i} className="ml-auto max-w-[85%] rounded-2xl bg-sand-100 px-3.5 py-2 text-[13px] text-sand-800">
                {turn.content}
              </p>
            ) : (
              <div key={i} className="flex max-w-[92%] flex-col gap-1.5 text-[13px] text-sand-800">
                {turn.content && (
                  <Markdown renderBlockCitation={citationRenderer(turn.result?.cited)}>{turn.content}</Markdown>
                )}
                {turn.result && (
                  <ResultLine result={turn.result} onOpen={openDocument} onShowRecommended={onShowRecommended} />
                )}
                {turn.content.trim() && canEdit && (
                  <div className="flex flex-wrap items-center gap-2">
                    <SaveAsNote
                      notebookId={notebookId}
                      origin="stitch"
                      question={turns[i - 1]?.role === "user" ? turns[i - 1].content : ""}
                      answer={turn.content}
                      onShow={showNote}
                      saved={turn.savedNote}
                      onSaved={(savedNote) =>
                        setTurns((prev) => prev.map((x) => (x === turn ? { ...x, savedNote } : x)))
                      }
                    />
                    <RatingButtons
                      tool="stitch"
                      input={turns[i - 1]?.role === "user" ? turns[i - 1].content : ""}
                      output={turn.content}
                      notebookId={notebookId}
                    />
                  </div>
                )}
              </div>
            ),
          )}
          {pending && (
            <div className="ml-auto flex max-w-[85%] flex-col items-end gap-1">
              <p
                className={`rounded-2xl bg-sand-100 px-3.5 py-2 text-[13px] text-sand-800 ${pending.failed ? "opacity-60" : ""}`}
              >
                {pending.text}
              </p>
              {pending.failed && (
                <p className="flex items-center gap-2 text-xs text-red-500">
                  <span>{error}</span>
                  <button
                    type="button"
                    onClick={() => void send(pending.text)}
                    disabled={running}
                    data-track="stitch-retry"
                    className="shrink-0 rounded-full border border-line px-2.5 py-0.5 font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
                  >
                    {t("stitch.stitchRetry")}
                  </button>
                </p>
              )}
            </div>
          )}
          {running && <ThinkingIndicator label={t("stitch.stitchRunning")} />}
        </div>
      )}

      {turns.length === 0 && !pending && canEdit && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion.label}
              onClick={() => suggest(suggestion)}
              disabled={running}
              data-track={`stitch-suggest:${suggestion.label.replace("stitch.stitchSuggest", "").toLowerCase()}`}
              className="rounded-full bg-sand-100 px-3 py-1 text-[12px] text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t(suggestion.label)}
            </button>
          ))}
        </div>
      )}

      {canEdit ? (
        <form
          className="flex items-end gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={inputRef}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            {...ime.props}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !ime.isImeEnter(e)) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder={t("stitch.stitchPlaceholder")}
            rows={1}
            aria-label={t("stitch.stitch")}
            className="min-h-[38px] flex-1 resize-none rounded-2xl bg-sand-100 px-4 py-2.5 text-sm outline-none placeholder:text-sand-500"
          />
          <VoiceTypingButton field={inputRef} track="stitch-voice-typing" className="size-[38px]" size={15} />
          {/* Keys: Stop and Send are two elements. A stopped command
              comes back into the text box, and React would otherwise turn
              the pressed Stop into an enabled Send inside the same click,
              whose default action then submits the command again. */}
          {running ? (
            <button
              key="stop"
              type="button"
              onClick={stop}
              data-track="stitch-stop"
              className="flex h-[38px] items-center gap-1.5 rounded-full border border-line px-4 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              <StopIcon size={12} />
              {t("stitch.stitchStop")}
            </button>
          ) : (
            <button
              key="send"
              type="submit"
              data-track="stitch-send"
              disabled={!command.trim() || blocked !== null}
              data-tip={blocked ?? undefined}
              className="h-[38px] rounded-full bg-clay px-5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
            >
              {t("stitch.stitchSend")}
            </button>
          )}
        </form>
      ) : (
        <p className="px-4 py-3 text-xs text-sand-500">{t("stitch.stitchViewer")}</p>
      )}
      {canEdit && blocked && <p className="-mt-1 px-4 pb-3 text-xs text-red-500">{blocked}</p>}
    </div>
  );
}

// What one command stored — the links proposed, the page written, or
// nothing — and what was read of each document.
function ResultLine({
  result,
  onOpen,
  onShowRecommended,
}: {
  result: StitchResult;
  onOpen: (id: string) => void;
  onShowRecommended?: () => void;
}) {
  const t = useT();
  const readCount = result.documents.filter((d) => d.status === "read").length;
  const ran = readCount >= 2;
  // The proposed links still waiting under Recommended links: a link
  // accepted or dismissed since leaves the count (WALK3-12). A link not yet
  // seen there (the graph's data still loading) still counts.
  const { recommendedLinkIds } = useGraphContent();
  const [seen, setSeen] = useState<Set<string>>(() => new Set());
  const ids = result.linkIds ?? [];
  const newlySeen = ids.filter((id) => recommendedLinkIds.has(id) && !seen.has(id));
  if (newlySeen.length > 0) setSeen(new Set([...seen, ...newlySeen]));
  const waiting = ids.length === 0 ? result.linkCount : ids.filter((id) => recommendedLinkIds.has(id) || !seen.has(id)).length;
  return (
    <div className="flex flex-col gap-1 text-xs text-sand-600">
      {!ran && <p className="text-red-500">{t("stitch.stitchNotEnoughRead")}</p>}
      {ran && result.linkCount === 0 && !result.document && (
        <p className="text-sand-500">{t("stitch.stitchNothingStored")}</p>
      )}
      {result.linkCount > 0 && waiting === 0 && (
        <p data-stitch-links-reviewed>
          {t(result.linkCount === 1 ? "stitch.stitchLinksReviewed1" : "stitch.stitchLinksReviewedN", { n: result.linkCount })}
        </p>
      )}
      {result.linkCount > 0 && waiting > 0 && (
        <p className="flex items-center gap-2">
          <span>
            {t(waiting === 1 ? "stitch.stitchLinksMade1" : "stitch.stitchLinksMadeN", { n: waiting })}
          </span>
          {onShowRecommended && (
            <button
              onClick={onShowRecommended}
              data-track="stitch-review-links"
              data-tip={t("stitch.stitchReviewLinksTitle")}
              className="shrink-0 rounded-full border border-line px-3 py-0.5 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("stitch.stitchReviewLinks")}
            </button>
          )}
        </p>
      )}
      {result.document && (
        <p className="flex items-center gap-2">
          <span>{t("stitch.stitchDocumentMade", { title: result.document.title })}</span>
          <button
            onClick={() => onOpen(result.document!.id)}
            data-track="stitch-open-document"
            data-tip={t("stitch.openGenerated")}
            className="rounded-full bg-clay px-3 py-0.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600"
          >
            {t("stitch.stitchOpenDocument")}
          </button>
        </p>
      )}
      <DocumentsRead documents={result.documents} readCount={readCount} />
    </div>
  );
}

// What went to the model of each document, or why nothing did: one line,
// "Read 7 of 7 documents", that opens one row per document. It opens by
// itself when a document was not read, so the reason shows.
function DocumentsRead({ documents, readCount }: { documents: StitchDocument[]; readCount: number }) {
  const t = useT();
  const [shown, setShown] = useState(() => documents.some((d) => d.status === "empty"));
  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-expanded={shown}
        data-track="stitch-documents-read"
        className="flex items-center gap-1 self-start text-sand-500 hover:text-clay-800"
      >
        {t("stitch.stitchDocumentsRead", { read: readCount, total: documents.length })}
        <ChevronRightIcon size={11} className={`transition-transform ${shown ? "rotate-90" : ""}`} />
      </button>
      {shown && (
        <ul className="flex flex-col gap-0.5">
          {documents.map((d) => {
            const unread = d.status === "empty";
            return (
              <li key={d.id} className="flex min-w-0 gap-1.5">
                <span className="min-w-0 max-w-[45%] truncate text-sand-700" title={d.title}>
                  {d.title}
                </span>
                <span className={`min-w-0 flex-1 ${unread ? "text-red-500" : "text-sand-500"}`}>
                  {documentLine(d, t)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function documentLine(d: StitchDocument, t: ReturnType<typeof useT>): string {
  const unit = t(
    d.kind === "text"
      ? "stitch.stitchUnitText"
      : d.kind === "handwritten"
        ? "stitch.stitchUnitConverted"
        : "stitch.stitchUnitTranscript",
  );
  switch (d.status) {
    case "read":
      return t("stitch.stitchDocumentRead", { n: d.blocks, unit });
    case "empty":
      return emptyLine(d, t);
  }
}

// A stored transcription error is an English diagnostic; the known classes
// render in the UI language (lib/video/types.ts), the rest as stored.
function emptyLine(d: StitchDocument, t: ReturnType<typeof useT>): string {
  switch (d.reason) {
    case "transcriptPending":
      return t("stitch.stitchDocumentTranscriptPending");
    case "transcriptStale":
      return t("stitch.stitchDocumentTranscriptStale");
    case "transcriptFailed": {
      const key = d.detail ? transcriptErrorKey(d.detail) : null;
      return t("stitch.stitchDocumentTranscriptFailed", { detail: key ? t(key) : (d.detail ?? "") }).trim();
    }
    case "transcriptNone":
      return t("stitch.stitchDocumentTranscriptNone");
    case "conversionPending":
      return t("stitch.stitchDocumentConversionPending");
    case "conversionFailed":
      return t("stitch.stitchDocumentConversionFailed", { detail: d.detail ?? "" }).trim();
    case "conversionNone":
      return t("stitch.stitchDocumentConversionNone");
    default:
      return t("stitch.stitchDocumentNoText");
  }
}
