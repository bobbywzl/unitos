"use client";

import type { Node as PMNode } from "@tiptap/pm/model";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useLang, useT } from "@/components/lang-provider";
import { DropDownIcon } from "@/components/docs/icons";
import { insertContext } from "@/components/docs/insert/context";
import { DropdownPanel, keepFocus, MenuItem, MenuSeparator } from "@/components/docs/menu";
import { ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { countRange, type Counts } from "@/components/docs/typing/count";
import { TYPING_EVENT } from "@/components/docs/typing/events";
import { serverTypingPrefs, setTypingPrefs, subscribeTypingPrefs, typingPrefs, type TypingPrefs } from "@/components/docs/typing/prefs";
import { inlineText } from "@/lib/docs/blocks";
import type { TKey } from "@/lib/i18n/dictionaries";

// Word count (Ctrl+Shift+C), as Google Docs counts (typing/count.ts; SPEC.md
// §29). With text selected, each count reads "S of T". "Display word count
// while typing" keeps a counter at the bottom left of the page area; a press
// on it picks the count it shows, or hides it.

type Metric = TypingPrefs["counterMetric"];

const SHOW_KEY = "unitos-docs-word-count";

/** The pages the document fills (the page sheets drawn), and the pages a
    range touches. */
function pageCounts(editor: Editor, from: number, to: number, empty: boolean): { total: number; part: number } {
  const shell = editor.view.dom.closest("[data-docs-editor]");
  const sheets = Array.from(shell?.querySelectorAll<HTMLElement>("[data-docs-page-sheet]") ?? []);
  const total = Math.max(1, sheets.length);
  if (empty) return { total, part: 0 };
  try {
    const a = editor.view.coordsAtPos(from).top;
    const b = editor.view.coordsAtPos(to).bottom;
    const part = sheets.filter((sheet) => {
      const r = sheet.getBoundingClientRect();
      return r.bottom > a && r.top < b;
    }).length;
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

/** The whole document's counts, as Google Docs counts them: the body; with
    `extras`, its footnotes, headers, and footers too. */
function countAll(editor: Editor, extras: boolean): Counts {
  const { doc, schema } = editor.state;
  const blocks: PMNode[] = [];
  doc.forEach((node) => {
    if (extras || node.type.name !== "footnotes") blocks.push(node);
  });
  const setup = insertContext(editor)?.pageSetup;
  const parts = extras && setup && !setup.pageless ? [setup.header, setup.footer, ...(setup.differentFirst ? [setup.firstHeader, setup.firstFooter] : [])] : [];
  for (const line of parts.flatMap((part) => part?.content ?? []).map(inlineText)) {
    if (line) blocks.push(schema.nodes.paragraph.create(null, schema.text(line)));
  }
  const all = schema.topNodeType.create(null, blocks);
  return countRange(all, 0, all.content.size);
}

/** The counts, recomputed after edits (300 ms) and selection moves (100 ms). */
function useCounts(editor: Editor, active: boolean, extras: boolean): Snapshot {
  const compute = (): Snapshot => {
    const { doc, selection } = editor.state;
    const { from, to, empty } = selection;
    return {
      all: countAll(editor, extras),
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
  }, [editor, active, extras]);
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
  // Include headers, footers and footnotes: off each time the dialog opens.
  const [extras, setExtras] = useState(false);
  const [menu, setMenu] = useState(false);
  const prefs = useSyncExternalStore(subscribeTypingPrefs, typingPrefs, serverTypingPrefs);
  const pageless = insertContext(editor)?.pageSetup.pageless ?? false;
  const metric: Metric = pageless && prefs.counterMetric === "pages" ? "words" : prefs.counterMetric;
  const snap = useCounts(editor, open || show, open && extras);
  const counterRef = useRef<HTMLButtonElement>(null);
  const format = (n: number) => n.toLocaleString(lang === "zh" ? "zh-CN" : "en-US");

  useEffect(() => {
    const onOpen = () => {
      setDraftShow(readShow());
      setExtras(false);
      setOpen(true);
    };
    window.addEventListener(TYPING_EVENT.wordCount, onOpen);
    return () => window.removeEventListener(TYPING_EVENT.wordCount, onOpen);
  }, []);

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
            onMouseDown={keepFocus}
            onClick={() => setMenu((m) => !m)}
          >
            <span className="docs-wc-caption">
              <Bold {...shown} />
            </span>
            <DropDownIcon size={20} />
          </button>
          <DropdownPanel open={menu} anchorRef={counterRef} onClose={() => setMenu(false)}>
            {metrics.map((m) => (
              <MenuItem
                key={m}
                checked={m === metric}
                onSelect={() => {
                  setTypingPrefs({ counterMetric: m });
                  setMenu(false);
                }}
              >
                <Bold {...metricText(t, m, { ...snap, part: null }, format)} />
              </MenuItem>
            ))}
            <MenuSeparator />
            <MenuItem
              onSelect={() => {
                setMenu(false);
                setShow(false);
                writeShow(false);
              }}
            >
              {t("docsTyping.hideWordCount")}
            </MenuItem>
          </DropdownPanel>
        </div>
      )}
      {open && (
        <ToolbarDialog
          title={t("docsTyping.wordCount")}
          onClose={closeDialog}
          className="docs-wc-dialog"
          submit={{
            run: () => {
              setShow(draftShow);
              writeShow(draftShow);
              closeDialog();
            },
          }}
        >
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
            <input type="checkbox" checked={extras} onChange={(e) => setExtras(e.target.checked)} />
            {t("docsTyping.includeHeadersFooters")}
          </label>
          <label className="docs-ty-check docs-wc-show">
            <input type="checkbox" checked={draftShow} onChange={(e) => setDraftShow(e.target.checked)} />
            {t("docsTyping.displayWhileTyping")}
          </label>
        </ToolbarDialog>
      )}
    </>
  );
}
