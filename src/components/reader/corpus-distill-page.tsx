"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { splitStreamError } from "@/lib/derive/config";
import { isImeKey, useImeGuard } from "@/lib/ime";
import type { CorpusDistillation, CorpusDistillationView } from "@/lib/types";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ChevronLeftIcon } from "@/components/icons";
import { useLang, useT } from "@/components/lang-provider";

type CorpusQuoteView = CorpusDistillationView["quotes"][number];

// The corpus distilled page (SPEC.md §13): one question, quotes pulled from
// every document in the corpus, each cited to its document. Same shape as the
// document distilled page: ask view lists stored corpus distillations; show
// view renders one. Clicking a quote opens its document; Add to notes lands
// the quote pending. Quotes whose words changed say "Anchor unresolved".
export function CorpusDistillPage({
  notebookId,
  activeDocumentId,
  distillations,
  shownId,
  sectionChoices,
  onClose,
}: {
  notebookId: string;
  activeDocumentId: string | null;
  distillations: CorpusDistillationView[];
  shownId: string | null; // null = ask view
  sectionChoices: { id: string; label: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const ime = useImeGuard();
  const { canEdit } = useCollab();
  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const [question, setQuestion] = useState("");
  const [currentId, setCurrentId] = useState<string | null>(shownId);
  const [running, setRunning] = useState<{ question: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [local, setLocal] = useState<CorpusDistillationView[]>([]);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Escape that dismisses a pinyin candidate list stays the IME's.
      if (isImeKey(e)) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      abortRef.current?.abort();
    };
  }, [onClose]);

  const all = [...local.filter((d) => !distillations.some((p) => p.id === d.id)), ...distillations];
  const shown = currentId ? (all.find((d) => d.id === currentId) ?? null) : null;

  async function run(q: string) {
    const trimmed = q.trim();
    if (!trimmed || running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning({ question: trimmed });
    setError(null);
    setCurrentId(null);
    try {
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ type: "DISTILL", scope: "corpus", notebookId, question: trimmed }),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("reader.distillFailedStatus", { status: res.status }));
      }
      // Heartbeat spaces while the model works; the payload is the trailer —
      // the distillation JSON, or the in-band error.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let raw = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += decoder.decode(value, { stream: true });
      }
      const { text, error: streamError } = splitStreamError(raw);
      if (streamError) throw new Error(streamError);
      let payload: { distillation?: CorpusDistillation } | null = null;
      try {
        payload = JSON.parse(text.trim()) as { distillation?: CorpusDistillation };
      } catch {
        payload = null;
      }
      if (!payload?.distillation) throw new Error(t("reader.distillUnfinished"));
      if (controller.signal.aborted) return;
      const fresh: CorpusDistillationView = {
        ...payload.distillation,
        quotes: payload.distillation.quotes.map((quote) => ({
          ...quote,
          orphaned: false,
          documentTitle: "",
        })),
      };
      setLocal((prev) => [fresh, ...prev]);
      setCurrentId(fresh.id);
      router.refresh();
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : t("reader.distillFailed"));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(null);
    }
  }

  async function remove(id: string) {
    try {
      await api(`/api/notebooks/${notebookId}`, "PATCH", { removeDistillationId: id });
      setLocal((prev) => prev.filter((d) => d.id !== id));
      if (currentId === id) setCurrentId(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }

  // Clicking a quote opens its document; the same document just closes the page.
  function jump(quote: CorpusQuoteView) {
    if (quote.documentId !== activeDocumentId) {
      router.push(`/n/${notebookId}?doc=${quote.documentId}`);
    }
    onClose();
  }

  async function addNote(distillation: CorpusDistillationView, quote: CorpusQuoteView, key: string) {
    if (savingKey !== null || saved.has(key) || sectionChoices.length === 0) return;
    setSavingKey(key);
    try {
      await api("/api/notes", "POST", {
        sectionId: sectionChoices[0].id,
        content: quote.caption,
        origin: "distill",
        source: {
          documentId: quote.documentId,
          blockId: quote.blockId,
          startOffset: quote.start,
          endOffset: quote.end,
          quotedText: quote.quotedText,
          prefix: quote.prefix,
          suffix: quote.suffix,
        },
      });
      setSaved((prev) => new Set(prev).add(key));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div data-selection-popover className="fixed inset-0 z-50 overflow-y-auto bg-paper">
      <div className="mx-auto max-w-2xl px-8 py-8">
        <div className="mb-6 flex items-center gap-2">
          {shown && !running ? (
            <button
              onClick={() => setCurrentId(null)}
              className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
            >
              <ChevronLeftIcon size={14} />
              {t("panes.distillCorpus")}
            </button>
          ) : (
            <span className="font-display text-[18px]">{t("panes.distillCorpus")}</span>
          )}
          <span className="ml-auto flex items-center gap-3">
            {shown && !running && canEdit && (
              <button
                onClick={() => void remove(shown.id)}
                className="text-xs font-semibold text-red-500 hover:text-red-700"
                title={t("panes.deleteDistillation")}
              >
                {t("common.delete")}
              </button>
            )}
            <button
              onClick={onClose}
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
            <p className="mt-5 flex items-center gap-2 text-sm text-sand-600">
              {t("panes.scanningCorpus")}
              <span className="inline-flex items-center gap-1">
                <span className="loading-dot" />
                <span className="loading-dot" />
                <span className="loading-dot" />
              </span>
            </p>
            <button
              onClick={() => abortRef.current?.abort()}
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
                    {quote.documentTitle && (
                      <span className="mb-2 inline-block max-w-full truncate rounded-full bg-clay-100 px-2.5 py-0.5 text-[11px] font-semibold text-clay-800">
                        {quote.documentTitle}
                      </span>
                    )}
                    {quote.orphaned ? (
                      <blockquote className="border-l-2 border-sand-300 pl-3 text-[14px] leading-relaxed text-sand-600">
                        “{quote.quotedText}”
                      </blockquote>
                    ) : (
                      <button
                        onClick={() => jump(quote)}
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
                        canEdit && (
                          <button
                            onClick={() => void addNote(shown, quote, key)}
                            disabled={savingKey !== null || sectionChoices.length === 0}
                            className="rounded-full border border-line px-3 py-1 text-[11.5px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
                          >
                            {savingKey === key ? t("panes.adding") : t("panes.addToNotes")}
                          </button>
                        )
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
                if (question.trim()) void run(question);
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
                    void run(question);
                  }
                }}
                placeholder={t("panes.corpusAskPlaceholder")}
                rows={2}
                className="w-full resize-none rounded-2xl bg-card p-4 font-display text-[20px] leading-snug shadow-soft outline-none placeholder:text-sand-400"
              />
              <p className="mt-2 text-xs text-sand-500">{t("panes.corpusAskHint")}</p>
              {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
              <button
                type="submit"
                disabled={!question.trim()}
                className="mt-3 rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {t("panes.distill")}
              </button>
            </form>

            {all.length > 0 && (
              <div className="mt-8">
                <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
                  {t("panes.distilled")}
                </span>
                <div className="mt-2 flex flex-col gap-1.5">
                  {all.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center gap-2 rounded-2xl bg-card px-4 py-2.5 shadow-soft"
                    >
                      <button
                        onClick={() => setCurrentId(d.id)}
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
                          onClick={() => void remove(d.id)}
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
