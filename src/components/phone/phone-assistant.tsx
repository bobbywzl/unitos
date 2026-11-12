"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnswerMarkdown } from "@/components/assistant/answer-markdown";
import { failureLine, modelFetch, noReason } from "@/components/assistant/failure";
import { useT } from "@/components/lang-provider";
import type { PhoneProject } from "@/components/phone/phone-app";
import { ThinkingIndicator } from "@/components/thinking";
import { readThinking } from "@/lib/assistant/thinking";
import type { ChatTurn } from "@/lib/conversation";
import { splitStreamError, splitStreamPlan } from "@/lib/derive/config";

// The phone page's Assistant tab (SPEC.md §33): one conversation with the
// assistant at Project scope, the only AI tool on the phone. It asks the
// sidebar assistant's own route and keeps the conversation in the same
// place (a conversation note, /api/assistant/conversation), so the
// conversation the phone opens on is the newest one of the project, and a
// conversation held here shows in the sidebar assistant on the web.

type Saved = { conversationNoteId: string | null; updatedAt: string | null };

export function PhoneAssistant({ project }: { project: PhoneProject }) {
  const t = useT();
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [streamed, setStreamed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const saved = useRef<Saved>({ conversationNoteId: null, updatedAt: null });
  const abort = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const busy = streamed !== null;

  // The project's newest conversation, as the sidebar assistant opens on it.
  useEffect(() => {
    let gone = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/assistant/conversation?notebookId=${encodeURIComponent(project.id)}`);
        if (!res.ok) return;
        const body = (await res.json()) as Saved & { turns: ChatTurn[] };
        if (gone) return;
        saved.current = { conversationNoteId: body.conversationNoteId, updatedAt: body.updatedAt };
        // A turn sent before the load ended stays, after the stored ones.
        setTurns((mine) => [...body.turns.map(({ role, content }) => ({ role, content })), ...mine]);
      } catch {
        // No network: the conversation starts empty and saves as a new one.
      } finally {
        if (!gone) setLoaded(true);
      }
    };
    void load();
    return () => {
      gone = true;
      abort.current?.abort();
    };
  }, [project.id]);

  // The newest words stay in view as they arrive.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [turns, streamed]);

  /** Keep the conversation. When it changed elsewhere since it was read (the
      sidebar assistant on another device), the stored turns stand and this
      exchange goes after them. */
  async function keep(all: ChatTurn[], exchange: ChatTurn[]): Promise<boolean> {
    const send = (turnsToSave: ChatTurn[]) =>
      fetch("/api/assistant/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId: project.id,
          conversationNoteId: saved.current.conversationNoteId,
          turns: turnsToSave,
          base: saved.current.updatedAt,
        }),
      });
    try {
      let res = await send(all);
      if (res.status === 409) {
        const theirs = (await res.json()) as { turns?: ChatTurn[]; updatedAt?: string };
        if (!theirs.turns || !theirs.updatedAt) return false;
        saved.current = { ...saved.current, updatedAt: theirs.updatedAt };
        const merged = [...theirs.turns.map(({ role, content }) => ({ role, content })), ...exchange];
        setTurns(merged);
        res = await send(merged);
      }
      if (!res.ok) return false;
      const answer = (await res.json()) as Saved;
      saved.current = { conversationNoteId: answer.conversationNoteId, updatedAt: answer.updatedAt };
      return true;
    } catch {
      return false;
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    const history = turns;
    const asked: ChatTurn = { role: "user", content: q };
    setTurns([...history, asked]);
    setQuestion("");
    setError(null);
    setStreamed("");
    const controller = new AbortController();
    abort.current = controller;
    let text = "";
    let failure: string | null = null;
    try {
      const res = await modelFetch(
        "/api/assistant",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            notebookId: project.id,
            scope: "notebook",
            task: "ask",
            question: q,
            web: false,
            thinking: readThinking(),
            history,
          }),
        },
        t,
      );
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        failure = body?.error ?? noReason(res, t);
      } else {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let raw = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          raw += decoder.decode(value, { stream: true });
          // Kept as it arrives: Stop keeps the words that came.
          text = splitStreamPlan(splitStreamError(raw).text).text.trim();
          setStreamed(text);
        }
        const end = splitStreamError(raw);
        failure = end.error ?? (text ? null : t("assistant.emptyResponse"));
      }
    } catch (err) {
      // Stop keeps what had arrived; anything else is a failure.
      if (!controller.signal.aborted) failure = failureLine(err, t);
    }
    abort.current = null;
    setStreamed(null);
    if (failure && !text) {
      // The question goes back in the box: nothing typed is lost.
      setTurns(history);
      setQuestion(q);
      setError(failure);
      return;
    }
    if (!text) {
      setTurns(history);
      setQuestion(q);
      return;
    }
    const exchange: ChatTurn[] = [asked, { role: "assistant", content: text }];
    const all = [...history, ...exchange];
    setTurns(all);
    if (failure) setError(failure);
    else if (!(await keep(all, exchange))) setError(t("phone.conversationNotSaved"));
  }

  const stop = () => abort.current?.abort();

  function newChat() {
    if (busy) return;
    saved.current = { conversationNoteId: null, updatedAt: null };
    setTurns([]);
    setError(null);
  }

  if (!project.canEdit) {
    return <p className="px-5 py-6 text-[15px] text-sand-700">{t("phone.viewerAssistant")}</p>;
  }

  return (
    <>
      <div ref={listRef} data-phone-chat className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
        {loaded && turns.length === 0 && !busy && (
          <p className="py-8 text-center text-[14px] text-sand-600">{t("phone.assistantEmpty")}</p>
        )}
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <p
              key={i}
              className="ml-auto w-fit max-w-[88%] rounded-2xl bg-clay-100 px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap"
            >
              {turn.content}
            </p>
          ) : (
            <div key={i} className="rounded-2xl bg-card px-4 py-3 text-[15px] leading-relaxed shadow-soft">
              <AnswerMarkdown>{turn.content}</AnswerMarkdown>
            </div>
          ),
        )}
        {busy && (
          <div className="rounded-2xl bg-card px-4 py-3 text-[15px] leading-relaxed shadow-soft">
            {streamed ? <AnswerMarkdown>{streamed}</AnswerMarkdown> : null}
            <ThinkingIndicator className="mt-1 text-[13px] text-sand-700" onStop={stop} stopLabel={t("phone.stop")} />
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-line bg-paper px-4 pt-2.5 pb-2.5">
        {error && (
          <p role="alert" className="mb-1.5 text-[13px] font-medium text-red-600">
            {error}
          </p>
        )}
        <textarea
          data-phone-ask
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("phone.assistantPlaceholder")}
          rows={2}
          maxLength={4000}
          className="block max-h-[30vh] min-h-[60px] w-full resize-none rounded-2xl bg-card px-4 py-3 text-[16px] leading-relaxed shadow-soft"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            data-track="phone-new-chat"
            onClick={newChat}
            disabled={busy || turns.length === 0}
            className="h-11 shrink-0 rounded-full bg-card px-4 text-[14px] font-semibold text-sand-800 shadow-soft disabled:opacity-50"
          >
            {t("phone.newChat")}
          </button>
          <button
            type="button"
            data-track="phone-ask"
            onClick={ask}
            disabled={!question.trim() || busy}
            className="h-11 flex-1 rounded-full bg-clay px-5 text-[15px] font-semibold text-white disabled:opacity-50"
          >
            {t("phone.send")}
          </button>
        </div>
      </div>
    </>
  );
}
