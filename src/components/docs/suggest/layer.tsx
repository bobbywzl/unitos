"use client";

import { useEditorState, type Editor } from "@tiptap/react";
import { useEffect, useMemo, useState } from "react";
import { useCollab } from "@/components/collab/collab-context";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { registerDocsCommands } from "@/components/docs/commands";
import { setSuggesting, settleSuggestions, suggestionAt, suggestionAuthor, suggestionIds } from "@/components/docs/ext/suggest";
import { SuggestionCard } from "@/components/docs/suggest/card";
import { ReviewPanel } from "@/components/docs/suggest/review";
import { personColor } from "@/lib/person";

// Suggesting mode in the page editor (SPEC.md §29). In Suggesting mode the
// reader's edits become their suggestions (ext/suggest.ts). Each author's
// suggestions take their person color; the one the caret stands in shows
// its card; Review suggested edits steps through them. Viewing mode hides
// them all.

/** Raised on the page's text by Review suggested edits. */
const REVIEW_EVENT = "docs:review-suggestions";

const settleable = (editor: Editor) => editor.isEditable && suggestionIds(editor.state.doc).length > 0;

registerDocsCommands([
  {
    id: "suggest:review",
    label: "docsSuggest.reviewSuggestedEdits",
    menu: "tools",
    keywords: ["suggestions", "track changes", "建议"],
    shortcut: "Mod+Alt+O U",
    run: (editor) => editor.view.dom.dispatchEvent(new Event(REVIEW_EVENT, { bubbles: true })),
  },
  {
    id: "suggest:accept-all",
    label: "docsSuggest.acceptAllSuggestions",
    menu: "tools",
    keywords: ["suggestions", "建议"],
    run: (editor) => settleSuggestions(editor, true),
    enabled: settleable,
  },
  {
    id: "suggest:reject-all",
    label: "docsSuggest.rejectAllSuggestions",
    menu: "tools",
    keywords: ["suggestions", "建议"],
    run: (editor) => settleSuggestions(editor, false),
    enabled: settleable,
  },
]);

export function SuggestLayer({ editor, canEdit, editing, suggesting }: DocsAreaProps & { suggesting: boolean }) {
  const { myId, people } = useCollab();
  const [reviewing, setReviewing] = useState(false);
  const { active, ids } = useEditorState({
    editor,
    selector: ({ editor: e }) => ({ active: suggestionAt(e.state), ids: suggestionIds(e.state.doc) }),
  });
  const viewing = canEdit && !editing;

  useEffect(() => {
    setSuggesting(editor, suggesting ? myId : null);
  }, [editor, suggesting, myId]);

  // While the document holds suggestions the page keeps the margin their
  // cards open in, as Google Docs keeps it for its discussions.
  const holdMargin = ids.length > 0 && !viewing;
  useEffect(() => {
    const pane = editor.view.dom.closest("[data-reader-root]");
    const hold = (on: boolean) => {
      pane?.dispatchEvent(new CustomEvent<boolean>("docs:margin", { detail: on }));
    };
    hold(holdMargin);
    return () => hold(false);
  }, [editor, holdMargin]);

  // Review suggested edits: its command, and Google's chord (hold Ctrl+Alt,
  // press O then U).
  useEffect(() => {
    const dom = editor.view.dom;
    const shell = dom.closest("[data-docs-editor]");
    const open = () => setReviewing(true);
    let chordAt = 0;
    const onKey = (e: KeyboardEvent) => {
      const focused = document.activeElement;
      if (!shell || (focused && focused !== document.body && !shell.contains(focused))) return;
      if (!(e.ctrlKey || e.metaKey) || !e.altKey || e.shiftKey) return;
      if (e.code === "KeyO") chordAt = Date.now();
      else if (e.code === "KeyU" && Date.now() - chordAt < 2500) {
        chordAt = 0;
        e.preventDefault();
        open();
      }
    };
    dom.addEventListener(REVIEW_EVENT, open);
    window.addEventListener("keydown", onKey, true);
    return () => {
      dom.removeEventListener(REVIEW_EVENT, open);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [editor]);

  // Each author's color, and a tint on the suggestion whose card is open.
  const colors = useMemo(
    () =>
      [...new Set(ids.map(suggestionAuthor))].map(
        (author) => `.docs-prose [data-author="${CSS.escape(author)}"]{--docs-suggest:${people[author]?.color ?? personColor(author)}}`,
      ),
    [ids, people],
  );
  const card = active && !viewing ? active : null;
  const pane = card ? editor.view.dom.closest<HTMLElement>("[data-reader-root]") : null;
  const header = editor.view.dom.closest("[data-docs-editor]")?.querySelector<HTMLElement>(".docs-header");
  return (
    <>
      <style>
        {[...colors, card ? `.docs-prose [data-suggestion="${CSS.escape(card)}"]{--docs-suggest-tint:24%}` : ""].join("\n")}
      </style>
      {card && pane && <SuggestionCard key={card} editor={editor} pane={pane} id={card} canSettle={canEdit && editing} />}
      {reviewing && header && !viewing && (
        <ReviewPanel editor={editor} header={header} canSettle={canEdit && editing} onClose={() => setReviewing(false)} />
      )}
    </>
  );
}
