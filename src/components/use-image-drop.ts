"use client";

import { useRef, useState } from "react";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { refuseImage, uploadImage, type ImageRefusal } from "@/lib/images";

// Dropping an image on a note or on a paragraph in the reader's edit mode
// (SPEC.md §16). One hook for both surfaces: it tells a drag carrying files
// from any other drag, refuses what the tier does not allow before anything
// leaves the browser, stores the rest, and hands back the images in the order
// they were dropped.
//
// The drop stops here: the workspace listens for dropped files on the window
// and adds them as documents (document-bar.tsx), which is what a drop on the
// page still does — but an image dropped on a note belongs to the note.

const REFUSAL_KEY: Record<ImageRefusal, Parameters<TFunc>[0]> = {
  "not-image": "panes.dropImageOnly",
  premium: "api.imageNeedsPremium",
  "too-large": "api.imageTooLarge",
};

export type DroppedImage = { id: string; url: string; name: string };

export function useImageDrop({
  premium,
  enabled = true,
  t,
  onImages,
  onError,
}: {
  premium: boolean;
  enabled?: boolean;
  t: TFunc;
  onImages: (images: DroppedImage[]) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const [over, setOver] = useState(false);
  const busy = useRef(false);

  const hasFiles = (e: React.DragEvent) => e.dataTransfer?.types.includes("Files") ?? false;

  function onDragOver(e: React.DragEvent) {
    if (!enabled || !hasFiles(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(true);
  }

  function onDragLeave(e: React.DragEvent) {
    if (!enabled || !hasFiles(e)) return;
    setOver(false);
  }

  async function onDrop(e: React.DragEvent) {
    if (!enabled || !hasFiles(e)) return;
    const files = [...(e.dataTransfer?.files ?? [])];
    // Only images belong to a note or a paragraph; anything else keeps
    // travelling to the window, where it is added as a document.
    if (files.length === 0 || !files.some((f) => refuseImage(f, true) !== "not-image")) {
      setOver(false);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
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
