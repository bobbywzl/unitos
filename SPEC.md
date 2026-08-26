# Dissect — Unified Notes App for Deep Reading

A notes-centric web app for completely dissecting complex documents (research papers, financial reports, due diligence, consulting reports) with an AI assistant. Notes are the substrate; documents are inputs that attach to notebooks. Every AI feature is one operation: **Anchor → Derivation → Destination**.

---

## 1. Product Principles

1. **Notes outlive documents.** A note can cite many documents; a document can feed many notebooks. The unit of long-term value is the note, not the annotation.
2. **One primitive, many features.** Explain, laymanize, salience highlighting, and extraction-to-notes are all the same pipeline (anchor → LLM derivation → destination) with different prompt templates and destinations. Never build them as separate subsystems.
3. **User approves everything.** All AI output that writes into notes lands as `pending` and requires one-keystroke accept/reject. Nothing enters notes silently.
4. **Provenance is non-negotiable.** Every note line must click back to its source anchor in the original document.
5. **The retrieval test.** A feature only writes to notes if its output is something the user will read again. Comprehension aids (laymanization, explanation) render in the reader and persist as annotations — not as notes in sections.
6. **Context conditions everything.** The reader's background, purpose, and intended application (the Context tab; stored as `ReaderProfile`) are injected into every prompt, not scoped to one feature. Context is optional and never blocks reading or upload.

---

## 2. Tech Stack

- **Framework:** Next.js 14+ (App Router, TypeScript, server components where possible)
- **DB:** PostgreSQL + Prisma
- **AI:** Anthropic API via Vercel AI SDK (`ai` package), streaming responses. Model: `claude-opus-5` default; make model a per-derivation-type config constant.
- **Prompt caching:** Cache the full parsed document as a prompt prefix per session (Anthropic prompt caching, `cache_control` on the document content block). Every selection-level derivation must reuse the cached prefix.
- **Parsing:** PDF → blocks server-side. Use `unpdf` or `pdf-parse` for text extraction; preserve reading order. URL ingestion: full-DOM structural parse via `jsdom` — equations keep their TeX (KaTeX/MathJax annotations, rendered with KaTeX in the reader), charts keep their inline SVG, figures keep their images and videos, lists/tables/separators keep their shape — followed by two AI passes that reference blocks by index and never write text: the core pass returns the block ranges that are the article (site navigation, footer link lists, newsletter, social, and legal chrome fall outside the ranges and are dropped), then the structure pass may drop, retype, or merge what survives. `@mozilla/readability` is the fallback for pages the structural walk cannot read. Ingest streams stage progress (fetch → extract → select → structure → save) to the client. Every document is stamped with the parser version that produced it; a URL document stamped with an older version re-parses automatically — on open, and when its URL is added again — and can be re-parsed manually from the document menu.
- **Anchoring:** W3C Web Annotation selectors via `apache-annotator` (`@apache-annotator/dom`, `@apache-annotator/selector`).
- **Digest (Phase 6):** the assistant's stored context — one `NotebookDigest` row per corpus per user, rebuilt on read when a content fingerprint moves (§7). No embeddings: the assistant reads the corpus whole.
- **Styling:** Tailwind. Split-pane layout via CSS grid, not a heavy library.
- **Auth:** dual mode (Scalae pattern). With `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `SESSION_SECRET` set, Google sign-in (hand-rolled OIDC code flow, database sessions in an httpOnly cookie, 30 days) gates the app at `/signin`; corpora, profiles, and digests belong to accounts, and the first account to sign in adopts the local reader's data. Unset, the app runs as the single local reader (`user-1`), nothing gated. `/admin` keeps its own `ADMIN_PASSWORD` gate, decoupled from reader sign-in. Corpus routes verify ownership; object routes stay id-capability-based (cuids) — per-object ACLs are the next migration. `/api/auth/test-login` is a QA door, sealed unless `TEST_LOGIN_TOKEN` is set.
- **Language:** English and Chinese, whole-surface. Typed dictionaries in `/lib/i18n/dict` (one namespace per surface; en and zh keys enforced identical by type), `dissect-lang` cookie with Accept-Language first-visit fallback, switcher in Settings and on `/signin`. Every UI surface and API error message translates; prompts, the digest, and stored data stay English (model context and data, not UI).

---

## 3. Data Model (Prisma)

```prisma
model User {
  id         String    @id @default(cuid())
  email      String    @unique
  name       String
  picture    String    @default("")
  createdAt  DateTime  @default(now())
  lastSeenAt DateTime  @default(now())
  sessions   Session[]
}

model Session {
  token     String   @id
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  expiresAt DateTime
}

model Notebook {
  id        String    @id @default(cuid())
  userId    String    @default("user-1") // owner account; "user-1" = the local reader
  title     String
  profile   Json?     // ReaderProfile override for this notebook
  sections  Section[]
  documents NotebookDocument[]
  digest    NotebookDigest?
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
}

model NotebookDigest {
  id          String   @id @default(cuid())
  notebookId  String   @unique
  notebook    Notebook @relation(fields: [notebookId], references: [id], onDelete: Cascade)
  userId      String   // per-user store; constant in v1
  fingerprint String   // cheap aggregates over the content tables; mismatch = stale
  parts       Json     // DigestParts: documents with text and layers, notes, sections
  counts      Json     // DigestCounts: documents, notes, annotations, distillations, …
  chars       Int      // rendered size before budget cuts
  builtAt     DateTime @default(now())
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
  EXTRACT    // origin phrase → the passages that reveal its topic, stored on the attachment
  SUMMARIZE  // document-level summary, one per depth
  SYNTHESIS  // notebook-scope assistant output
  DISTILL    // question → the quotes that answer it, stored on the attachment
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
  notebookId    String
  documentId    String
  notebook      Notebook @relation(fields: [notebookId], references: [id], onDelete: Cascade)
  document      Document @relation(fields: [documentId], references: [id])
  salience      Json?    // SALIENCE layer: [{blockId, start, end}], per notebook per document
  summaries     Json?    // SUMMARIZE output: {layman?, intermediate?, professional?}
  distillations Json?    // DISTILL output: [{id, question, createdAt, quotes}], newest first
  extractions   Json?    // EXTRACT output: [{id, createdAt, origin, spans}], oldest first — the index gives the label
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
  type: 'EXPLAIN' | 'SIMPLIFY' | 'SALIENCE' | 'EXTRACT' | 'DISTILL' | 'SUMMARIZE';
  documentId: string;
  notebookId: string;
  anchor?: AnchorInput;        // required for EXPLAIN/SIMPLIFY/EXTRACT; optional focus for DISTILL
  question?: string;           // DISTILL only: the question the quotes must answer
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
   - `EXTRACT` → extraction on `NotebookDocument.extractions`, painted as a labeled highlight layer: the origin phrase plus the passages across the document that reveal its topic; each passage's label chip jumps back to the origin
   - `DISTILL` → distillation on `NotebookDocument.distillations`, rendered as the distilled page; a quote reaches notes only through the page's "Add to notes", which lands a `Note` with `status: PENDING`
   - `SUMMARIZE` → Summary tab in the side panel (persisted on `NotebookDocument.summaries`, one summary per depth; Regenerate overwrites)

Prompt templates always receive: reader context, document title, section skeleton, and the anchored text with surrounding context (±2 blocks).

**DISTILL output contract:** model returns JSON `{quotes: [{blockId, start, end, caption}]}` — the verbatim spans across the whole document that answer the question, each captioned with how it answers the question in the document's context. Validate strictly; resolve every span against the real block text and drop what does not resolve; on parse failure, retry once with the error appended, then surface failure to user. Never write malformed output to DB. Stored quotes heal at render like salience and orphan visibly (§5). The HTTP response streams heartbeat bytes while the model works and ends with the distillation JSON (or the in-band error token), so the connection survives a minutes-long scan.

**EXTRACT output contract:** model returns JSON `{spans: [{blockId, start, end}]}` — the passages across the whole document most revealing about the highlighted phrase's topic. Validate strictly; resolve every span against the real block text; drop spans that overlap the origin or each other. Stored per notebook per document, oldest first — the index gives the label (E1, E2, …). Spans heal at render like salience; an unresolvable span stays stored but unpainted. (The v1 EXTRACT selection-to-note flow lives on as DISTILL's "Add to notes".)

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
- **Left:** document reader. Blocks rendered from DB, selection popover on highlight with four buttons: Explain / Simplify / Extract / Add manually.
- **Right:** docked notes drawer showing the section skeleton of the current notebook. Pending notes render with amber left-border + Accept (`Enter`) / Reject (`Backspace`) / Edit (`e`). Accepting must be exactly one keystroke when a pending note is focused.
- Notes full-page view exists only for reorganizing/editing/export.

**Other UX rules:**
- Clicking a source chip on any note scrolls the reader to that anchor and flashes the highlight. If the document isn't open, open it.
- SIMPLIFY opens a translucent bubble to the right of the article, level with the selection, sliding in with a smooth animation. The selection stays tinted while the bubble is open. The document text never changes. The output persists as a note in the hidden Annotations section (like EXPLAIN), so it is still there when the reader leaves and comes back — listed under Simplified in the Annotations tab. Sentence mirroring: the prompt numbers the original sentences and the model appends a source marker ([[1]] or [[2,3]], at least one number) after each rewritten sentence. Every sentence in the bubble is lightly tinted; pressing one turns it solid and tints exactly its source sentences in the article. Both sides split sentences with the same function (src/lib/sentences.ts), so marker indices map back to exact offsets — never model-quoted text.
- Edit mode has no Edit button: double-click a text block to edit it in place. A fading hint card beside the article teaches this until the first double-click. Done or Esc returns to reading. Selecting text in edit mode opens the same selection popover as reading mode; unsaved typing saves before any anchor is stored.
- The edit toolbar: paragraph / h1 / h2 / h3 / bulleted list / numbered list, bold / italic / underline, indent / outdent (two-space steps on the caret's line), remove paragraph. List markers live in the text ("- ", "N. ").
- AI text cites document blocks as [block <id>] (the tags from the cached document prefix). Everywhere markdown renders — bubbles, chat, annotations, notes — the tag becomes a ¶ chip that scrolls the reader to that block and flashes it.
- The Assistant from the selection popover is conversational: the first command opens a miniature chat card beside the article; later turns send with the conversation history and the same anchor. The card resizes freely from its corner (native resize handle). Plans still go through the approval card (or run in Auto), and the chat narrates the outcome.
- Comment annotations show a small comment icon right after their span (SVG only — the block's DOM text stays the stored text). Clicking it opens the comment in a card with the same docking, dragging, and connector line as the other tool blocks.
- Stored EXPLAIN and SIMPLIFY annotations reopen their bubble: clicking the annotation's mark in the text opens the bubble beside it with the saved content (sentence mirroring included for SIMPLIFY). Other annotation marks focus their card in the Annotations tab.
- Floating cards are freely moveable: drag the card header. Docking sets the initial position only.
- Tool blocks (Explanation, Simplified, Assistant chat) place by proximity to the highlighted text, never over the article: with nothing beside the text a new block goes right; with a block already close on the right it goes left; with both sides taken it drops below the existing blocks — right before left, top to bottom. Placement measures the blocks where they actually are, so dragged blocks count. Cards shrink to the margin (floor 260px) before ever overlapping the article.
- The selection popover follows the same rule: right of the text when that side is clear, else left, else directly below the highlighted text.
- Voice: a round bubble under the selection popover reads the highlighted text aloud. OpenAI TTS reads it (`POST /api/speech`, model gpt-4o-mini-tts, voice alloy — the model reads the input language directly, Chinese and English alike); without OPENAI_API_KEY the browser voice reads instead (zh-CN for Chinese text, en-US otherwise). The reading outlives the popover: dismissing the selection leaves a floating "Stop reading" control; that, the bubble, or switching documents stops it.
- A faint dashed connector line runs from the edge of each tool block's highlighted text to the block, so the correspondence stays visible with several blocks open.
- Figures and equations open their tools with a hold-and-circle gesture (pointer down + ≥300° of turning). The figure popover has Explain (the model deciphers the visual — image figures attach the image, SVG charts attach their source, videos explain from caption), highlight colors, Comment, and Link — no Simplify or Extract. A highlighted figure shows a side label on its right that jumps to the annotation, instead of text marks.
- Distill: the reader asks the article one question — from the Distill button at the top right of the reader, the Distill tab in the side tray, or the article menu. The distilled page opens over the article: the question large at the top, under it the quotes that answer it, in document order, each with a caption saying how it answers the question and how it sits in the document's context. Clicking a quote closes the page and jumps to its exact span. Add to notes lands the quote as a PENDING note (caption as content, quote as source). Cancel stops a running distillation — the request aborts, nothing persists, and the ask view keeps the question for editing; closing the page never cancels, and the Distill button carries a progress bar while a distillation runs. Distillations persist per notebook per document, newest first; the page and the Distill tab list them, and the page deletes them one by one.
- Extract: from the selection popover, the passages across the document that reveal the highlighted phrase's topic paint as a labeled layer — the origin phrase solid-underlined, its passages dash-underlined, every span carrying the extraction's label chip (E1, E2, …). A passage's chip jumps back to the origin; the origin's chip opens the extract card (origin quote, passage count, Delete).
- Key terms (the dotted glossary underlines) are pressable: hover for the definition, press for the selection toolbar on the term with Extract first, marked recommended.
- The article menu floats open at the top left of the page. It hides once the reader scrolls and returns when the reader is back at the top. It lists the frequent functions: Summarize article, Key takeaways, and Explain simply send the question to the assistant, which reads the whole document (document scope, cached prefix) and answers in the assistant chat card beside the article; Ask the assistant opens the same chat empty; Distill opens the distilled page.
- Summary lives in the side panel: one rail button, a depth control with three levels (layman / intermediate / professional), one stored summary per depth.
- The salience toggle gave its top-right spot to the Distill button; the SALIENCE derivation stays in the pipeline without a reader control.
- Context tab in the workspace header: background / purpose / application, every field optional, editable any time. Saves globally or as a per-notebook override. No onboarding dialog — nothing blocks reading or upload.
- Keyboard-first: `j/k` navigate pending queue, `Enter` accept, `Backspace` reject, `e` edit, `g` jump to source.

---

## 7. Assistant Scopes + the Digest (Phase 6)

One assistant panel with two scopes, both reading the digest:

| Scope | Context sent | Example queries |
|---|---|---|
| Corpus (wire value `notebook`) | this corpus's digest, whole | "map claims to evidence", "where do my notes contradict", "which sections are thin" |
| Corpora (wire value `corpus`) | every corpus's digest, whole | "have I read about X before", "where are mentions of X concentrated" |

**The digest** is the assistant's storage: one `NotebookDigest` row per corpus per user holding the serialized corpus — every document in full (text and video transcripts, block-tagged), every note (pending ones marked), every annotation (highlights, comments, explanations, simplified rewrites, assistant conversations), every distillation, extraction, summary, salience span, link, and edit. Never a similarity search: the assistant sees everything, so questions about counts, spread, and absence are answerable.

- **Staleness:** a fingerprint of cheap grouped aggregates over the content tables (note counts and `updatedAt`, block id sets, `BlockEdit` rows, layer Json hashes, titles) is compared on every read; a mismatch rebuilds the row. No mutation hooks to forget.
- **Determinism:** the rendered digest is byte-identical until content changes, so both scopes cache their prompt prefix (§2).
- **Budgets:** past the character budget, document text cuts at block boundaries with a declared marker, never silently. Notes and layers have their own budget. At Corpora scope a document attached to several corpora renders its text once; later corpora point back to it.
- **Selection and document questions** stay in the reader: the selection popover's assistant chat and the article menu (`/api/assistant/act`) already carry the anchor and the cached document prefix.
- **Usage telemetry:** every model call records tokens and estimated cost to `UsageEvent` (list prices at call time; fire-and-forget, never blocking a response). The admin usage page (`/admin/usage`) aggregates per function, model, account, and day.
- **Admin digest page** (`/admin/digest`, admin-gated like the feedback inbox): the store per user — every corpus → every document → its annotations, notes, and distillations — with counts, built time, forced Rebuild, and the exact text each scope sends (`/api/admin/digest`).

Corpus-scope contradiction/gap detection is the differentiating feature. Implementation: the digest carries all notes (with IDs) in one prompt; output JSON list of `{noteIds[], issue, explanation}`; render as clickable cards.

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

### Phase 6 — Assistant scopes + the digest
- The digest store (§7): `NotebookDigest` rows, fingerprint staleness, deterministic render.
- Assistant panel with the two scopes. Contradiction detection, gap detection.
- Admin digest page at `/admin/digest`.

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

---

## 11. Video

A video is a document. Its transcript is its blocks; a video anchor is a time range instead of a text span. Everything downstream — notes, source chips, pending/accept, the derivation pipeline — is unchanged. The video file is never modified; annotations are a layer on top of the player.

### Data model additions

```prisma
model VideoAsset {
  id               String           @id @default(cuid())
  documentId       String           @unique
  document         Document         @relation(fields: [documentId], references: [id], onDelete: Cascade)
  kind             VideoKind        @default(UPLOAD)
  youtubeId        String?          @unique // kind YOUTUBE only; dedupes re-adds
  mimeType         String?          // kind UPLOAD only
  size             Int?             // kind UPLOAD only
  chunkSize        Int?             // kind UPLOAD only
  duration         Float?           // seconds; written by the client after metadata loads
  width            Int?
  height           Int?
  transcriptStatus TranscriptStatus @default(NONE)
  transcriptError  String?          // FAILED only: the reason, shown in the transcript pane
  transcriptStartedAt DateTime?     // a PENDING older than 10 minutes is a dead run; may start again
  chunks           VideoChunk[]
}

model VideoChunk {
  id      String     @id @default(cuid())
  videoId String
  video   VideoAsset @relation(fields: [videoId], references: [id], onDelete: Cascade)
  index   Int
  data    Bytes
  @@unique([videoId, index])
}

enum VideoKind { UPLOAD YOUTUBE }
enum TranscriptStatus { NONE PENDING READY FAILED }
```

- `Document` ↔ `VideoAsset` is one-to-one. A document with a VideoAsset is a video document; the reader renders the video pane for it instead of the text reader.
- Upload video takes an mp4/webm/ogg/mov file or a YouTube link. A file becomes kind `UPLOAD`; a YouTube link becomes kind `YOUTUBE` (title from oEmbed, deduped by `youtubeId`, no bytes stored). A YouTube link pasted into Add URL lands in the same path.
- Every video document has exactly one `VIDEO` block at order 0. Video anchors point at it when no transcript block fits.
- Transcript lines are `TRANSCRIPT` blocks with `Block.startTime`/`Block.endTime` (seconds). Same text machinery as every other block.
- Upload bytes live in `VideoChunk` rows, streamed by `GET /api/video/[documentId]` with HTTP Range support so the scrubber seeks without downloading the file. 200 MB cap per video. Postgres holds the bytes for the same reason it holds PDF bytes: zero-config deploys. Blob storage is the upgrade path, not a v1 requirement.
- A YouTube video plays through the IFrame player behind the same overlay, controls, markers, and Visual strip. Its frame cannot be drawn from the iframe (cross-origin), so the real frame comes from the storyboard sheets YouTube publishes for its scrubber, proxied through this origin so the canvas stays readable. Those frames feed both the Visual cards and Explain.

### Time anchors (§5 extended)

`Source` gains three nullable columns: `startTime`, `endTime` (seconds), `region` (Json). A source with `startTime` set is a video anchor:

- It cites a span of the video. `blockId` points at the VIDEO block or a transcript block; `quotedText` holds the transcript excerpt for the range (or the formatted time range) so chips read well.
- `region` is an optional drawn shape in percent coordinates of the video frame, so it stays glued to the same spot at any player size. The draw tool makes a freehand closed loop — `{kind: "path", points: [[x, y], …]}`, each coordinate 0–100; `{kind: "ellipse", cx, cy, rx, ry}` stays valid for older annotations. Pixels are never stored.
- Resolution: time anchors skip the text-matching ladder and never orphan. The video file never changes.
- Clicking a source chip on a video anchor seeks the player to `startTime` and flashes the annotation — the video equivalent of scroll + flash.

### The video pane

- Player: plain `<video>` with custom controls. The scrubber carries a marker dot per annotation; clicking a marker seeks to it.
- Overlay: a transparent SVG layer sized to the frame. Annotate (the magnifier button) pauses the video; the drag draws a freehand loop that closes itself, or "Use the whole frame" skips the loop; a comment card saves the note (Annotations section, time source; range defaults to [t, t+4s], editable).
- Replay: while playing, every annotation whose range contains the current time fades in on the overlay and fades out past its end.
- One surface under the player: the tool bar — Circle & comment, the Find box, the transcript status — then Find results, Visual, and the transcript. Nothing video lives anywhere else.
- Visual: a strip of annotation cards — the frame at that moment with the loop drawn on it, the time range, the note. Clicking a card seeks there and opens what was written at that moment. The video stays untouched; this is the visual note layer.
- Transcript: its own scroll box under Visual. Click a line to seek; the current line highlights and follows playback without moving the page. A transcript line is an anchor like a circled spot: hovering one offers Comment and Explain on that line's time range, and a line covered by an annotation is underlined and opens it.
- On open, a caption floats over the player for a few seconds naming the tools — circle to comment, search the video, click a transcript line to seek — then fades.

### Transcription

Transcription starts on its own the moment a video is added — the transcript is the point. The pane never shows a Transcribe button: it shows Transcribing…, then the lines; Retry appears only when every rung failed, and Transcribe again redoes a finished transcript. The job runs a provider ladder ordered by source, writes the timed segments as TRANSCRIPT blocks, and stores which rung succeeded (`POST /api/documents/[documentId]/transcribe` runs the same job for retries):

- **YouTube video:** Gemini reads the video by URL (`GEMINI_API_KEY`; `gemini-3.7-flash`, then the `gemini-flash-latest` alias, so a retired model can never take the feature down) → caption tracks from the player API, keyless (ANDROID_VR client first — embedded-device clients answer datacenter IPs where the phone and web clients now demand a bot check — then ANDROID, then IOS) → caption tracks scraped from the watch page. Most YouTube videos carry transcripts Gemini reads directly.

A video costs Gemini about 100 tokens per second, so anything past roughly two hours overruns the 1M context window in one call. Past 700k tokens the video transcribes in 30-minute windows: `countTokens` on the whole video and on one known minute gives the video's own token rate, and the two divide into a duration. Windows run together (six at a time, four hours maximum) so the wall clock is about one window rather than their sum, timestamps inside a window are clip-relative and get shifted back onto the video's clock, and one dead window leaves a gap instead of losing the transcript.
- **Uploaded video:** OpenAI Whisper (`OPENAI_API_KEY`; 25 MB cap for now) → Gemini with the bytes inline (≤14 MB).

Transcription runs at low media resolution throughout — it needs the audio, not the pixels.

Each rung fails with a plain reason; the ladder tries the next and reports every reason when all fail. `VideoAsset.transcriptStatus`: NONE → PENDING → READY | FAILED with the reason stored. Upload and playback work without any key; the transcript pane offers Transcribe and states plainly what is missing.

### Video derivations (same pipeline, §4)

- The cached document prefix tags timed blocks: `[block <id>] (TRANSCRIPT 12.4s–18.2s)`. One cache entry per video document, like every document.
- `FIND` — the video content reader. `{type: FIND, query}` → JSON `{matches: [{blockIds, explanation}]}`; the server resolves each match's blocks to a time range. Renders as cards with seek chips. "Add to notes" lands a `PENDING` note with a time source — never persisted without the user.
- `EXPLAIN` with a video anchor `{startTime, endTime, region?}`: the client captures the frame at that moment — from the file for an upload, from the storyboard sheets for a YouTube video — cropped to the drawn loop, and attaches it; the model reads the frame plus the timed transcript. A storyboard frame is small, so Gemini also watches the same clip at full resolution and its description rides along: two independent looks that corroborate each other, with the prompt telling the model to trust the image, never claim what it cannot see, and say so when the frame is too small to be sure. Output persists as an annotation with the same time source, so explained moments join Visual.

### Build phases (continue §8 order)

### Phase V1 — Upload, store, play
- Video files through the chunked upload path → Document + VIDEO block + VideoAsset → video pane with custom player.
- **Done when:** an mp4 uploads, plays, seeks smoothly via Range requests, survives reload, and a re-upload dedupes by fileHash.

### Phase V2 — Transcript
- Transcribe route → TRANSCRIPT blocks → transcript pane with click-to-seek and follow-along highlight.
- **Done when:** clicking a line seeks the player; the playing line highlights and scrolls into view; a missing key degrades to a plain message, never a broken pane.

### Phase V3 — Annotations
- Circle + comment overlay, replay at their times, marker strip, Visual strip.
- **Done when:** an annotation drawn at 0:12–0:31 reappears whenever playback crosses that range, at any player size, and survives reload.

### Phase V4 — Find + Explain
- FIND over the transcript; EXPLAIN with frame capture.
- **Done when:** "where do they discuss X" returns seekable ranges with explanations; explaining a circled region yields an annotation citing that time range.
