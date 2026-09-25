"use client";

import type { Editor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { registerDocsCommands, type DocsCommand } from "@/components/docs/commands";
import { matchesCombo } from "@/components/docs/keys";
import { COMMENTS_EVENT, PAGE_EDITED_EVENT, type CommentsView } from "@/components/docs/layer/events";

// The Unitos layer inside the page editor (SPEC.md §29). The marks are
// annotation-marks.tsx; the toolbar and cards are the reader's, a comment's
// card layer/comment-card.tsx.

const showComments = (editor: Editor, view: CommentsView) =>
  editor.view.dom.dispatchEvent(new CustomEvent(COMMENTS_EVENT, { bubbles: true, detail: view }));

// View > Comments, as Google Docs has it. Show all comments opens the list
// of every comment with its replies: in Unitos, the Annotations tab.
const COMMENT_COMMANDS: DocsCommand[] = [
  {
    id: "layer:comments-all",
    label: "docsLayer.showAllComments",
    menu: "view",
    keywords: ["comments", "annotations", "评论"],
    shortcut: "Mod+Alt+Shift+A",
    run: (editor) => {
      showComments(editor, "all");
      window.dispatchEvent(new Event("dissect:show-annotations"));
    },
  },
  {
    id: "layer:comments-minimize",
    label: "docsLayer.minimizeComments",
    menu: "view",
    keywords: ["comments", "评论"],
    shortcut: "Mod+Alt+Shift+W M",
    run: (editor) => showComments(editor, "minimized"),
  },
  {
    id: "layer:comments-hide",
    label: "docsLayer.hideComments",
    menu: "view",
    keywords: ["comments", "评论"],
    shortcut: "Mod+Alt+Shift+J",
    run: (editor) => showComments(editor, "hidden"),
  },
];
registerDocsCommands(COMMENT_COMMANDS);

export function UnitosLayer({ editor, documentId, canEdit, editing }: DocsAreaProps) {
  // Viewing mode hides the comments, as in Google Docs; Editing shows them.
  const viewing = canEdit && !editing;
  const wasViewing = useRef(viewing);
  useEffect(() => {
    if (wasViewing.current === viewing) return;
    wasViewing.current = viewing;
    showComments(editor, viewing ? "hidden" : "all");
  }, [editor, viewing]);

  // The words changed: the reader closes its toolbar over the old words.
  useEffect(() => {
    const onUpdate = () => window.dispatchEvent(new CustomEvent(PAGE_EDITED_EVENT, { detail: { documentId } }));
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
    };
  }, [editor, documentId]);

  // The comment commands' shortcuts, in the page's text.
  useEffect(() => {
    const dom = editor.view.dom;
    const onKey = (e: KeyboardEvent) => {
      const command = COMMENT_COMMANDS.find((c) => c.shortcut && matchesCombo(e, c.shortcut));
      if (!command) return;
      e.preventDefault();
      command.run(editor);
    };
    dom.addEventListener("keydown", onKey);
    return () => dom.removeEventListener("keydown", onKey);
  }, [editor]);
  return null;
}
