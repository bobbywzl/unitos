# Dissect — Unified Notes App for Deep Reading

A notes-centric web app for completely dissecting complex documents (research papers, financial reports, due diligence, consulting reports) with an AI assistant. Notes are the substrate; documents are inputs that attach to notebooks. Every AI feature is one operation: **Anchor → Derivation → Destination**.

---

## 1. Product Principles

1. **Notes outlive documents.** A note can cite many documents; a document can feed many notebooks. The unit of long-term value is the note, not the annotation.
2. **One primitive, many features.** Explain, laymanize, salience highlighting, and extraction-to-notes are all the same pipeline (anchor → LLM derivation → destination) with different prompt templates and destinations. Never build them as separate subsystems.
3. **User approves everything.** All AI output that writes into notes lands as `pending` and requires one-keystroke accept/reject. Nothing enters notes silently.
4. **Provenance is non-negotiable.** Every note line must click back to its source anchor in the original document.
5. **The retrieval test.** A feature only writes to notes if its output is something the user will read again. Transient comprehension aids (laymanization) render in the reader, not in notes.
6. **Context conditions everything.** The reader's background, purpose, and intended application (the Context tab; stored as `ReaderProfile`) are injected into every prompt, not scoped to one feature. Context is optional and never blocks reading or upload.

---

## 2. Tech Stack

- **Framework:** Next.js 14+ (App Router, TypeScript, server components where possible)
- **DB:** PostgreSQL + Prisma
- **AI:** Anthropic API via Vercel AI SDK (`ai` package), streaming responses. Model: `claude-sonnet-4-6` default; make model a per-derivation-type config constant.
- **Prompt caching:** Cache the full parsed document as a prompt prefix per session (Anthropic prompt caching, `cache_control` on the document content block). Every selection-level derivation must reuse the cached prefix.
- **Parsing:** PDF → blocks server-side. Use `unpdf` or `pdf-parse` for text extraction; preserve reading order. URL ingestion: full-DOM structural parse via `jsdom` — equations keep their TeX (KaTeX/MathJax annotations, rendered with KaTeX in the reader), charts keep their inline SVG, figures keep their images and videos, lists/tables/separators keep their shape — followed by an AI structure pass that may only drop, retype, or merge existing blocks by index (the model never writes text). `@mozilla/readability` is the fallback for pages the structural walk cannot read. Ingest streams stage progress (fetch → extract → structure → save) to the client. Every document is stamped with the parser version that produced it; a URL document stamped with an older version re-parses automatically — on open, and when its URL is added again — and can be re-parsed manually from the document menu.
- **Anchoring:** W3C Web Annotation selectors via `apache-annotator` (`@apache-annotator/dom`, `@apache-annotator/selector`).
- **Embeddings (Phase 6):** Voyage AI or OpenAI embeddings on notes, stored via `pgvector`.
- **Styling:** Tailwind. Split-pane layout via CSS grid, not a heavy library.
- **Auth:** Single-user for v1. Stub a `userId` constant; structure schema so multi-user is a migration, not a rewrite.

---

## 3. Data Model (Prisma)

```prisma
model Notebook {
  id        String    @id @default(cuid())
  title     String
  profile   Json?     // ReaderProfile override for this notebook
  sections  Section[]
  documents NotebookDocument[]
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}

model Section {
  id         String   @id @default(cuid())
  notebookId String
  notebook   Notebook @relation(fields: [notebookId], references: [id], onDelete: Cascade)
  title      String
  order      Int
  parentId   String?  // nesting, one level deep is enough for v1
  parent     Section? @relation("SectionNesting", fields: [parentId], references: [id])
  children   Section[] @relation("SectionNesting")
  notes      Note[]
}

model Note {
  id             String     @id @default(cuid())
  sectionId      String
  section        Section    @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  content        String     // markdown
  status         NoteStatus @default(ACCEPTED) // manual notes are ACCEPTED on create
  derivationType DerivationType? // null = manually written
  order          Int
  sources        Source[]
  embedding      Unsupported("vector(1024)")? // pgvector, Phase 6
  createdAt      DateTime   @default(now())
  updatedAt      DateTime   @updatedAt
}

enum NoteStatus {
  PENDING   // AI-proposed, awaiting user decision
  ACCEPTED
  REJECTED  // keep for 7 days for undo, then hard-delete via cron
}

enum DerivationType {
  EXPLAIN
  SIMPLIFY
  SALIENCE
  EXTRACT
  SUMMARIZE  // document-level summary, one per depth
  SYNTHESIS  // notebook-scope assistant output
}

model Source {
  id         String   @id @default(cuid())
  noteId     String
  note       Note     @relation(fields: [noteId], references: [id], onDelete: Cascade)
  documentId String
  document   Document @relation(fields: [documentId], references: [id])
  // Anchor: dual strategy (see §5)
  blockId     String
  startOffset Int
  endOffset   Int
  quotedText  String
  prefix      String  // 32 chars before selection
  suffix      String  // 32 chars after selection
  orphaned    Boolean @default(false)
}

model Document {
  id        String   @id @default(cuid())
  title     String
  sourceUrl String?
  fileHash  String?  @unique // dedupe re-uploads
  blocks    Block[]
  notebooks NotebookDocument[]
  sources   Source[]
  glossary  Json?    // Phase 7: [{term, definition, blockIds[]}]
  createdAt DateTime @default(now())
}

model NotebookDocument {
  notebookId String
  documentId String
  notebook   Notebook @relation(fields: [notebookId], references: [id], onDelete: Cascade)
  document   Document @relation(fields: [documentId], references: [id])
  salience   Json?    // SALIENCE layer: [{blockId, start, end}], per notebook per document
  summaries  Json?    // SUMMARIZE output: {layman?, intermediate?, professional?}
  @@id([notebookId, documentId])
}

model Block {
  id         String    @id @default(cuid())
  documentId String
  document   Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  order      Int
  type       BlockType
  text       String    // plain text content
  html       String?   // rendered content for figures/tables
}

enum BlockType {
  PARAGRAPH
  HEADING
  FIGURE
  TABLE
  EQUATION
  LIST
  CODE
}

model ReaderProfile {
  id          String  @id @default(cuid())
  userId      String  @unique // constant in v1
  background  String  // "Stanford student, stochastic calc + stats + quantum"
  purpose     String  // "due diligence" | "exam prep" | "replicate results" | free text
  application String  // "investment decision for Bough Capital" etc.
}
```

Key invariant: **Note ↔ Source is one-to-many, Note ↔ Document is many-to-many through Source.** One note can cite anchors in three different documents. This is the core structural advantage over document-centric readers.

---

## 4. The Derivation Pipeline (the one primitive)

Single server route: `POST /api/derive`

```typescript
type DeriveRequest = {
  type: 'EXPLAIN' | 'SIMPLIFY' | 'SALIENCE' | 'EXTRACT' | 'SUMMARIZE';
  documentId: string;
  notebookId: string;
  anchor?: AnchorInput;        // required for EXPLAIN/SIMPLIFY/EXTRACT
  targetSectionId?: string;    // EXTRACT only; null = let AI propose section
  depth?: 'layman' | 'intermediate' | 'professional'; // SUMMARIZE only; default layman
};
```

Flow:
1. Load document blocks (cached prompt prefix) + ReaderProfile + notebook section skeleton.
2. Select prompt template by `type` (templates in `/lib/prompts/`, one file per type).
3. Stream response.
4. Route output by destination:
   - `EXPLAIN` → annotation bubble in the reader rail (persisted as a Note in a hidden "Annotations" section, so it's searchable, but rendered in the rail)
   - `SIMPLIFY` → bubble beside the article, level with the selection (ephemeral, not persisted; close to dismiss)
   - `SALIENCE` → highlight layer (persisted as document-level Json, per notebook)
   - `EXTRACT` → `Note` with `status: PENDING` in the target section
   - `SUMMARIZE` → Summary tab in the side panel (persisted on `NotebookDocument.summaries`, one summary per depth; Regenerate overwrites)

Prompt templates always receive: reader context, document title, section skeleton (for EXTRACT), and the anchored text with surrounding context (±2 blocks).

**EXTRACT output contract:** model returns JSON `{sectionId, content, quotedSpans: [{blockId, start, end}]}`. Validate strictly; on parse failure, retry once with the error appended, then surface failure to user. Never write malformed output to DB.

---

## 5. Anchoring (make-or-break)

Anchors must survive re-parses and reflows. Dual strategy:

1. **Primary:** `blockId + startOffset + endOffset` against block plain text.
2. **Fallback:** `TextQuoteSelector` — `quotedText` + 32-char `prefix`/`suffix`. On load, if block resolution fails (block deleted or text changed), fuzzy-match the quote across the document via `@apache-annotator`.
3. **Never silently drop.** Unresolvable → set `orphaned: true`, render the note with a broken-link indicator and the quoted text preserved.

DOM ranges are never the source of truth. Convert selection → block-relative offsets at capture time using data attributes (`data-block-id`) on rendered blocks.

---

## 6. Layout & UX

**Split view, both panes persistent:**
- **Left:** document reader. Blocks rendered from DB, selection popover on highlight with four buttons: Explain / Simplify / Extract to notes / Add manually.
- **Right:** docked notes drawer showing the section skeleton of the current notebook. Pending notes render with amber left-border + Accept (`Enter`) / Reject (`Backspace`) / Edit (`e`). Accepting must be exactly one keystroke when a pending note is focused.
- Notes full-page view exists only for reorganizing/editing/export.

**Other UX rules:**
- Clicking a source chip on any note scrolls the reader to that anchor and flashes the highlight. If the document isn't open, open it.
- SIMPLIFY opens a translucent bubble to the right of the article, level with the selection, sliding in with a smooth animation. The selection stays tinted while the bubble is open. The document text never changes.
- Summary lives in the side panel: one rail button, a depth control with three levels (layman / intermediate / professional), one stored summary per depth.
- Salience layer is a toggleable highlight overlay, off by default, one click to show.
- Context tab in the workspace header: background / purpose / application, every field optional, editable any time. Saves globally or as a per-notebook override. No onboarding dialog — nothing blocks reading or upload.
- Keyboard-first: `j/k` navigate pending queue, `Enter` accept, `Backspace` reject, `e` edit, `g` jump to source.

---

## 7. Assistant Scope Selector (Phase 6)

One assistant panel with a scope control:

| Scope | Context sent | Example queries |
|---|---|---|
| Selection | anchor + ±2 blocks | explain, simplify |
| Document | full doc (cached) | "map claims to evidence", "what's missing" |
| Notebook | all accepted notes + section skeleton | "where do my notes contradict", "which sections are thin", "what's unsourced" |
| Corpus | embedding search over all notes | "have I read about X before" |

Notebook-scope contradiction/gap detection is the differentiating feature. Implementation: pass all accepted notes (with IDs) in one prompt; output JSON list of `{noteIds[], issue, explanation}`; render as clickable cards.

---

## 8. Build Phases (vertical slices, in order)

Each phase must be fully working end-to-end before starting the next.

### Phase 1 — Notebook outliner (no AI, no documents)
- CRUD: notebooks, sections (drag-reorder, one nesting level), manual notes.
- Notes full-page view. Markdown rendering.
- **Done when:** can create a notebook, build a section skeleton, write/reorder notes, reload with everything intact.

### Phase 2 — Documents: ingest, render, attach
- Upload PDF / paste URL → parse to blocks → persist → render in reader pane.
- PDFs up to 50 MB. Vercel caps a request body at about 4.5 MB, so the client splits bigger files into chunks (`/api/uploads`) and `/api/uploads/complete` assembles them into the same ingest path.
- Attach documents to notebooks. Split view shell (reader left, notes drawer right).
- **Done when:** a 30-page PDF renders with correct block order, headings, and tables legible; same document attaches to two notebooks without re-parsing (dedupe by fileHash).

### Phase 3 — Anchoring + manual extract
- Text selection → anchor capture → "Add to section" → Note (ACCEPTED, manual) with Source.
- Source chips on notes; chip click → scroll + flash.
- Anchor resolution on load, including fallback matcher and orphan handling.
- **Done when:** highlight survives page reload AND a forced re-parse of the document; orphaned anchors render gracefully.

### Phase 4 — First derivation: EXPLAIN
- `/api/derive` route, prompt caching wired, streaming into annotation rail.
- Persist as Note in hidden Annotations section.
- **Done when:** second EXPLAIN call on the same document measurably reuses the cached prefix (log cache hit tokens); response streams in <2s to first token.

### Phase 5 — Context + remaining derivations
- Context (background / purpose / application) + injection into all prompts.
- SIMPLIFY (inline swap/revert), SALIENCE (overlay), EXTRACT (pending queue with keyboard flow).
- **Checkpoint:** compare EXPLAIN output with/without profile on the same passage. If not meaningfully better than generic output, stop and rethink prompts before building more.

### Phase 6 — Notebook-scope assistant
- pgvector embeddings on accepted notes.
- Assistant panel with scope selector. Contradiction detection, gap detection, corpus search.

### Phase 7 — Glossary + export
- On-ingest glossary extraction (terms/acronyms/symbols); hover definitions in reader.
- Export notebook → Markdown and .docx with footnotes resolving to `documentTitle, blockId` citations.

---

## 9. Non-Goals (v1)

- Multi-user / sharing / realtime collaboration
- Mobile layout (desktop-only; min-width 1024px)
- Scanned-PDF OCR
- Browser extension
- Spaced-repetition / quiz features
- Claim→evidence and omission-audit document tools (Phase 8+, after core loop is proven)

---

## 10. Quality Bars

- Accept/reject a pending note: 1 keystroke, <100ms UI response.
- First streamed token on selection derivations: <2s.
- Anchor resolution success on unchanged documents: 100%; on re-parsed documents: >95%, remainder orphaned visibly.
- No AI output ever enters accepted notes without explicit user action.
- Every accepted note with a derivationType has ≥1 Source.
