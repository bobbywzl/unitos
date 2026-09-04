"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EditItem } from "@/lib/types";
import { api } from "@/lib/api";
import { useCollab } from "@/components/collab/collab-context";
import { AuthorChip } from "@/components/collab/person-badge";
import { ReplyThread } from "@/components/collab/reply-thread";
import { LocateIcon } from "@/components/icons";
import { useLang, useT } from "@/components/lang-provider";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";

const KIND_KEY: Record<EditItem["kind"], TKey> = {
  TEXT_EDIT: "common.edit",
  LINK_ADD: "panels.kindLinkAdd",
  LINK_REMOVE: "panels.kindLinkRemove",
  BLOCK_ADD: "panels.kindBlockAdd",
  BLOCK_REMOVE: "panels.kindBlockRemove",
  FORMAT: "panels.kindFormat",
  STYLE: "panels.kindStyle",
};

// FORMAT and STYLE meta values are wire data; these map them to display labels.
// Unknown values show raw.
const FORMAT_KEY: Record<string, TKey> = {
  paragraph: "panels.formatParagraph",
  h1: "panels.formatH1",
  h2: "panels.formatH2",
  h3: "panels.formatH3",
  list: "panels.formatList",
  numbered: "panels.formatNumbered",
};
const STYLE_KEY: Record<string, TKey> = {
  bold: "panels.styleBold",
  italic: "panels.styleItalic",
  underline: "panels.styleUnderline",
  "color-clay": "panels.styleColorClay",
  "color-sage": "panels.styleColorSage",
  "color-gold": "panels.styleColorGold",
  "color-plum": "panels.styleColorPlum",
};

function formatLabel(t: TFunc, kind: string | undefined): string {
  if (kind === undefined) return "?";
  const key = FORMAT_KEY[kind];
  return key ? t(key) : kind;
}

function styleLabel(t: TFunc, style: string | undefined): string {
  if (style === undefined) return t("panels.styleFallback");
  const key = STYLE_KEY[style];
  return key ? t(key) : style;
}

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
  const t = useT();

  if (edits.length === 0) {
    return <p className="text-[13px] text-sand-600">{t("panels.editsEmpty")}</p>;
  }

  const live = new Set(liveBlockIds);
  // A removed paragraph that was restored is back — its Restore button hides.
  const restored = new Set(
    edits.filter((e) => e.kind === "BLOCK_ADD" && e.meta?.restoredFrom).map((e) => e.meta!.restoredFrom!),
  );

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] text-sand-500">
        {t("panels.editedColorPre")}
        <span className="edited-text font-semibold">{t("panels.editedColorWord")}</span>
        {t("panels.editedColorPost")}
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
  const t = useT();
  const lang = useLang();
  // Dates follow the app language; English keeps the browser default.
  const dateLocale = lang === "zh" ? "zh-CN" : undefined;
  const { canEdit } = useCollab();
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
      setErrorText(err instanceof Error ? err.message : t("panels.revertFailed"));
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
      setErrorText(err instanceof Error ? err.message : t("panels.restoreFailed"));
    } finally {
      setWorking(false);
    }
  }

  // Jump to the edited block: the reader scrolls to it and flashes it (the
  // same jump as an annotation's), while the block is still in the document.
  function jump() {
    if (!edit.blockId) return;
    window.dispatchEvent(new CustomEvent("dissect:flash-block", { detail: { blockId: edit.blockId } }));
  }

  return (
    <div className="rounded-2xl bg-card p-3.5 shadow-soft">
      <div className="flex items-center gap-2">
        <span className={kindChip}>{t(KIND_KEY[edit.kind])}</span>
        {edit.blockId && blockLive && (
          <button
            onClick={jump}
            data-track="edit-jump"
            aria-label={t("panels.jumpToBlock")}
            title={t("panels.jumpToBlock")}
            className="flex size-6 items-center justify-center rounded-full bg-clay-100 text-clay-800 hover:bg-clay-200"
          >
            <LocateIcon size={11} />
          </button>
        )}
        <span className="ml-auto flex items-center gap-2">
          <AuthorChip createdById={edit.userId} nameless />
          <span suppressHydrationWarning className="text-[11px] text-sand-500">
            {new Date(edit.createdAt).toLocaleString(dateLocale)}
          </span>
        </span>
      </div>

      {edit.kind === "TEXT_EDIT" ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {edit.before && (
            <div>
              <span className="text-[11px] text-sand-500">{t("panels.wasLabel")}</span>
              <p className="line-clamp-3 text-[13px] text-sand-600 line-through decoration-sand-400">
                {edit.before}
              </p>
            </div>
          )}
          {edit.after && (
            <div>
              <span className="text-[11px] text-sand-500">{t("panels.nowLabel")}</span>
              <p className="line-clamp-3 text-[13px]">{edit.after}</p>
            </div>
          )}
          {edit.blockId && edit.before !== null && blockLive && canEdit && (
            <div>
              <button
                onClick={() => void revert()}
                data-track="edit-revert"
                disabled={working}
                className="text-xs text-sand-600 hover:text-clay-700 disabled:opacity-50"
              >
                {working ? t("panels.reverting") : t("panels.revert")}
              </button>
              {errorText && <p className="mt-1 text-[11px] text-red-600">{errorText}</p>}
            </div>
          )}
        </div>
      ) : edit.kind === "FORMAT" ? (
        <p className="mt-2 text-[13px] text-sand-600">
          {formatLabel(t, edit.meta?.from)} → {formatLabel(t, edit.meta?.to)}
        </p>
      ) : edit.kind === "STYLE" ? (
        <p className="mt-2 line-clamp-2 text-[13px] text-sand-600">
          {t(edit.meta?.on === false ? "panels.styleRemoved" : "panels.styleApplied", {
            style: styleLabel(t, edit.meta?.style),
            text: edit.meta?.quotedText ?? "",
          })}
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
          {edit.kind === "BLOCK_REMOVE" && !blockLive && !alreadyRestored && canEdit && (
            <div>
              <button
                onClick={() => void restore()}
                data-track="edit-restore"
                disabled={working}
                className="text-xs text-sand-600 hover:text-clay-700 disabled:opacity-50"
              >
                {working ? t("panels.restoring") : t("panels.restore")}
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
          <span className={`self-start ${kindChip}`}>
            → {edit.meta?.toTitle ?? t("panels.documentFallback")}
          </span>
        </div>
      )}
      <ReplyThread target={{ blockEditId: edit.id }} replies={edit.replies} />
    </div>
  );
}
