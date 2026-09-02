"use client";

import { useEffect, useState } from "react";
import { isImeKey, useImeGuard } from "@/lib/ime";
import type { DistillationView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ChevronLeftIcon } from "@/components/icons";
import { useLang, useT } from "@/components/lang-provider";
import { ThinkingIndicator } from "@/components/thinking";

type DistillQuoteView = DistillationView["quotes"][number];

// The distilled page: a full-pane overlay over the article (SPEC.md §4, §6).
// Ask view takes the question and lists stored distillations; show view renders
// one distillation — the question large, the quotes under it, each with its
// caption. Clicking a quote jumps the reader to it; Add to notes lands it
// pending. Quotes whose words changed say "Anchor unresolved", never silently
// point at the wrong words (SPEC.md §5).
export function DistillPage({
  distillations,
  shownId,
  running,
  error,
  canAddNotes,
  addNoteHint,
  onRun,
  onCancel,
  onOpen,
  onAsk,
  onClose,
  onDelete,
  onJump,
  onAddNote,
}: {
  distillations: DistillationView[];
  shownId: string | null; // null = ask view
  running: { question: string } | null;
  error: string | null;
  canAddNotes: boolean;
  addNoteHint: string; // title for the Add to notes button
  onRun: (question: string) => void;
  onCancel: () => void; // abort the running scan; the ask view keeps the question
  onOpen: (id: string) => void;
  onAsk: () => void;
  onClose: () => void;
  onDelete: (id: string) => void;
  onJump: (quote: DistillQuoteView) => void;
  onAddNote: (distillation: DistillationView, quote: DistillQuoteView) => Promise<boolean>;
}) {
  const t = useT();
  const { canEdit } = useCollab();
  const lang = useLang();
  const ime = useImeGuard();
  // Dates follow the app language; English keeps the browser default.
  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const [question, setQuestion] = useState("");
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Escape closes the page before anything under it reacts (capture, like the guide).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape that dismisses a pinyin candidate list stays the IME's.
      if (isImeKey(e)) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const shown = shownId ? (distillations.find((d) => d.id === shownId) ?? null) : null;

  async function addNote(distillation: DistillationView, quote: DistillQuoteView, key: string) {
    if (savingKey !== null || saved.has(key)) return;
    setSavingKey(key);
    const ok = await onAddNote(distillation, quote);
    if (ok) setSaved((prev) => new Set(prev).add(key));
    setSavingKey(null);
  }

  return (
    // The page scrolls itself: the pane's scroll stays where the article left
    // it, and content taller than the pane never spills past the background
    // onto the article. overscroll-contain keeps the wheel from chaining into
    // the article scroll at the ends.
    <div
      data-selection-popover
      className="absolute inset-0 z-30 overflow-y-auto overscroll-contain bg-paper print:hidden"
    >
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="mb-6 flex items-center gap-2">
          {shown && !running ? (
            <button
              onClick={onAsk}
              data-track="distill-page-back"
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
            >
              <ChevronLeftIcon size={14} />
              {t("panes.distill")}
            </button>
          ) : (
            <span className="font-display text-[18px]">{t("panes.distill")}</span>
          )}
          <span className="ml-auto flex items-center gap-3">
            {shown && !running && canEdit && (
              <button
                onClick={() => onDelete(shown.id)}
                data-track="distill-page-delete"
                className="text-xs font-semibold text-red-500 hover:text-red-700"
                title={t("panes.deleteDistillation")}
              >
                {t("common.delete")}
              </button>
            )}
            <button
              onClick={onClose}
              data-track="distill-page-close"
              aria-label={t("common.close")}
              className="flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
            >
              ✕
            </button>
          </span>
        </div>

        {running ? (
          <div>
            <h1 className="font-display text-[26px] leading-snug text-ink">{running.question}</h1>
            <p className="mt-5 text-sm">
              <ThinkingIndicator label={t("panes.scanningArticle")} />
            </p>
            <button
              onClick={onCancel}
              data-track="distill-page-cancel"
              title={t("panes.stopScan")}
              className="mt-4 rounded-full border border-line px-3.5 py-1 text-xs font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800"
            >
              {t("common.cancel")}
            </button>
          </div>
        ) : shown ? (
          <div>
            <h1 className="font-display text-[26px] leading-snug text-ink">{shown.question}</h1>
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-sand-500">
              {t(shown.quotes.length === 1 ? "panes.quoteCount1" : "panes.quoteCountN", {
                n: shown.quotes.length,
              })}{" "}
              · {new Date(shown.createdAt).toLocaleDateString(dateLocale)}
              <AuthorChip createdById={shown.createdById} />
            </p>
            <div className="mt-5 flex flex-col gap-3">
              {shown.quotes.map((quote, i) => {
                const key = `${shown.id}:${i}`;
                return (
                  <div key={key} className="rounded-2xl bg-card p-4 shadow-soft">
                    {quote.orphaned ? (
                      <blockquote className="border-l-2 border-sand-300 pl-3 text-[14px] leading-relaxed text-sand-600">
                        “{quote.quotedText}”
                      </blockquote>
                    ) : (
                      <button
                        onClick={() => onJump(quote)}
                        data-track="distill-page-jump"
                        title={t("panes.jumpToPassage")}
                        className="group block w-full text-left"
                      >
                        <blockquote className="border-l-2 border-clay-300 pl-3 text-[14px] leading-relaxed text-sand-800 group-hover:border-clay-500 group-hover:text-ink">
                          “{quote.quotedText}”
                        </blockquote>
                      </button>
                    )}
                    <p className="mt-2 text-[12.5px] leading-relaxed text-sand-600">{quote.caption}</p>
                    <div className="mt-2.5 flex items-center gap-3">
                      {quote.orphaned && (
                        <span className="text-[11px] font-medium text-amber-700">
                          {t("panes.anchorUnresolvedChanged")}
                        </span>
                      )}
                      {saved.has(key) ? (
                        <span className="text-[11.5px] font-semibold text-sage-700">
                          {t("panes.addedPendingInNotes")}
                        </span>
                      ) : (
                        <button
                          onClick={() => void addNote(shown, quote, key)}
                          data-track="distill-page-add-to-notes"
                          disabled={savingKey !== null || !canAddNotes || !canEdit}
                          title={addNoteHint}
                          className="rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                        >
                          {savingKey === key ? t("panes.adding") : t("panes.addToNotes")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            <form
              className={canEdit ? "" : "hidden"}
              onSubmit={(e) => {
                e.preventDefault();
                if (question.trim()) onRun(question);
              }}
            >
              <textarea
                autoFocus
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                {...ime.props}
                onKeyDown={(e) => {
                  if (ime.isImeEnter(e)) return;
                  if (e.key === "Enter" && !e.shiftKey && question.trim()) {
                    e.preventDefault();
                    onRun(question);
                  }
                }}
                placeholder={t("panes.askPlaceholder")}
                rows={2}
                className="w-full resize-none rounded-2xl bg-card p-4 font-display text-[20px] leading-snug shadow-soft outline-none placeholder:text-sand-400"
              />
              <p className="mt-2 text-xs text-sand-500">{t("panes.askHint")}</p>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                data-track="distill-page-run"
                disabled={!question.trim()}
                className="mt-3 rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {t("panes.distill")}
              </button>
            </form>

            {distillations.length > 0 && (
              <div className="mt-8">
                <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                  {t("panes.distilled")}
                </span>
                <div className="mt-2 flex flex-col gap-1.5">
                  {distillations.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-2 rounded-2xl bg-card px-4 py-2.5 shadow-soft"
                    >
                      <button
                        onClick={() => onOpen(d.id)}
                        data-track="distill-page-open"
                        className="min-w-0 flex-1 text-left"
                        title={t("panes.openDistillation")}
                      >
                        <span className="block truncate text-[13.5px] font-semibold text-sand-800 hover:text-clay-800">
                          {d.question}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-sand-500">
                          {t(d.quotes.length === 1 ? "panes.quoteCount1" : "panes.quoteCountN", {
                            n: d.quotes.length,
                          })}{" "}
                          · {new Date(d.createdAt).toLocaleDateString(dateLocale)}
                          <AuthorChip createdById={d.createdById} nameless size={13} />
                        </span>
                      </button>
                      {canEdit && (
                        <button
                          onClick={() => onDelete(d.id)}
                          data-track="distill-page-delete-item"
                          aria-label={t("panes.deleteDistillation")}
                          title={t("panes.deleteDistillation")}
                          className="shrink-0 rounded-full px-1.5 text-sand-400 hover:text-red-600"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
