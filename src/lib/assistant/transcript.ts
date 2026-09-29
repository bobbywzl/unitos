import { contentsEntries } from "@/lib/contents";
import { db } from "@/lib/db";
import { parseSpeakers, type Speaker } from "@/lib/video/types";

// What the assistant reads of a video's or an audio's transcript beyond its
// lines (SPEC.md §11): the voices and who speaks from which line, for the
// prompt; the lines chapters start on and each line's anchored words, for
// the plan's checks (lib/transcript-lines.ts), so the plan card offers only
// the joins and splits the route takes.

// Past this many turns the prompt lists no more: a long recording's later
// turns show in the lines themselves.
const TURNS_MAX = 400;

export type TranscriptContext = {
  speakers: Speaker[];
  /** The prompt's lines on the voices; none when no voice is known. */
  lines: string[];
  chapterStarts: ReadonlySet<string>;
  anchors: ReadonlyMap<string, { start: number; end: number }[]>;
};

/** The transcript's voices, chapters, and anchors; null for a document
    that is no video's or audio's. */
export async function transcriptContext(documentId: string): Promise<TranscriptContext | null> {
  const asset = await db.videoAsset.findUnique({ where: { documentId }, select: { speakers: true } });
  if (!asset) return null;
  const [lines, document, sources, links] = await Promise.all([
    db.block.findMany({ where: { documentId, type: "TRANSCRIPT" }, orderBy: { order: "asc" }, select: { id: true, speaker: true } }),
    db.document.findUnique({ where: { id: documentId }, select: { contents: true } }),
    db.source.findMany({ where: { documentId, startTime: null, layer: null, orphaned: false }, select: { blockId: true, startOffset: true, endOffset: true } }),
    db.docLink.findMany({
      where: { OR: [{ fromDocumentId: documentId }, { toDocumentId: documentId }] },
      select: { fromDocumentId: true, fromBlockId: true, startOffset: true, endOffset: true, fromOrphaned: true, toDocumentId: true, toBlockId: true, toStartOffset: true, toEndOffset: true, toOrphaned: true },
    }),
  ]);
  const anchors = new Map<string, { start: number; end: number }[]>();
  const add = (blockId: string, start: number, end: number) => anchors.set(blockId, [...(anchors.get(blockId) ?? []), { start, end }]);
  for (const s of sources) add(s.blockId, s.startOffset, s.endOffset);
  for (const l of links) {
    if (l.fromDocumentId === documentId && !l.fromOrphaned) add(l.fromBlockId, l.startOffset, l.endOffset);
    if (l.toDocumentId === documentId && l.toBlockId && !l.toOrphaned && l.toStartOffset !== null && l.toEndOffset !== null) add(l.toBlockId, l.toStartOffset, l.toEndOffset);
  }
  const speakers = parseSpeakers(asset.speakers);
  // Who speaks: a voice from the line where it starts speaking until the next.
  const turns: string[] = [];
  let voice: string | null | undefined;
  for (const line of lines) {
    if (line.speaker === voice) continue;
    voice = line.speaker;
    if (voice) turns.push(`${voice} from [block ${line.id}]`);
  }
  return {
    speakers,
    lines:
      speakers.length === 0
        ? []
        : [
            `Speakers (id — name):\n${speakers.map((s) => `${s.id} — ${s.name}`).join("\n")}`,
            `Who speaks, each voice from the line named until the next: ${turns.slice(0, TURNS_MAX).join(", ")}${turns.length > TURNS_MAX ? ", …" : ""}`,
          ],
    chapterStarts: new Set(contentsEntries(document?.contents ?? null).map((e) => e.blockId)),
    anchors,
  };
}
