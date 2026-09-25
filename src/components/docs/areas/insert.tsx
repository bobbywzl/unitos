"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLang, useT } from "@/components/lang-provider";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { AtMenuHost } from "@/components/docs/insert/at-menu";
import { ChipCardsHost } from "@/components/docs/insert/chip-cards";
import { ClipboardDialogHost, ContextMenuHost } from "@/components/docs/insert/context-menu";
import { clearInsertContext, onInsert, setInsertContext, useInsertContext } from "@/components/docs/insert/context";
import { openAtMenuHere } from "@/components/docs/insert/at-plugin";
import { toast } from "@/components/docs/insert/ui";

// The insert area (SPEC.md §29): the "@" menu, the right-click menus, and
// the controls of objects in the text — tables, images, chips. It hands the
// page's facts to the insert area's plugins and node views (insert/
// context.ts) and mounts their windows.
export function InsertLayer(props: DocsAreaProps) {
  const { editor, documentId, notebookId, documents, pageSetup, editing } = props;
  const t = useT();
  const lang = useLang();
  const router = useRouter();

  useEffect(() => {
    setInsertContext(editor, {
      documentId,
      notebookId,
      documents,
      pageSetup,
      lang,
      t,
      editing,
      navigate: (href) => router.push(href),
    });
  }, [editor, documentId, notebookId, documents, pageSetup, lang, t, editing, router]);

  useEffect(() => () => clearInsertContext(editor), [editor]);

  // The bus stays on while the layer is mounted: the "@" menu opens only
  // when it is.
  useEffect(
    () =>
      onInsert(editor, (event) => {
        if (event.type === "at-menu") openAtMenuHere(editor.view);
        if (event.type === "toast") toast(event.text);
      }),
    [editor],
  );

  const ctx = useInsertContext(editor);
  if (!ctx) return null;
  return (
    <>
      <AtMenuHost editor={editor} ctx={ctx} />
      <ContextMenuHost editor={editor} ctx={ctx} />
      <ChipCardsHost editor={editor} ctx={ctx} />
      <ClipboardDialogHost editor={editor} />
    </>
  );
}
