"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";

// Floating feedback button, mounted app-wide (release-edu pattern).
export function FeedbackButton() {
  const pathname = usePathname();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"bug" | "idea" | "other">("bug");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  // Escape closes the dialog, like every popover.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKey(e)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (pathname.startsWith("/admin")) return null;

  // Wire values stay "bug" | "idea" | "other"; only the chip label translates.
  const categoryLabel = {
    bug: t("works.feedbackBug"),
    idea: t("works.feedbackIdea"),
    other: t("works.feedbackOther"),
  } as const;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || state === "busy") return;
    setState("busy");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, message: trimmed, page: pathname }),
      });
      if (!res.ok) throw new Error();
      setState("sent");
      setMessage("");
      setTimeout(() => {
        setState("idle");
        setOpen(false);
      }, 1200);
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        aria-label={t("works.sendFeedback")}
        className="fixed right-4 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 rounded-full bg-card px-4 py-2 text-sm text-sand-700 shadow-lift hover:bg-clay-100 hover:text-clay-800 md:bottom-4 print:hidden"
      >
        {t("works.feedback")}
      </button>
      <Presence show={open} exit="pop">
      {open && (
        <div className="pop-in fixed right-4 bottom-16 z-30 w-80 rounded-[28px] bg-card p-5 shadow-float print:hidden">
          <form onSubmit={submit} className="space-y-2">
            <div className="flex gap-1">
              {(["bug", "idea", "other"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    category === c
                      ? "bg-ink text-paper"
                      : "bg-sand-100 text-sand-600 hover:text-clay-800"
                  }`}
                >
                  {categoryLabel[c]}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("works.feedbackPlaceholder")}
              rows={4}
              className="w-full rounded-2xl bg-sand-100 p-3 text-sm outline-none placeholder:text-sand-500"
            />
            {state === "error" && (
              <p className="text-xs text-red-600">{t("works.feedbackFailed")}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-xs text-sand-600 hover:text-clay-700">
                {t("common.close")}
              </button>
              <button
                type="submit"
                disabled={state === "busy" || !message.trim()}
                className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {state === "sent"
                  ? t("works.feedbackSent")
                  : state === "busy"
                    ? t("works.feedbackSending")
                    : t("works.feedbackSend")}
              </button>
            </div>
          </form>
        </div>
      )}
      </Presence>
    </>
  );
}
