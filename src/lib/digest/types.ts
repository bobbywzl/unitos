// The digest: the stored context the assistant reads (SPEC.md §7). One
// NotebookDigest row per corpus per user; parts is this structure. build.ts
// fills it, render.ts turns it into the assistant's prompt text, the admin
// digest page shows it.

/** Where a note points: enough to say the place without re-resolving anchors. */
export type DigestSource = {
  documentId: string;
  documentTitle: string;
  quote: string;
  orphaned: boolean;
  // Video anchors (SPEC.md §11): a time range instead of a text span.
  startTime: number | null;
  endTime: number | null;
};

/** One note. Annotations are notes in the hidden Annotations section; kind
    names their form: explanation, simplified rewrite, analysis, highlight,
    comment, assistant conversation, distillation quote, video find, note. */
export type DigestNote = {
  id: string;
  section: string;
  hidden: boolean; // true = annotation
  status: "PENDING" | "ACCEPTED";
  kind: string;
  color: string | null; // highlight hue
  content: string;
  sources: DigestSource[];
};

/** One anchored quote of a distillation, extraction, or salience layer. */
export type DigestQuote = {
  blockId: string;
  quote: string;
  caption: string | null;
  orphaned: boolean;
};

export type DigestDistillation = {
  id: string;
  question: string;
  createdAt: string; // ISO
  quotes: DigestQuote[];
};

export type DigestExtraction = {
  label: string; // "E1"…
  origin: DigestQuote;
  passages: DigestQuote[];
};

export type DigestSummary = { depth: string; text: string };

export type DigestLink = {
  quote: string; // this document's end
  toDocumentId: string;
  toTitle: string;
  toQuote: string | null; // null = document-level link
};

export type DigestEdit = {
  kind: string; // "TEXT_EDIT" | "LINK_ADD" | … (EditItem kinds)
  blockId: string | null;
  before: string | null;
  after: string | null;
  at: string; // ISO
};

export type DigestVideo = {
  kind: "UPLOAD" | "YOUTUBE";
  youtubeId: string | null;
  duration: number | null; // seconds
  transcriptStatus: string;
};

/** One document with its full block-tagged text and every layer on it. */
export type DigestDocument = {
  id: string;
  title: string;
  sourceUrl: string | null;
  video: DigestVideo | null;
  chars: number; // of text
  text: string; // full [block <id>]-tagged text, references appended
  glossary: { term: string; definition: string }[];
  annotations: DigestNote[]; // hidden-section notes anchored in this document
  distillations: DigestDistillation[];
  extractions: DigestExtraction[];
  summaries: DigestSummary[];
  salience: DigestQuote[];
  // The formalized article (FORMALIZE, SPEC.md §11). Optional: digests built
  // before it existed read as none.
  formalized?: { title: string; markdown: string } | null;
  links: DigestLink[];
  edits: DigestEdit[]; // newest first, capped
};

export type DigestParts = {
  corpusId: string;
  corpusTitle: string;
  sections: string[]; // "Parent / Title", outline order
  notes: DigestNote[]; // visible-section notes, outline order
  looseAnnotations: DigestNote[]; // annotations with no resolvable document
  documents: DigestDocument[];
};

export type DigestCounts = {
  documents: number;
  blocks: number;
  notes: number;
  annotations: number;
  distillations: number;
  extractions: number;
  summaries: number;
  salience: number;
  links: number;
  edits: number;
};

/** Tolerant read of the Json column; anything malformed reads as empty. */
export function digestParts(value: unknown): DigestParts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const parts = value as DigestParts;
  if (typeof parts.corpusId !== "string" || !Array.isArray(parts.documents)) return null;
  return parts;
}

/** Tolerant read of the counts column. */
export function digestCounts(value: unknown): DigestCounts {
  const empty: DigestCounts = {
    documents: 0,
    blocks: 0,
    notes: 0,
    annotations: 0,
    distillations: 0,
    extractions: 0,
    summaries: 0,
    salience: 0,
    links: 0,
    edits: 0,
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  return { ...empty, ...(value as Partial<DigestCounts>) };
}
