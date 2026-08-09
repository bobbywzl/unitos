"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

// Floating feedback button, mounted app-wide (release-edu pattern).
export function FeedbackButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"bug" | "idea" | "other">("bug");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  if (pathname.startsWith("/admin")) return null;

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
        aria-label="Send feedback"
        className="fixed bottom-4 right-4 z-30 rounded-full border border-neutral-300 bg-white px-3 py-2 text-sm shadow-md hover:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"
      >
        Feedback
      </button>
      {open && (
        <div className="fixed bottom-16 right-4 z-30 w-80 rounded-xl border border-neutral-200 bg-white p-4 shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
          <form onSubmit={submit} className="space-y-2">
            <div className="flex gap-1">
              {(["bug", "idea", "other"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-full px-2.5 py-1 text-xs ${
                    category === c
                      ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened, or what would help?"
              rows={4}
              className="w-full rounded-md border border-neutral-300 bg-white p-2 text-sm outline-none focus:border-neutral-500 dark:border-neutral-700 dark:bg-neutral-950"
            />
            {state === "error" && <p className="text-xs text-red-600">Send failed. Try again.</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="px-2 py-1 text-xs text-neutral-500">
                Close
              </button>
              <button
                type="submit"
                disabled={state === "busy" || !message.trim()}
                className="rounded-md bg-neutral-900 px-3 py-1 text-xs text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900"
              >
                {state === "sent" ? "Sent ✓" : state === "busy" ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
