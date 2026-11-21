"use client";

import { useEffect, useState } from "react";
import { lastControls } from "@/components/click-tracker";
import { useT } from "@/components/lang-provider";

// A project page that stopped on an error (SPEC.md §6): the error's words
// and Reload, in the app's look, in place of the framework's blank page. A
// server error shows its digest, the id its log line carries. Under the
// error, the controls pressed last in this tab (click-tracker.tsx), so a
// screenshot of this page says what led to the stop.
export default function ProjectError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  // Read once, when the page stops: later presses are on this page.
  const [trail] = useState(() => lastControls());
  useEffect(() => {
    console.error("[project] the page stopped on an error:", error, "last pressed:", trail);
  }, [error, trail]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div role="alert" className="flex max-w-md flex-col gap-3 text-sand-700">
        <h1 className="font-display text-[20px] text-sand-800">{t("common.pageError")}</h1>
        <p className="break-words text-[13px] text-red-600">
          {error.message || String(error)}
          {error.digest ? ` (${error.digest})` : ""}
        </p>
        {trail.length > 0 && (
          <p className="break-words font-mono text-[11px] text-sand-500">{t("common.pageErrorTrail", { trail: trail.join(" → ") })}</p>
        )}
        <div className="flex gap-2">
          <button onClick={() => window.location.reload()} className="rounded-full bg-ink px-3.5 py-1.5 text-xs font-semibold text-paper">
            {t("common.reload")}
          </button>
          <button onClick={reset} className="rounded-full bg-sand-100 px-3.5 py-1.5 text-xs font-semibold text-sand-700">
            {t("common.tryAgain")}
          </button>
        </div>
      </div>
    </main>
  );
}
