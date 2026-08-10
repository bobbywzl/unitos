"use client";

import { useState } from "react";
import { PlusIcon } from "@/components/icons";

export function AddSection({
  onAdd,
  small,
}: {
  onAdd: (title: string) => Promise<void>;
  small?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={
          small
            ? "self-start text-xs text-sand-600 hover:text-clay-700"
            : "flex items-center gap-2 self-start rounded-full border-[1.5px] border-dashed border-sand-400 px-[18px] py-2 text-[13px] text-sand-600 hover:bg-clay-100 hover:text-clay-800"
        }
      >
        {small ? "+ Add section" : <><PlusIcon size={14} />Add section</>}
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-2 self-start"
      onSubmit={async (e) => {
        e.preventDefault();
        const trimmed = title.trim();
        if (!trimmed) return;
        await onAdd(trimmed);
        setTitle("");
        setOpen(false);
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
        placeholder="Section title"
        aria-label="Section title"
        className="w-64 rounded-full bg-card px-4 py-2 text-sm shadow-soft outline-none placeholder:text-sand-500"
      />
      <button
        type="submit"
        className="rounded-full bg-clay px-4 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="rounded-full border border-line px-3 py-1.5 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
      >
        Cancel
      </button>
    </form>
  );
}
