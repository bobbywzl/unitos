"use client";

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLang, useT } from "@/components/lang-provider";
import { DOCS_EVENT } from "@/components/docs/extensions";
import { CheckIcon, CloseIcon, DropDownIcon } from "@/components/docs/icons";
import { charClass } from "@/components/docs/typing/chars";
import { serverTypingPrefs, setTypingPrefs, subscribeTypingPrefs, typingPrefs, type TypingPrefs } from "@/components/docs/typing/prefs";
import type { TKey } from "@/lib/i18n/dictionaries";

// Word count (Ctrl+Shift+C), as Google Docs counts (SPEC.md §29, typing): a
// word is a run of word characters; an apostrophe, a hyphen, or a dash never
// splits one ("don't", "well-known", "a—b"); punctuation such as . / : @ ,
// does. Characters leave out paragraph ends; "excluding spaces" leaves out
// the space character alone (a tab or a line break still counts). With text
// selected, each count reads "S of T". "Display word count while typing"
// keeps a counter at the bottom left of the page area; a press on it picks
// the count it shows, or hides it.

export type Counts = { words: number; chars: number; charsNoSpaces: number };

type Metric = TypingPrefs["counterMetric"];

const SHOW_KEY = "unitos-docs-word-count";

/** Google Docs' counts over [from, to) of the document. */
export function countRange(doc: PMNode, from: number, to: number): Counts {
  let words = 0;
  let chars = 0;
  let charsNoSpaces = 0;
  let inWord = false;
  const see = (ch: string) => {
    chars++;
    if (ch !== " ") charsNoSpaces++;
    const cls = charClass(ch);
    if (cls === "t") return;
    const word = cls === "w";
    if (word && !inWord) words++;
    inWord = word;
  };
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      inWord = false;
      return true;
    }
    if (node.isText) {
      const text = node.text ?? "";
      for (const ch of text.slice(Math.max(0, from - pos), Math.max(0, to - pos))) see(ch);
      return false;
    }
    if (node.type.name === "hardBreak") {
      chars++;
      charsNoSpaces++;
      inWord = false;
    }
    return true;
  });
  return { words, chars, charsNoSpaces };
}

/** The same counts for a string (tests, and any text outside a document). */
export function countText(text: string): Counts {
  let words = 0;
  let chars = 0;
  let charsNoSpaces = 0;
  let inWord = false;
  for (const ch of text) {
    if (ch === "\n") {
      inWord = false;
      continue;
    }
    chars++;
    if (ch !== " ") charsNoSpaces++;
    const cls = charClass(ch);
    if (cls === "t") continue;
    const word = cls === "w";
    if (word && !inWord) words++;
    inWord = word;
  }
  return { words, chars, charsNoSpaces };
}

/** The pages the document fills, and the pages a range touches. */
function pageCounts(editor: Editor, from: number, to: number, empty: boolean): { total: number; part: number } {
  const sheets = editor.view.dom.closest("[data-docs-editor]")?.querySelectorAll<HTMLElement>("[data-docs-page-sheet]");
  const tops: { top: number; bottom: number }[] = [];
  if (sheets?.length) {
    sheets.forEach((s) => {
      const r = s.getBoundingClientRect();
      tops.push({ top: r.top, bottom: r.bottom });
    });
  } else {
    const page = editor.view.dom.closest<HTMLElement>("[data-docs-page]");
    if (!page) return { total: 1, part: 1 };
    const r = page.getBoundingClientRect();
    const height = (parseFloat(page.style.minHeight || "1056") || 1056) * (r.width / (page.offsetWidth || r.width || 1));
    const n = Math.max(1, Math.ceil((r.height - 1) / height));
    for (let i = 0; i < n; i++) tops.push({ top: r.top + i * height, bottom: r.top + (i + 1) * height });
  }
  const total = tops.length;
  if (empty) return { total, part: 0 };
  try {
    const a = editor.view.coordsAtPos(from).top;
    const b = editor.view.coordsAtPos(to).bottom;
    const part = tops.filter((p) => p.bottom > a && p.top < b).length;
    return { total, part: Math.max(1, part) };
  } catch {
    return { total, part: 1 };
  }
}

function readShow(): boolean {
  try {
    return window.localStorage.getItem(SHOW_KEY) === "1";
  } catch {
    return false;
  }
}

function writeShow(on: boolean): void {
  try {
    window.localStorage.setItem(SHOW_KEY, on ? "1" : "0");
  } catch {
    // Storage is off: the choice holds for this page.
  }
}

type Snapshot = {
  all: Counts;
  part: Counts | null;
  pages: { total: number; part: number };
};

/** The counts, recomputed after edits (300 ms) and selection moves (100 ms). */
function useCounts(editor: Editor, active: boolean): Snapshot {
  const compute = (): Snapshot => {
    const { doc, selection } = editor.state;
    const { from, to, empty } = selection;
    return {
      all: countRange(doc, 0, doc.content.size),
      part: empty ? null : countRange(doc, from, to),
      pages: pageCounts(editor, from, to, empty),
    };
  };
  const [snap, setSnap] = useState<Snapshot>(compute);
  useEffect(() => {
    if (!active) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = (ms: number) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setSnap(compute()), ms);
    };
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => schedule(transaction.docChanged ? 300 : 100);
    editor.on("transaction", onTransaction);
    schedule(0);
    return () => {
      if (timer) clearTimeout(timer);
      editor.off("transaction", onTransaction);
    };
    // compute reads the editor at call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, active]);
  return snap;
}

function Bold({ template, n, total }: { template: string; n: string; total?: string }): ReactNode {
  const parts = template.split(/(\{n\}|\{total\})/);
  return parts.map((p, i) => (p === "{n}" ? <b key={i}>{n}</b> : p === "{total}" ? <span key={i}>{total}</span> : p));
}

function metricText(
  t: ReturnType<typeof useT>,
  metric: Metric,
  snap: Snapshot,
  format: (n: number) => string,
): { template: string; n: string; total?: string } {
  const part = snap.part;
  const pick = (c: Counts) => (metric === "words" ? c.words : metric === "characters" ? c.chars : c.charsNoSpaces);
  if (metric === "pages") {
    if (part) return { template: t("docsTyping.pagesOutOf", { n: "{n}", total: "{total}" }), n: format(snap.pages.part), total: format(snap.pages.total) };
    const key: TKey = snap.pages.total === 1 ? "docsTyping.onePage" : "docsTyping.manyPages";
    return { template: t(key, { n: "{n}" }), n: format(snap.pages.total) };
  }
  if (part) {
    const key: TKey =
      metric === "words" ? "docsTyping.wordsOutOf" : metric === "characters" ? "docsTyping.charactersOutOf" : "docsTyping.charactersNoSpacesOutOf";
    return { template: t(key, { n: "{n}", total: "{total}" }), n: format(pick(part)), total: format(pick(snap.all)) };
  }
  const n = pick(snap.all);
  const key: TKey =
    metric === "words"
      ? n === 1
        ? "docsTyping.oneWord"
        : "docsTyping.manyWords"
      : metric === "characters"
        ? n === 1
          ? "docsTyping.oneCharacter"
          : "docsTyping.manyCharacters"
        : "docsTyping.charactersNoSpacesCount";
  return { template: t(key, { n: "{n}" }), n: format(n) };
}

export function WordCountDialog({ editor }: { editor: Editor }) {
  const t = useT();
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [show, setShow] = useState(() => typeof window !== "undefined" && readShow());
  const [draftShow, setDraftShow] = useState(false);
  const [menu, setMenu] = useState(false);
  const prefs = useSyncExternalStore(subscribeTypingPrefs, typingPrefs, serverTypingPrefs);
  const pageless = editor.storage.docsTyping?.pageless ?? false;
  const metric: Metric = pageless && prefs.counterMetric === "pages" ? "words" : prefs.counterMetric;
  const snap = useCounts(editor, open || show);
  const okRef = useRef<HTMLButtonElement>(null);
  const counterRef = useRef<HTMLButtonElement>(null);
  const format = (n: number) => n.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");

  useEffect(() => {
    const onOpen = () => {
      setDraftShow(readShow());
      setOpen(true);
    };
    window.addEventListener(DOCS_EVENT.wordCount, onOpen);
    return () => window.removeEventListener(DOCS_EVENT.wordCount, onOpen);
  }, []);

  useEffect(() => {
    if (open) okRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest("[data-docs-wc-menu]") || counterRef.current?.contains(target)) return;
      setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenu(false);
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  const closeDialog = () => {
    setOpen(false);
    editor.commands.focus();
  };
  const of = (part: number, total: number) =>
    snap.part ? t("docsTyping.countOf", { n: format(part), total: format(total) }) : format(total);
  const rows: { label: TKey; value: string }[] = [
    ...(pageless ? [] : [{ label: "docsTyping.pages" as TKey, value: of(snap.pages.part, snap.pages.total) }]),
    { label: "docsTyping.words", value: of(snap.part?.words ?? 0, snap.all.words) },
    { label: "docsTyping.characters", value: of(snap.part?.chars ?? 0, snap.all.chars) },
    { label: "docsTyping.charactersNoSpaces", value: of(snap.part?.charsNoSpaces ?? 0, snap.all.charsNoSpaces) },
  ];
  const shown = metricText(t, metric, snap, format);
  const metrics: Metric[] = pageless ? ["words", "characters", "charactersNoSpaces"] : ["pages", "words", "characters", "charactersNoSpaces"];

  if (typeof document === "undefined") return null;
  return (
    <>
      {show && (
        <div className="docs-wc-anchor" data-edit-control>
          <button
            ref={counterRef}
            type="button"
            className="docs-wc-widget"
            aria-haspopup="menu"
            aria-expanded={menu}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setMenu((m) => !m)}
          >
            <span className="docs-wc-caption">
              <Bold {...shown} />
            </span>
            <DropDownIcon size={20} />
          </button>
          {menu && (
            <div role="menu" className="docs-wc-menu" data-docs-wc-menu>
              {metrics.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="menuitemradio"
                  aria-checked={m === metric}
                  className="docs-wc-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setTypingPrefs({ counterMetric: m });
                    setMenu(false);
                  }}
                >
                  <span className="docs-wc-check">{m === metric ? <CheckIcon size={18} /> : null}</span>
                  <span>
                    <Bold {...metricText(t, m, { ...snap, part: null }, format)} />
                  </span>
                </button>
              ))}
              <div role="separator" className="docs-wc-sep" />
              <button
                type="button"
                role="menuitem"
                className="docs-wc-item"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setMenu(false);
                  setShow(false);
                  writeShow(false);
                }}
              >
                <span className="docs-wc-check" />
                <span>{t("docsTyping.hideWordCount")}</span>
              </button>
            </div>
          )}
        </div>
      )}
      {open &&
        createPortal(
          <div
            className="docs-ty-backdrop"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) closeDialog();
            }}
            onMouseUp={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                closeDialog();
              }
            }}
            data-edit-control
            data-docs-typing
          >
            <div role="dialog" aria-modal="true" aria-label={t("docsTyping.wordCount")} className="docs-ty-card docs-wc-dialog">
              <div className="docs-ty-head">
                <h2>{t("docsTyping.wordCount")}</h2>
                <button type="button" className="docs-find-btn" aria-label={t("docsTyping.close")} onClick={closeDialog}>
                  <CloseIcon size={24} />
                </button>
              </div>
              <table className="docs-wc-table">
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.label}>
                      <td>{t(r.label)}</td>
                      <td>{r.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <label className="docs-ty-check docs-wc-show">
                <input type="checkbox" checked={draftShow} onChange={(e) => setDraftShow(e.target.checked)} />
                {t("docsTyping.displayWhileTyping")}
              </label>
              <div className="docs-ty-actions">
                <button type="button" className="docs-ty-button" onClick={closeDialog}>
                  {t("docsTyping.cancel")}
                </button>
                <button
                  ref={okRef}
                  type="button"
                  className="docs-ty-button docs-ty-primary"
                  onClick={() => {
                    setShow(draftShow);
                    writeShow(draftShow);
                    closeDialog();
                  }}
                >
                  {t("docsTyping.ok")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
