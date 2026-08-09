"use client";

import { useEffect, useState } from "react";

// Notes drawer tabs: notes outline and the assistant panel share the right pane.
export function DrawerTabs({
  notes,
  assistant,
}: {
  notes: React.ReactNode;
  assistant: React.ReactNode;
}) {
  const [tab, setTab] = useState<"notes" | "assistant">("notes");

  // Issue cards jump to their note: switch to the notes tab, scroll, flash.
  useEffect(() => {
    const onShowNote = (e: Event) => {
      const { noteId } = (e as CustomEvent<{ noteId: string }>).detail;
      setTab("notes");
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.classList.add("anchor-flash");
          setTimeout(() => el.classList.remove("anchor-flash"), 2000);
        }
      }, 100);
    };
    window.addEventListener("dissect:show-note", onShowNote);
    return () => window.removeEventListener("dissect:show-note", onShowNote);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex gap-1 border-b border-neutral-200 pb-2 dark:border-neutral-800">
        {(["notes", "assistant"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-2.5 py-1 text-sm ${
              tab === t
                ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900"
                : "text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
            }`}
          >
            {t === "notes" ? "Notes" : "Assistant"}
          </button>
        ))}
      </div>
      <div className={tab === "notes" ? "min-h-0 flex-1" : "hidden"}>{notes}</div>
      <div className={tab === "assistant" ? "min-h-0 flex-1 overflow-y-auto" : "hidden"}>{assistant}</div>
    </div>
  );
}
