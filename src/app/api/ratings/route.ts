import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentLang } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

// A rating of one AI tool's output (SPEC.md §25): the reader's thumb, with
// the input the tool ran on and the output it gave. The tool quality loop
// (scripts/eval/import-ratings.ts) reads the thumbs down as eval cases.
export const RATING_TOOLS = [
  "simplify",
  "analyze",
  "visualize",
  "explain",
  "assistant",
  "act",
  "distill",
  "summarize",
  "ask",
  "find",
  "formalize",
  "stitch",
] as const;

const MAX_INPUT = 4000;
const MAX_OUTPUT = 12000;
const MAX_PER_DAY = 500;

const ratingSchema = z.object({
  tool: z.enum(RATING_TOOLS),
  rating: z.enum(["up", "down"]),
  notebookId: z.string().min(1).max(64).optional(),
  documentId: z.string().min(1).max(64).optional(),
  noteId: z.string().min(1).max(64).optional(),
  input: z.string().max(MAX_INPUT * 4),
  output: z.string().max(MAX_OUTPUT * 4),
  comment: z.string().max(2000).optional(),
});

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, ratingSchema);
  if (error) return error;
  const user = await currentUser();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await db.toolRating.count({ where: { createdAt: { gte: since } } }).catch(() => 0);
  if (recent >= MAX_PER_DAY) return NextResponse.json({ ok: false }, { status: 429 });
  const row = await db.toolRating.create({
    data: {
      userId: user?.id ?? null,
      notebookId: data.notebookId ?? null,
      documentId: data.documentId ?? null,
      noteId: data.noteId ?? null,
      tool: data.tool,
      rating: data.rating,
      lang: await currentLang(),
      input: data.input.slice(0, MAX_INPUT),
      output: data.output.slice(0, MAX_OUTPUT),
      comment: data.comment?.trim() ? data.comment.trim() : null,
    },
    select: { id: true },
  });
  return NextResponse.json({ ok: true, id: row.id }, { status: 201 });
}

// A thumb down's comment, sent after the thumb: the reader types what was
// wrong, and the row it rated takes it.
const commentSchema = z.object({
  id: z.string().min(1).max(64),
  comment: z.string().min(1).max(2000),
});

export async function PATCH(req: Request) {
  const { data, error } = await parseBody(req, commentSchema);
  if (error) return error;
  const user = await currentUser();
  const updated = await db.toolRating.updateMany({
    where: { id: data.id, userId: user?.id ?? null },
    data: { comment: data.comment.trim() },
  });
  return NextResponse.json({ ok: updated.count > 0 });
}
