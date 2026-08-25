"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type FeedbackItem = {
  id: string;
  category: string;
  message: string;
  page: string | null;
  userAgent: string | null;
  status: string;
  createdAt: string;
};

const FILTERS = ["new", "seen", "resolved", "all"] as const;
type Filter = (typeof FILTERS)[number];

export function FeedbackInbox({ items }: { items: FeedbackItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("new");
  const newCount = items.filter((f) => f.status === "new").length;
  const visible = filter === "all" ? items : items.filter((f) => f.status === filter);

  async function setStatus(id: string, status: string) {
    await fetch("/api/admin/feedback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    router.refresh();
  }

  return (
    <div>
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-[28px]">Feedback</h1>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                filter === f
                  ? "bg-ink text-paper"
                  : "bg-card text-sand-600 shadow-soft hover:text-clay-800"
              }`}
            >
              {f}
              {f === "new" && newCount > 0 ? ` (${newCount})` : ""}
            </button>
          ))}
        </div>
      </header>

      {visible.length === 0 ? (
        <p className="text-sm text-sand-600">No {filter === "all" ? "" : filter + " "}feedback.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((f) => (
            <li key={f.id} className="rounded-2xl bg-card p-4 shadow-soft">
              <div className="flex items-center gap-2 text-xs text-sand-600">
                <span
                  className={`rounded-full px-2.5 py-0.5 font-semibold ${
                    f.category === "bug"
                      ? "bg-clay-200 text-clay-800"
                      : f.category === "idea"
                        ? "bg-sage-200 text-sage-800"
                        : "bg-sand-200 text-sand-700"
                  }`}
                >
                  {f.category}
                </span>
                <span>{new Date(f.createdAt).toLocaleString()}</span>
                {f.page && <span className="truncate">· {f.page}</span>}
                <span className="ml-auto">{f.status}</span>
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{f.message}</p>
              <div className="mt-2 flex gap-2">
                {f.status !== "seen" && (
                  <button
                    onClick={() => void setStatus(f.id, "seen")}
                    className="text-xs text-sand-600 hover:text-clay-700"
                  >
                    Mark seen
                  </button>
                )}
                {f.status !== "resolved" && (
                  <button
                    onClick={() => void setStatus(f.id, "resolved")}
                    className="text-xs font-semibold text-sage-700 hover:text-sage-800"
                  >
                    Resolve
                  </button>
                )}
                {f.status === "resolved" && (
                  <button
                    onClick={() => void setStatus(f.id, "new")}
                    className="text-xs text-sand-600 hover:text-clay-700"
                  >
                    Reopen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
