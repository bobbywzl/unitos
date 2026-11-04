"use client";

import { useEffect } from "react";
import { useT } from "@/components/lang-provider";

// A project page that stopped on an error (SPEC.md §6): the error's words
// and Reload, in the app's look, in place of the framework's blank page. A
// server error shows its digest, the id its log line carries.
export default function ProjectError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useT();
  useEffect(() => {
    console.error("[project] the page stopped on an error:", error);
  }, [error]);
  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div role="alert" className="flex max-w-md flex-col gap-3 text-sand-700">
        <h1 className="font-display text-[20px] text-sand-800">{t("common.pageError")}</h1>
        <p className="break-words text-[13px] text-red-600">
          {error.message || String(error)}
          {error.digest ? ` (${error.digest})` : ""}
        </p>
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
