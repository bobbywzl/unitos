"use client";

import type { Editor } from "@tiptap/core";
import { useT } from "@/components/lang-provider";
import { isSuggesting } from "@/components/docs/ext/suggest";
import { MenuItem, MenuSeparator } from "@/components/docs/menu";
import { SeparateImagesIcon, SideBySideIcon } from "@/components/docs/insert/icons";
import { nextToJoin, rowOf, separateImages, sideBySideWithNext } from "@/components/docs/insert/image-row";
import { NEW_GLOW_CLASS, NewPill, useNewFeature } from "@/components/new-feature";

// An image row's items in a menu (SPEC.md §29): Side by side with next image
// when the block after the item's line is an image or a figure object, and
// Separate images on an item in an image row. Off in Suggesting mode, where
// a row is neither made nor taken apart.

export type ImageRowChoices = { sideBySide: boolean; separate: boolean };

/** Which of the two the item at `pos` offers now. */
export function imageRowChoices(editor: Editor, pos: number): ImageRowChoices {
  if (!editor.isEditable || isSuggesting(editor)) return { sideBySide: false, separate: false };
  const { doc } = editor.state;
  return { sideBySide: nextToJoin(doc, pos) !== null, separate: rowOf(doc, pos) !== null };
}

/** Side by side with next image, with the New glow while the release is new. */
export function SideBySideItem({ editor, pos, onDone }: { editor: Editor; pos: number; onDone: () => void }) {
  const t = useT();
  const glow = useNewFeature("imageRow");
  return (
    <MenuItem
      icon={<SideBySideIcon size={18} />}
      className={glow.isNew ? NEW_GLOW_CLASS : ""}
      label={t("docsInsert.sideBySide")}
      track="docs:image-side-by-side"
      onSelect={() => {
        onDone();
        glow.seen();
        sideBySideWithNext(editor.view, pos);
      }}
    >
      {t("docsInsert.sideBySide")}
      {glow.isNew && <NewPill />}
    </MenuItem>
  );
}

export function SeparateImagesItem({ editor, pos, onDone }: { editor: Editor; pos: number; onDone: () => void }) {
  const t = useT();
  return (
    <MenuItem
      icon={<SeparateImagesIcon size={18} />}
      track="docs:image-separate"
      onSelect={() => {
        onDone();
        separateImages(editor.view, pos);
      }}
    >
      {t("docsInsert.separateImages")}
    </MenuItem>
  );
}

/** The image toolbar's More menu: the two under a line, when either is on offer. */
export function ImageRowItems({ editor, pos, onDone }: { editor: Editor; pos: number; onDone: () => void }) {
  const choices = imageRowChoices(editor, pos);
  if (!choices.sideBySide && !choices.separate) return null;
  return (
    <>
      <MenuSeparator />
      {choices.sideBySide && <SideBySideItem editor={editor} pos={pos} onDone={onDone} />}
      {choices.separate && <SeparateImagesItem editor={editor} pos={pos} onDone={onDone} />}
    </>
  );
}
