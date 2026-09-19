"use client";

import { useT } from "@/components/lang-provider";

// Print on the receipt page: the browser's print dialog.
export function PrintButton() {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-full bg-(--bl-pill) px-4 py-1.5 text-xs font-semibold text-(--bl-muted) shadow-(--bl-pill-shadow) hover:text-(--bl-link)"
    >
      {t("billing.receiptPrint")}
    </button>
  );
}
