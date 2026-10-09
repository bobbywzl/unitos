// The assistant loop's document context (SPEC.md §7, §25): a fixture as the
// digest stores it, so documentSystem renders the same This page system
// prefix the route sends, byte for byte in shape; the plan's view of the
// blocks; and a recording's transcript context (voices and who speaks from
// which line), as lib/assistant/transcript.ts builds it from the database.
import { renderBlockLines } from "@/lib/derive/context";
import type { PlanContext } from "@/lib/assistant/plan";
import type { TranscriptContext } from "@/lib/assistant/transcript";
import { documentSystem } from "@/lib/digest/render";
import type { DigestNote, DigestParts } from "@/lib/digest/types";
import type { Fixture, FixtureBlock } from "../lib";

export const PROJECT_ID = "eval-project";
export const PROJECT_TITLE = "Reading project";
export const NOTES_SECTION = { id: "sec-notes", title: "Notes", parentTitle: null as string | null };
export const QUESTIONS_SECTION = { id: "sec-questions", title: "Open questions", parentTitle: null as string | null };

/** A note of the reader a case puts in the project: its section, its
    words, and the words of the document it quotes, when it quotes any. */
export type CaseNote = { section: string; content: string; quote?: { block: number; text: string } };

/** A recording's VIDEO block (SPEC.md §11): every video or audio document
    has one at order 0, its text the title. */
export const videoBlockId = (f: Fixture): string => `${f.name}-video`;

export const isRecording = (f: Fixture): boolean => f.blocks.some((b) => b.type === "TRANSCRIPT");

/** The blocks as the plan reads them (PlanContext.blocks): a recording's
    VIDEO block first, a transcript line with its times and its voice's id. */
export function planBlocks(f: Fixture): PlanContext["blocks"] {
  const voices = speakerIds(f);
  const lines = f.blocks.map((b) => ({
    id: b.id,
    type: b.type,
    text: b.text,
    html: b.html ?? null,
    startTime: b.startTime ?? null,
    endTime: b.endTime ?? null,
    speaker: b.speaker ? (voices.get(b.speaker) ?? null) : null,
  }));
  return isRecording(f) ? [{ id: videoBlockId(f), type: "VIDEO", text: f.title, html: null, startTime: null, endTime: null, speaker: null }, ...lines] : lines;
}

/** The voices of a recording by name, each with the id the app gives it
    (`s1`, `s2`, … in order of first speaking). */
export function speakerIds(f: Fixture): Map<string, string> {
  const ids = new Map<string, string>();
  for (const b of f.blocks) if (b.speaker && !ids.has(b.speaker)) ids.set(b.speaker, `s${ids.size + 1}`);
  return ids;
}

/** The transcript context the prompt and the plan read (lib/assistant/transcript.ts). */
export function fixtureTranscript(f: Fixture): TranscriptContext | null {
  if (!isRecording(f)) return null;
  const ids = speakerIds(f);
  const speakers = [...ids].map(([name, id]) => ({ id, name }));
  const turns: string[] = [];
  let voice: string | null | undefined;
  for (const b of f.blocks) {
    if (b.type !== "TRANSCRIPT") continue;
    const id = b.speaker ? (ids.get(b.speaker) ?? null) : null;
    if (id === voice) continue;
    voice = id;
    if (id) turns.push(`${id} from [block ${b.id}]`);
  }
  return {
    speakers,
    lines:
      speakers.length === 0
        ? []
        : [
            `Speakers (id — name):\n${speakers.map((s) => `${s.id} — ${s.name}`).join("\n")}`,
            `Who speaks, each voice from the line named until the next: ${turns.join(", ")}`,
          ],
    chapterStarts: new Set(),
    anchors: new Map(),
  };
}

/** The document's text as the digest stores it: every block tagged. */
export function fixtureText(f: Fixture): string {
  const blocks: (FixtureBlock & { page?: null })[] = f.blocks;
  const lines = renderBlockLines(
    blocks.map((b) => ({ id: b.id, type: b.type, text: b.text, startTime: b.startTime ?? null, endTime: b.endTime ?? null })),
    null,
  );
  return isRecording(f) ? `[block ${videoBlockId(f)}] (VIDEO)\n${f.title}\n\n${lines}` : lines;
}

function digestNote(f: Fixture, n: CaseNote, i: number): DigestNote {
  const block = n.quote ? f.blocks[n.quote.block - 1] : null;
  if (n.quote && (!block || !block.text.includes(n.quote.text))) throw new Error(`note ${i + 1} quotes words not in block ${n.quote.block} of ${f.name}`);
  return {
    id: `note-${i + 1}`,
    section: n.section,
    hidden: false,
    status: "ACCEPTED",
    kind: "note",
    color: null,
    content: n.content,
    sources: block
      ? [{ documentId: f.name, documentTitle: f.title, quote: n.quote!.text, orphaned: false, startTime: block.startTime ?? null, endTime: block.endTime ?? null }]
      : [],
  };
}

/** The sections of the project as the prompt lists them: the fixed two, and
    the sections the case's notes name. */
export function fixtureSections(notes: CaseNote[]): { id: string; title: string; parentTitle: string | null }[] {
  const fixed = [NOTES_SECTION, QUESTIONS_SECTION];
  const extra = [...new Set(notes.map((n) => n.section))].filter((title) => !fixed.some((s) => s.title === title));
  return [...fixed, ...extra.map((title, i) => ({ id: `sec-${i + 3}`, title, parentTitle: null }))];
}

/** The project's digest with this one document and the case's notes. */
export function fixtureParts(f: Fixture, notes: CaseNote[] = []): DigestParts {
  const text = fixtureText(f);
  const last = f.blocks[f.blocks.length - 1];
  return {
    corpusId: PROJECT_ID,
    corpusTitle: PROJECT_TITLE,
    sections: fixtureSections(notes).map((s) => s.title),
    notes: notes.map((n, i) => digestNote(f, n, i)),
    looseAnnotations: [],
    documents: [
      {
        id: f.name,
        title: f.title,
        sourceUrl: null,
        video: isRecording(f) ? { kind: "UPLOAD", youtubeId: null, duration: last?.endTime ?? null, transcriptStatus: "READY" } : null,
        chars: text.length,
        text,
        glossary: [],
        annotations: [],
        distillations: [],
        extractions: [],
        summaries: [],
        salience: [],
        links: [],
        edits: [],
      },
    ],
  };
}

/** The This page system prefix for the fixture, as the route renders it. */
export function fixtureSystem(f: Fixture, notes: CaseNote[] = []): string {
  const system = documentSystem(fixtureParts(f, notes), f.name);
  if (system === null) throw new Error(`${f.name} did not render`);
  return system;
}
