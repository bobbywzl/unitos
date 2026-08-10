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
        className="fixed right-4 bottom-4 z-30 rounded-full bg-card px-4 py-2 text-sm text-sand-700 shadow-lift hover:bg-clay-100 hover:text-clay-800"
      >
        Feedback
      </button>
      {open && (
        <div className="fixed right-4 bottom-16 z-30 w-80 rounded-[28px] bg-card p-5 shadow-float">
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
                  {c}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What happened, or what would help?"
              rows={4}
              className="w-full rounded-2xl bg-sand-100 p-3 text-sm outline-none placeholder:text-sand-500"
            />
            {state === "error" && <p className="text-xs text-red-600">Send failed. Try again.</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-xs text-sand-600 hover:text-clay-700">
                Close
              </button>
              <button
                type="submit"
                disabled={state === "busy" || !message.trim()}
                className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
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
