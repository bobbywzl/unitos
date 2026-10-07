"use client";

import { useT } from "@/components/lang-provider";

/** The empty project's one action: Add a document, under "No document
    yet.". It opens the same dialog as the header's + (document-bar.tsx),
    which stays where it is. */
export function EmptyProjectAdd() {
  const t = useT();
  return (
    <button
      // The + is pressed after this press has run its course, not inside it.
      onClick={() =>
        setTimeout(() => document.querySelector<HTMLButtonElement>('button[data-track="add-document"]')?.click(), 0)
      }
      data-track="empty-add-document"
      aria-haspopup="dialog"
      className="rounded-full bg-clay px-5 py-2.5 text-sm font-semibold text-clay-fg shadow-soft hover:bg-clay-600"
    >
      {t("panes.addDocument")}
    </button>
  );
}
