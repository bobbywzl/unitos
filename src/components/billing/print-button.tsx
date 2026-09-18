"use client";

import { useT } from "@/components/lang-provider";

// Print on the receipt page: the browser's print dialog.
export function PrintButton() {
  const t = useT();
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-full bg-card px-4 py-1.5 text-xs font-semibold text-sand-700 shadow-soft hover:text-clay-800"
    >
      {t("billing.receiptPrint")}
    </button>
  );
}
