"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLang } from "@/components/lang-provider";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { AtMenuHost } from "@/components/docs/insert/at-menu";
import { openAtMenuHere } from "@/components/docs/insert/at-plugin";
import { ChipCardsHost } from "@/components/docs/insert/chip-cards";
import "@/components/docs/insert/commands";
import { ClipboardDialogHost, ContextMenuHost } from "@/components/docs/insert/context-menu";
import { clearInsertContext, onInsert, setInsertContext, useInsertContext } from "@/components/docs/insert/context";
import { EquationHost } from "@/components/docs/insert/equation";
import { EmojiPickerHost, ImageInsertHost, PlaceFromAddress, TocOptionsHost } from "@/components/docs/insert/hosts";
import { ImageControlsHost } from "@/components/docs/insert/image-controls";
import { SpecialCharsHost } from "@/components/docs/insert/special-chars";
import { TableControlsHost } from "@/components/docs/insert/table-controls";
import { toast } from "@/components/docs/insert/ui";
import { translatorFor } from "@/lib/i18n/dictionaries";

// The insert area (SPEC.md §29): the "@" menu, the right-click menus, and
// the controls of objects in the text — tables, images, chips, equations,
// the table of contents — and the windows they open. It hands the page's
// facts to the insert area's plugins and node views (insert/context.ts);
// the windows open from the per-editor bus there.
export function InsertLayer(props: DocsAreaProps) {
  const { editor, documentId, notebookId, documents, pageSetup, editing } = props;
  const lang = useLang();
  const router = useRouter();

  // One context per change of the page's facts (a new translator each
  // render would set it again and again).
  useEffect(() => {
    setInsertContext(editor, {
      documentId,
      notebookId,
      documents,
      pageSetup,
      lang,
      t: translatorFor(lang),
      editing,
      navigate: (href) => router.push(href),
    });
  }, [editor, documentId, notebookId, documents, pageSetup, lang, editing, router]);

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
      <ImageControlsHost editor={editor} ctx={ctx} />
      <TableControlsHost editor={editor} ctx={ctx} />
      <EquationHost editor={editor} />
      <SpecialCharsHost editor={editor} />
      <EmojiPickerHost editor={editor} />
      <ImageInsertHost editor={editor} />
      <TocOptionsHost editor={editor} />
      <ClipboardDialogHost editor={editor} />
      <PlaceFromAddress editor={editor} />
    </>
  );
}
