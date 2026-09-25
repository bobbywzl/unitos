"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useLang } from "@/components/lang-provider";
import type { DocsAreaProps } from "@/components/docs/areas/types";
import { AtMenuHost } from "@/components/docs/insert/at-menu";
import { ChipCardsHost } from "@/components/docs/insert/chip-cards";
import "@/components/docs/insert/commands";
import { ClipboardDialogHost, ContextMenuHost } from "@/components/docs/insert/context-menu";
import { setInsertContext, type InsertContext } from "@/components/docs/insert/context";
import { EquationHost } from "@/components/docs/insert/equation";
import { PlaceFromAddress, TocOptionsHost } from "@/components/docs/insert/hosts";
import { ImageControlsHost } from "@/components/docs/insert/image-controls";
import { SpecialCharsHost } from "@/components/docs/insert/special-chars";
import { TableControlsHost } from "@/components/docs/insert/table-controls";
import { translatorFor } from "@/lib/i18n/dictionaries";

// The insert area (SPEC.md §29): the "@" menu, the right-click menus, and
// the controls of what the text holds — tables, images, chips, equations,
// the table of contents — with the windows they open.
export function InsertLayer({ editor, documentId, notebookId, documents, pageSetup, editing }: DocsAreaProps) {
  const lang = useLang();
  const router = useRouter();
  const ctx = useMemo<InsertContext>(
    () => ({
      documentId,
      notebookId,
      documents,
      pageSetup,
      lang,
      t: translatorFor(lang),
      editing,
      navigate: (href) => router.push(href),
    }),
    [documentId, notebookId, documents, pageSetup, lang, editing, router],
  );

  // The plugins and node views read the same facts.
  useEffect(() => {
    setInsertContext(editor, ctx);
    return () => setInsertContext(editor, null);
  }, [editor, ctx]);

  return (
    <>
      <AtMenuHost editor={editor} ctx={ctx} />
      <ContextMenuHost editor={editor} ctx={ctx} />
      <ChipCardsHost editor={editor} ctx={ctx} />
      <ImageControlsHost editor={editor} ctx={ctx} />
      <TableControlsHost editor={editor} ctx={ctx} />
      <EquationHost editor={editor} />
      <SpecialCharsHost editor={editor} />
      <TocOptionsHost editor={editor} />
      <ClipboardDialogHost editor={editor} />
      <PlaceFromAddress editor={editor} />
    </>
  );
}
