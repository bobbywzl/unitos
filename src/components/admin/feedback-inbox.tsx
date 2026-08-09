"use client";

import Link from "next/link";
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

  async function signOut() {
    await fetch("/api/admin/auth", { method: "DELETE" });
    router.push("/admin/login");
  }

  return (
    <div>
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-xl font-semibold">Feedback</h1>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full px-2.5 py-1 text-xs ${
                filter === f
                  ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                  : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
              }`}
            >
              {f}
              {f === "new" && newCount > 0 ? ` (${newCount})` : ""}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <Link href="/" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
            App
          </Link>
          <button onClick={() => void signOut()} className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
            Sign out
          </button>
        </div>
      </header>

      {visible.length === 0 ? (
        <p className="text-sm text-neutral-500">No {filter === "all" ? "" : filter + " "}feedback.</p>
      ) : (
        <ul className="space-y-3">
          {visible.map((f) => (
            <li key={f.id} className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="flex items-center gap-2 text-xs text-neutral-500">
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    f.category === "bug"
                      ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                      : f.category === "idea"
                        ? "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300"
                        : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  }`}
                >
                  {f.category}
                </span>
                <span>{new Date(f.createdAt).toLocaleString()}</span>
                {f.page && <span className="truncate">· {f.page}</span>}
                <span className="ml-auto">{f.status}</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{f.message}</p>
              <div className="mt-2 flex gap-2">
                {f.status !== "seen" && (
                  <button
                    onClick={() => void setStatus(f.id, "seen")}
                    className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
                  >
                    Mark seen
                  </button>
                )}
                {f.status !== "resolved" && (
                  <button
                    onClick={() => void setStatus(f.id, "resolved")}
                    className="text-xs text-emerald-600 hover:text-emerald-800"
                  >
                    Resolve
                  </button>
                )}
                {f.status === "resolved" && (
                  <button
                    onClick={() => void setStatus(f.id, "new")}
                    className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
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
