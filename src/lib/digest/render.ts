import type {
  DigestDocument,
  DigestNote,
  DigestParts,
  DigestSource,
} from "@/lib/digest/types";

// Budgets in characters. Past a budget the rest is cut with a declared marker,
// never silently (SPEC.md §7). text pays for document text; layers pays for
// notes, annotations, and the layers on each document.
export const CORPUS_TEXT_BUDGET = 480_000;
export const CORPORA_TEXT_BUDGET = 480_000;
export const LAYERS_BUDGET = 200_000;

export type RenderBudget = { text: number; layers: number };

export function unlimitedBudget(): RenderBudget {
  return { text: Infinity, layers: Infinity };
}
export function corpusBudget(): RenderBudget {
  return { text: CORPUS_TEXT_BUDGET, layers: LAYERS_BUDGET };
}
export function corporaBudget(): RenderBudget {
  return { text: CORPORA_TEXT_BUDGET, layers: LAYERS_BUDGET };
}

function timeRange(start: number | null, end: number | null): string | null {
  if (start == null) return null;
  return end != null ? `${start.toFixed(1)}s–${end.toFixed(1)}s` : `${start.toFixed(1)}s`;
}

// One reference to a source: quote, time range for video anchors, document.
function sourceRef(s: DigestSource): string {
  const time = timeRange(s.startTime, s.endTime);
  const place = s.quote ? `"${s.quote}"${time ? ` at ${time}` : ""}` : (time ?? '""');
  return `${place} (${s.documentTitle} [document ${s.documentId}])${s.orphaned ? " (orphaned)" : ""}`;
}

// A corpus-level note: id, section, kind, status, content, sources.
function noteBlock(n: DigestNote): string {
  const marks = [
    `section: ${n.section}`,
    ...(n.kind !== "note" ? [n.kind] : []),
    ...(n.status === "PENDING" ? ["pending"] : []),
  ];
  const sources =
    n.sources.length > 0 ? n.sources.map(sourceRef).join("; ") : "none";
  return `[note ${n.id}] (${marks.join("; ")})\n${n.content}\nsources: ${sources}`;
}

// An annotation under its document: kind, anchor, status, content.
function annotationBlock(n: DigestNote): string {
  const anchor = n.sources[0];
  const time = anchor ? timeRange(anchor.startTime, anchor.endTime) : null;
  const at = anchor ? (time ? ` at ${time}` : ` on "${anchor.quote}"`) : "";
  const head = [
    `[note ${n.id}] ${n.kind}${n.color ? ` (${n.color})` : ""}${at}`,
    ...(anchor?.orphaned ? ["(orphaned)"] : []),
    ...(n.status === "PENDING" ? ["(pending)"] : []),
  ].join(" ");
  const more = n.sources.length > 1 ? `\nsources: ${n.sources.map(sourceRef).join("; ")}` : "";
  return `${head}${n.content ? `\n${n.content}` : ""}${more}`;
}

// Keep whole items until the budget runs out; declare what was cut.
function spend(items: string[], budget: RenderBudget, what: string): string[] {
  const kept: string[] = [];
  let cutCount = 0;
  for (const item of items) {
    const cost = item.length + 1;
    if (budget.layers - cost <= 0) {
      cutCount++;
      continue;
    }
    budget.layers -= cost;
    kept.push(item);
  }
  if (cutCount > 0) kept.push(`[${cutCount} more ${what} were cut for length]`);
  return kept;
}

function documentMeta(doc: DigestDocument): string {
  if (doc.video) {
    const parts = [doc.video.kind === "YOUTUBE" ? `YouTube ${doc.video.youtubeId ?? ""}`.trim() : "upload"];
    if (doc.video.duration != null) parts.push(`${Math.round(doc.video.duration)}s`);
    parts.push(`transcript ${doc.video.transcriptStatus.toLowerCase()}`);
    return ` (video: ${parts.join(", ")})`;
  }
  return doc.sourceUrl ? ` (${doc.sourceUrl})` : "";
}

// Document text under the text budget, cut at block boundaries, declared.
function documentText(doc: DigestDocument, budget: RenderBudget): string {
  if (!doc.text) return "(no text)";
  if (doc.text.length <= budget.text) {
    budget.text -= doc.text.length;
    return doc.text;
  }
  const segments = doc.text.split(/\n\n(?=\[block )/);
  const kept: string[] = [];
  let cutCount = 0;
  for (const segment of segments) {
    if (budget.text - segment.length <= 0) {
      cutCount++;
      continue;
    }
    budget.text -= segment.length;
    kept.push(segment);
  }
  kept.push(`[${cutCount} more blocks of this document were cut for length]`);
  return kept.join("\n\n");
}

// Every layer on one document: glossary, annotations, distillations,
// extractions, summaries, salience, links, edits.
function layerItems(doc: DigestDocument): string[] {
  const items: string[] = [];
  if (doc.glossary.length > 0) {
    items.push(`Glossary: ${doc.glossary.map((t) => `${t.term} — ${t.definition}`).join("; ")}`);
  }
  if (doc.annotations.length > 0) {
    items.push("Annotations on this document:", ...doc.annotations.map(annotationBlock));
  }
  if (doc.distillations.length > 0) {
    items.push("Distillations of this document (question → the quotes that answer it):");
    for (const di of doc.distillations) {
      items.push(
        [
          `[distillation ${di.id}] Q: ${di.question}`,
          ...di.quotes.map(
            (q) =>
              `- "${q.quote}" [block ${q.blockId}]${q.orphaned ? " (orphaned)" : ""}${q.caption ? ` — ${q.caption}` : ""}`,
          ),
        ].join("\n"),
      );
    }
  }
  if (doc.extractions.length > 0) {
    items.push("Extractions of this document (origin phrase → the passages that reveal its topic):");
    for (const ex of doc.extractions) {
      items.push(
        [
          `[extraction ${ex.label}] origin "${ex.origin.quote}" [block ${ex.origin.blockId}]${ex.origin.orphaned ? " (orphaned)" : ""}`,
          ...ex.passages.map(
            (p) => `- "${p.quote}" [block ${p.blockId}]${p.orphaned ? " (orphaned)" : ""}`,
          ),
        ].join("\n"),
      );
    }
  }
  if (doc.summaries.length > 0) {
    items.push(
      "Summaries of this document:",
      ...doc.summaries.map((s) => `(${s.depth}) ${s.text}`),
    );
  }
  if (doc.formalized) {
    // The transcript already rides in full above; the article's title and
    // opening say it exists without paying for the whole rewrite.
    const opening =
      doc.formalized.markdown.length > 600
        ? `${doc.formalized.markdown.slice(0, 599)}…`
        : doc.formalized.markdown;
    items.push(`Formalized article of this transcript: "${doc.formalized.title}" — ${opening}`);
  }
  if (doc.salience.length > 0) {
    items.push(
      `Salient passages: ${doc.salience.map((q) => `"${q.quote}"${q.orphaned ? " (orphaned)" : ""}`).join("; ")}`,
    );
  }
  if (doc.links.length > 0) {
    items.push(
      "Links from this document:",
      ...doc.links.map(
        (l) =>
          `- "${l.quote}" → ${l.toQuote ? `"${l.toQuote}"` : "the document"} (${l.toTitle} [document ${l.toDocumentId}])`,
      ),
    );
  }
  if (doc.edits.length > 0) {
    items.push(
      "The reader's edits to this document (newest first):",
      ...doc.edits.map((e) => {
        const change =
          e.before || e.after
            ? `: ${e.before ? `"${e.before}"` : "(none)"} → ${e.after ? `"${e.after}"` : "(none)"}`
            : "";
        return `- ${e.kind}${e.blockId ? ` [block ${e.blockId}]` : ""}${change}`;
      }),
    );
  }
  return items;
}

// seenDocuments: documentId → corpus title that already shows its text, so the
// Corpora scope never repeats a shared document's text.
function renderDocument(
  doc: DigestDocument,
  budget: RenderBudget,
  seenDocuments: Map<string, string>,
  corpusTitle: string,
): string {
  const chunks: string[] = [`## Document: ${doc.title} [document ${doc.id}]${documentMeta(doc)}`];
  const shownUnder = seenDocuments.get(doc.id);
  if (shownUnder) {
    chunks.push(`Text shown under project "${shownUnder}" above.`);
  } else {
    chunks.push(documentText(doc, budget));
    seenDocuments.set(doc.id, corpusTitle);
  }
  const layers = spend(layerItems(doc), budget, "lines of this document's notes and layers");
  if (layers.length > 0) chunks.push(layers.join("\n"));
  return chunks.join("\n\n");
}

// One corpus, rendered whole: header, sections, documents with their layers,
// notes, loose annotations. Deterministic: same parts, same text — the prompt
// prefix stays cacheable until the corpus changes.
export function renderCorpusDigest(
  parts: DigestParts,
  budget: RenderBudget = unlimitedBudget(),
  seenDocuments: Map<string, string> = new Map(),
): string {
  const chunks: string[] = [
    [
      `# Project: ${parts.corpusTitle} [project ${parts.corpusId}]`,
      `Sections: ${parts.sections.join("; ") || "(none)"}`,
    ].join("\n"),
  ];
  if (parts.documents.length === 0) {
    chunks.push("(no documents attached)");
  }
  for (const doc of parts.documents) {
    chunks.push(renderDocument(doc, budget, seenDocuments, parts.corpusTitle));
  }
  const notes = spend(parts.notes.map(noteBlock), budget, "notes");
  chunks.push(
    ["## Notes in this project", notes.length > 0 ? notes.join("\n\n") : "(no notes)"].join("\n\n"),
  );
  if (parts.looseAnnotations.length > 0) {
    const loose = spend(parts.looseAnnotations.map(annotationBlock), budget, "annotations");
    chunks.push(["## Annotations not anchored in an attached document", ...loose].join("\n\n"));
  }
  return chunks.join("\n\n");
}

// Every corpus, in the given order (most recently updated first), documents
// deduped across corpora.
export function renderCorporaDigest(
  all: DigestParts[],
  budget: RenderBudget = unlimitedBudget(),
): string {
  const seenDocuments = new Map<string, string>();
  const list = all.map((p) => `"${p.corpusTitle}" [project ${p.corpusId}]`).join("; ");
  return [
    [`# All projects (${all.length})`, `The projects, most recently updated first: ${list || "(none)"}`].join("\n"),
    ...all.map((parts) => renderCorpusDigest(parts, budget, seenDocuments)),
  ].join("\n\n---\n\n");
}

const SHARED_INSTRUCTIONS = [
  "Every document block starts with its id in the form [block <id>]; every note with [note <id>].",
  "When you answer from a document, cite the block tag exactly as written ([block <id>]) and quote the exact words — precise recall over paraphrase.",
  "The material is complete except where a cut is declared in [brackets]. Questions about counts, spread, or absence are answerable from it. Say plainly when the material does not answer the question.",
];

// The assistant's system prefix at Corpus scope: instructions + the digest.
export function corpusSystem(parts: DigestParts, budget: RenderBudget = corpusBudget()): string {
  return [
    "You assist a reader working through their project: every document in full, and every note, annotation, distillation, extraction, and summary they made on it. All of it follows.",
    ...SHARED_INSTRUCTIONS,
    "",
    renderCorpusDigest(parts, budget),
  ].join("\n");
}

// The assistant's system prefix at Corpora scope: instructions + every digest.
export function corporaSystem(all: DigestParts[], budget: RenderBudget = corporaBudget()): string {
  return [
    "You assist a reader across all their projects: every project follows in full — its documents, notes, annotations, distillations, extractions, and summaries.",
    "A document attached to several projects shows its text once; later projects point back to it. Its notes and layers stay with their own project.",
    ...SHARED_INSTRUCTIONS,
    "",
    renderCorporaDigest(all, budget),
  ].join("\n");
}
