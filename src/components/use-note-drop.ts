"use client";

import { useRef, useState } from "react";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { refuseImage, uploadImage, type ImageRefusal } from "@/lib/images";
import { hasDroppedLinks, readDroppedLinks, type DroppedLink } from "@/lib/note-links";
import { hasQuoteDrag, readQuoteDrag, type QuoteDrag } from "@/lib/quote-drag";

// Dropping something into a note (SPEC.md §6, §16): an image on a note card,
// the floating card, or a paragraph in the reader's edit mode, and a link —
// from a page, a bookmark, or the address bar — on a note. One hook for every
// surface: it tells a drag carrying files or links from any other drag,
// refuses what the tier does not allow before anything leaves the browser,
// stores the images, and hands back what was dropped in the order it came.
//
// The drop stops here: the workspace listens for dropped files on the window
// and adds them as documents (document-bar.tsx), which is what a drop on the
// page still does — but an image or a link dropped on a note belongs to the
// note. A surface that takes no links (a paragraph) lets a link travel on.

const REFUSAL_KEY: Record<ImageRefusal, Parameters<TFunc>[0]> = {
  "not-image": "panes.dropImageOnly",
  premium: "api.imageNeedsPremium",
  "too-large": "api.imageTooLarge",
};

export type DroppedImage = { id: string; url: string; name: string };

/** What the drag over the surface carries: images, links, a quote from the
    reader (lib/quote-drag.ts), or nothing it takes. */
export type DropKind = "images" | "links" | "quote" | null;

export function useNoteDrop({
  premium,
  enabled = true,
  t,
  onImages,
  onLinks,
  onQuote,
  onError,
}: {
  premium: boolean;
  enabled?: boolean;
  t: TFunc;
  onImages: (images: DroppedImage[]) => void | Promise<void>;
  /** Links dropped on the surface. Unset: the surface takes no links. */
  onLinks?: (links: DroppedLink[]) => void | Promise<void>;
  /** A quote dragged from the reader. Unset: the surface takes no quotes. */
  onQuote?: (drag: QuoteDrag) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [over, setOver] = useState<DropKind>(null);
  const busy = useRef(false);

  const hasFiles = (e: React.DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;
  const kindOf = (e: React.DragEvent): DropKind => {
    if (!enabled) return null;
    if (hasFiles(e)) return "images";
    if (onQuote && hasQuoteDrag(e.dataTransfer)) return "quote";
    if (onLinks && hasDroppedLinks(e.dataTransfer)) return "links";
    return null;
  };

  function onDragOver(e: React.DragEvent) {
    const kind = kindOf(e);
    if (!kind) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(kind);
  }

  function onDragLeave(e: React.DragEvent) {
    if (!kindOf(e)) return;
    setOver(null);
  }

  async function onDrop(e: React.DragEvent) {
    const kind = kindOf(e);
    if (!kind) return;
    if (kind === "quote") {
      const drag = readQuoteDrag(e.dataTransfer);
      setOver(null);
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        await onQuote?.(drag);
      } catch (err) {
        onError(err instanceof Error ? err.message : t("common.requestFailed"));
      }
      return;
    }
    if (kind === "links") {
      const links = readDroppedLinks(e.dataTransfer);
      setOver(null);
      if (links.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        await onLinks?.(links);
      } catch (err) {
        onError(err instanceof Error ? err.message : t("common.requestFailed"));
      }
      return;
    }
    const files = [...(e.dataTransfer?.files ?? [])];
    // Only images belong to a note or a paragraph; anything else keeps
    // travelling to the window, where it is added as a document.
    if (files.length === 0 || !files.some((f) => refuseImage(f, true) !== "not-image")) {
      setOver(null);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    if (busy.current) return;
    const refusal = files.map((f) => refuseImage(f, premium)).find((r) => r !== null);
    if (refusal) {
      onError(t(REFUSAL_KEY[refusal]));
      return;
    }
    busy.current = true;
    try {
      const images: DroppedImage[] = [];
      for (const file of files) {
        const stored = await uploadImage(file);
        images.push({ ...stored, name: file.name });
      }
      await onImages(images);
    } catch (err) {
      onError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      busy.current = false;
    }
  }

  return { over, handlers: { onDragOver, onDragLeave, onDrop } };
}
