"use client";

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { ThumbsDownIcon, ThumbsUpIcon } from "@/components/icons";

// The rating of one AI tool's output (SPEC.md §25): a thumb up or a thumb
// down at the foot of a card, a page, or an answer. A thumb down opens one
// line for what was wrong, optional. The row it writes (POST /api/ratings)
// carries the input the tool ran on and the output it gave, so the tool
// quality loop (scripts/eval) can read the poor answers back as eval cases.
// Fire-and-forget: a failed post changes nothing on screen.
export type RatingTool =
  | "define"
  | "simplify"
  | "analyze"
  | "visualize"
  | "explain"
  | "assistant"
  | "act"
  | "distill"
  | "summarize"
  | "ask"
  | "find"
  | "formalize"
  | "stitch";

export function RatingButtons({
  tool,
  input,
  output,
  notebookId,
  documentId,
  noteId,
  className = "",
}: {
  tool: RatingTool;
  input: string;
  output: string;
  notebookId?: string;
  documentId?: string;
  noteId?: string | null;
  className?: string;
}) {
  const t = useT();
  const [rated, setRated] = useState<"up" | "down" | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [commentSent, setCommentSent] = useState(false);

  async function rate(rating: "up" | "down") {
    if (rated) return;
    setRated(rating);
    try {
      const res = await fetch("/api/ratings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool, rating, input, output, notebookId, documentId, noteId: noteId ?? undefined }),
      });
      const json = (await res.json().catch(() => null)) as { id?: string } | null;
      if (json?.id) setRowId(json.id);
    } catch {
      // The thumb stays; the row is lost. Never a toast for telemetry.
    }
  }

  async function sendComment() {
    const text = comment.trim();
    if (!text || !rowId || commentSent) return;
    setCommentSent(true);
    try {
      await fetch("/api/ratings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: rowId, comment: text }),
      });
    } catch {
      // Same as above: the reader's line is not worth an error.
    }
  }

  const button = (rating: "up" | "down") => (
    <button
      onClick={() => void rate(rating)}
      disabled={rated !== null}
      data-track={`rate:${tool}:${rating}`}
      aria-label={t(rating === "up" ? "common.rateUp" : "common.rateDown")}
      data-tip={t(rating === "up" ? "common.rateUp" : "common.rateDown")}
      className={`rounded-full transition-colors ${
        rated === rating ? "text-clay-800" : rated ? "text-sand-300" : "text-sand-500 hover:text-clay-800"
      } disabled:cursor-default`}
    >
      {rating === "up" ? <ThumbsUpIcon size={13} /> : <ThumbsDownIcon size={13} />}
    </button>
  );

  return (
    <span className={`flex flex-wrap items-center gap-1 ${className}`} data-rating={tool}>
      {button("up")}
      {button("down")}
      {rated === "down" && !commentSent && (
        <span className="flex items-center gap-1">
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void sendComment();
              }
            }}
            placeholder={t("common.rateWhatWasWrong")}
            className="w-44 rounded-full bg-sand-100 px-2.5 py-0.5 text-[11px] outline-none placeholder:text-sand-500"
          />
          <button
            onClick={() => void sendComment()}
            disabled={!comment.trim() || !rowId}
            data-track={`rate:${tool}:comment`}
            className="rounded-full bg-clay-100 px-2 py-0.5 text-[10.5px] font-semibold text-clay-800 hover:bg-clay-200 disabled:opacity-40"
          >
            {t("common.send")}
          </button>
        </span>
      )}
      {rated && (rated === "up" || commentSent) && (
        <span className="text-[10.5px] text-sand-500">{t("common.rateThanks")}</span>
      )}
    </span>
  );
}
