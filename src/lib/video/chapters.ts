import { bumpDocument } from "@/lib/collab";
import { db } from "@/lib/db";
import type { ContentsEntry } from "@/lib/contents";
import { JEV_MODEL, jevEnabled, mapLimit, systemOne } from "@/lib/jev";

// Chapters (SPEC.md §26): a media document's contents, one part per topic
// of the transcript, built on Jev. Jev reads the transcript in chunks and
// answers one yes/no per line — does a new topic start here — and code
// makes the chapters: the lines Jev is sure of, at least MIN_GAP_SECONDS
// apart (the surer line wins when two are closer), at most MAX_CHAPTERS
// (the surest kept), the first line always the first chapter. A chapter's
// title is its first line's opening words, since Jev writes no text. The
// chapters store as the document's contents entries, each pointing at the
// transcript line it starts on, so the contents menu of the media pane
// jumps the player to it.

const MIN_LINES = 12;
const CHUNK = 40;
const LEAD_IN = 4; // lines before the chunk Jev reads for context
const PARALLEL = 4;
const BOUNDARY_MIN = 0.6;
const MIN_GAP_SECONDS = 45;
const MAX_CHAPTERS = 40;
const TITLE_CHARS = 60;

type Line = { id: string; text: string; startTime: number };

const stamp = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** A chapter's title: the line's opening words, cut at a word. */
export function chapterTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= TITLE_CHARS) return clean;
  const cut = clean.slice(0, TITLE_CHARS);
  const at = cut.lastIndexOf(" ");
  return `${at > 20 ? cut.slice(0, at) : cut}…`;
}

/** The chapter starts among the lines, by Jev's answers and the rules
    above; null when Jev fails. */
export async function chapterStarts(lines: Line[], userId: string | null): Promise<Line[] | null> {
  const chunks: { lines: Line[]; before: Line[] }[] = [];
  for (let i = 0; i < lines.length; i += CHUNK) {
    chunks.push({ lines: lines.slice(i, i + CHUNK), before: lines.slice(Math.max(0, i - LEAD_IN), i) });
  }
  const scored = new Map<string, number>();
  let failed = false;
  await mapLimit(chunks, PARALLEL, async (chunk) => {
    const result = await systemOne({
      state: {
        before: chunk.before.map((l) => ({ time: stamp(l.startTime), text: l.text })),
        lines: chunk.lines.map((l, n) => ({ n, time: stamp(l.startTime), text: l.text })),
      },
      questions: Object.fromEntries(
        chunk.lines.map((_, n) => [
          `line_${n}`,
          {
            type: "noul" as const,
            instructions: `Line ${n} starts a new topic: what is said from it on is about something the lines before it were not.`,
            criteria: {
              true: "The line opens a new subject, question, section, or example that the lines before it did not deal with.",
              false: "The line continues the subject of the lines before it.",
            },
          },
        ]),
      ),
      usage: { userId, feature: "chapters", model: JEV_MODEL },
      label: "CHAPTERS",
    });
    if (!result.ok) {
      failed = true;
      console.warn("[chapters] jev failed:", result.error);
      return;
    }
    chunk.lines.forEach((l, n) => {
      const a = result.answers[`line_${n}`];
      if (a?.type === "noul") scored.set(l.id, a.noul);
    });
  });
  if (failed) return null;
  // The sure lines, in time order; a line too close to a surer one drops.
  const sure = lines.filter((l) => (scored.get(l.id) ?? 0) >= BOUNDARY_MIN);
  const kept: Line[] = [];
  for (const line of sure) {
    const last = kept[kept.length - 1];
    if (last && line.startTime - last.startTime < MIN_GAP_SECONDS) {
      if ((scored.get(line.id) ?? 0) > (scored.get(last.id) ?? 0)) kept[kept.length - 1] = line;
      continue;
    }
    kept.push(line);
  }
  const top = kept
    .sort((a, b) => (scored.get(b.id) ?? 0) - (scored.get(a.id) ?? 0))
    .slice(0, MAX_CHAPTERS - 1)
    .sort((a, b) => a.startTime - b.startTime);
  const first = lines[0];
  return top.length > 0 && top[0].id === first.id ? top : [first, ...top.filter((l) => l.startTime - first.startTime >= MIN_GAP_SECONDS)];
}

/** Build a media document's chapters and store them as its contents.
    Returns the entries; [] for a transcript too short to have chapters.
    Throws when Jev is off or fails. */
export async function buildChapters(documentId: string, userId: string | null): Promise<ContentsEntry[]> {
  if (!jevEnabled()) throw new Error("TYPESAFE_API_KEY is not set");
  const blocks = await db.block.findMany({
    where: { documentId, type: "TRANSCRIPT", startTime: { not: null } },
    orderBy: { order: "asc" },
    select: { id: true, text: true, startTime: true },
  });
  const lines: Line[] = blocks.flatMap((b) =>
    b.startTime !== null && b.text.trim() ? [{ id: b.id, text: b.text.trim(), startTime: b.startTime }] : [],
  );
  if (lines.length < MIN_LINES) return [];
  const starts = await chapterStarts(lines, userId);
  if (!starts) throw new Error("Jev did not answer");
  const entries: ContentsEntry[] = starts.map((l) => ({ title: chapterTitle(l.text), blockId: l.id, level: 1 }));
  await db.document.update({ where: { id: documentId }, data: { contents: entries } });
  await bumpDocument(documentId);
  return entries;
}
