"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EditItem } from "@/lib/types";
import { api } from "@/lib/api";

const KIND_LABEL: Record<EditItem["kind"], string> = {
  TEXT_EDIT: "Edit",
  LINK_ADD: "Link added",
  LINK_REMOVE: "Link removed",
  BLOCK_ADD: "Paragraph added",
  BLOCK_REMOVE: "Paragraph removed",
  FORMAT: "Format",
  STYLE: "Style",
};

const kindChip = "rounded-full bg-sand-200 px-2.5 py-0.5 text-[11px] font-semibold text-sand-700";

// Edits tab of the reader side panel. Edits arrive newest-first; TEXT_EDIT
// rows revert while their block exists; BLOCK_REMOVE rows restore the paragraph.
export function EditsPanel({
  edits,
  liveBlockIds,
}: {
  edits: EditItem[];
  liveBlockIds: string[];
}) {
  if (edits.length === 0) {
    return (
      <p className="text-[13px] text-sand-600">
        No edits yet. Click Edit at the top of the reader to edit the page in place.
      </p>
    );
  }

  const live = new Set(liveBlockIds);
  // A removed paragraph that was restored is back — its Restore button hides.
  const restored = new Set(
    edits.filter((e) => e.kind === "BLOCK_ADD" && e.meta?.restoredFrom).map((e) => e.meta!.restoredFrom!),
  );

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] text-sand-500">
        Text you changed shows in <span className="edited-text font-semibold">this color</span> in
        the reader.
      </p>
      {edits.map((edit) => (
        <EditCard
          key={edit.id}
          edit={edit}
          blockLive={edit.blockId !== null && live.has(edit.blockId)}
          alreadyRestored={restored.has(edit.id)}
        />
      ))}
    </div>
  );
}

function EditCard({
  edit,
  blockLive,
  alreadyRestored,
}: {
  edit: EditItem;
  blockLive: boolean;
  alreadyRestored: boolean;
}) {
  const router = useRouter();
  const [working, setWorking] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function revert() {
    if (!edit.blockId || edit.before === null || working) return;
    setWorking(true);
    setErrorText(null);
    try {
      await api(`/api/blocks/${edit.blockId}`, "PATCH", { text: edit.before });
      router.refresh();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Revert failed");
    } finally {
      setWorking(false);
    }
  }

  async function restore() {
    if (working) return;
    setWorking(true);
    setErrorText(null);
    try {
      await api("/api/blocks/restore", "POST", { editId: edit.id });
      router.refresh();
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="rounded-2xl bg-card p-3.5 shadow-soft">
      <div className="flex items-center gap-2">
        <span className={kindChip}>{KIND_LABEL[edit.kind]}</span>
        <span suppressHydrationWarning className="ml-auto text-[11px] text-sand-500">
          {new Date(edit.createdAt).toLocaleString()}
        </span>
      </div>

      {edit.kind === "TEXT_EDIT" ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {edit.before && (
            <div>
              <span className="text-[11px] text-sand-500">was</span>
              <p className="line-clamp-3 text-[13px] text-sand-600 line-through decoration-sand-400">
                {edit.before}
              </p>
            </div>
          )}
          {edit.after && (
            <div>
              <span className="text-[11px] text-sand-500">now</span>
              <p className="line-clamp-3 text-[13px]">{edit.after}</p>
            </div>
          )}
          {edit.blockId && edit.before !== null && blockLive && (
            <div>
              <button
                onClick={() => void revert()}
                disabled={working}
                className="text-xs text-sand-600 hover:text-clay-700 disabled:opacity-50"
              >
                {working ? "Reverting…" : "Revert"}
              </button>
              {errorText && <p className="mt-1 text-[11px] text-red-600">{errorText}</p>}
            </div>
          )}
        </div>
      ) : edit.kind === "FORMAT" ? (
        <p className="mt-2 text-[13px] text-sand-600">
          {edit.meta?.from ?? "?"} → {edit.meta?.to ?? "?"}
        </p>
      ) : edit.kind === "STYLE" ? (
        <p className="mt-2 line-clamp-2 text-[13px] text-sand-600">
          {edit.meta?.style ?? "style"} {edit.meta?.on === false ? "removed from" : "on"} “
          {edit.meta?.quotedText ?? ""}”
        </p>
      ) : edit.kind === "BLOCK_ADD" || edit.kind === "BLOCK_REMOVE" ? (
        <div className="mt-2 flex flex-col gap-1.5">
          <p
            className={`line-clamp-3 text-[13px] ${
              edit.kind === "BLOCK_REMOVE" ? "text-sand-600 line-through decoration-sand-400" : ""
            }`}
          >
            {edit.after ?? edit.before}
          </p>
          {edit.kind === "BLOCK_REMOVE" && !blockLive && !alreadyRestored && (
            <div>
              <button
                onClick={() => void restore()}
                disabled={working}
                className="text-xs text-sand-600 hover:text-clay-700 disabled:opacity-50"
              >
                {working ? "Restoring…" : "Restore"}
              </button>
              {errorText && <p className="mt-1 text-[11px] text-red-600">{errorText}</p>}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-1.5">
          {edit.meta?.quotedText && (
            <p className="line-clamp-2 text-[13px]">{edit.meta.quotedText}</p>
          )}
          <span className={`self-start ${kindChip}`}>→ {edit.meta?.toTitle ?? "document"}</span>
        </div>
      )}
    </div>
  );
}
