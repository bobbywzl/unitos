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
- **AI:** Kimi K3 (Moonshot AI, `kimi-k3`) via the Vercel AI SDK (`ai` package, `@ai-sdk/moonshotai` provider), streaming responses. One model behind every feature but the import (`lib/kimi.ts` is the client); the model stays a per-derivation-type config constant, with a reasoning effort beside it (`DERIVATION_EFFORT` in `lib/derive/config.ts`: `high` for the reader's tools, `max` for ANALYZE). The import — the upload assistant's review and instruction check, the URL core and structure passes, Import PDF's judgment, and conversion — runs on Claude Fable 5.1 (Anthropic, `claude-fable-5-1`, `@ai-sdk/anthropic` provider; `lib/claude.ts` is the client) at its highest reasoning effort (`PARSE_MODEL` and `PARSE_EFFORT` in `lib/derive/config.ts`: `max`): what the parse gets wrong, every later tool inherits. Visualize (§20, Unitos Ultra) runs on Claude Fable 5.1 too (`VISUALIZE_MODEL`, `VISUALIZE_EFFORT` `max`): the picture has to be faithful or refused. The keys are `MOONSHOT_API_KEY` and `ANTHROPIC_API_KEY`; `MOONSHOT_BASE_URL` and `ANTHROPIC_BASE_URL` override the endpoints. **The bimonthly model update:** the three constants (`KIMI_K3`, `CLAUDE_FABLE_5_1`, `GEMINI_FLASH` in `lib/derive/config.ts`) are the defaults of three roles (`lib/models.ts`: kimi, claude, gemini). On the 1st of every second month `/api/cron/models` (vercel.json, `CRON_SECRET`; the admin page's Check now runs it any time) reads each provider's published model list (`GET /v1/models` at Moonshot and Anthropic, the Gemini models list at Google), finds the newest version of the role's family at the same shape as its current id (`claude-<name>-<version>`, `kimi-k<version>`, `gemini-<version>-flash`; a -thinking, -lite, -preview, or dated variant is another product and never taken), makes one probe call on it, and writes the id to the role's `ModelChoice` row; the clients (`lib/kimi.ts`, `lib/claude.ts`, `lib/video/gemini.ts`) resolve a default id to its role's row on every call, so nothing else changes. Every outcome — no newer version, a probe that failed, a key not set — lands on the row for the admin page (`lib/model-update.ts`).
- **Prompt caching:** The full parsed document is the prompt prefix (Moonshot's automatic context caching: a byte-identical prefix past 256 tokens is served from cache at a tenth of the input price, with no cache markers in the request). Every selection-level derivation must reuse the cached prefix.
- **Parsing:** PDF → blocks server-side. Use `unpdf` or `pdf-parse` for text extraction; preserve reading order. Markdown file (`.md`, `.markdown`, `.txt`) → blocks through the URL walk (`lib/parse/markdown-document.ts`): the file becomes one HTML page (remark with GFM: headings with GitHub-style ids, paragraphs, lists and task lists, tables, code fences, blockquotes, images as figures with the title or alt as caption, footnotes, raw HTML kept, front matter dropped and its title kept) and the walk reads it like a web page, no model pass; math is set aside before the markdown parse so its underscores and stars are not emphasis — `$$…$$` and `\[…\]` become EQUATION blocks, `$…$` and `\(…\)` stay as written in the text; an image with an absolute http(s) URL keeps it, an image with a relative path is its caption, a relative link is its text; the bytes are kept (`Document.fileData`) and dedupe by hash like a PDF, and a re-parse reads them again (a stored file that does not start with `%PDF-` is a Markdown file). URL ingestion: full-DOM structural parse via `jsdom` — equations keep their TeX (KaTeX/MathJax annotations, rendered with KaTeX in the reader), charts keep their inline SVG, figures keep their images and videos, lists/tables/separators keep their shape — and figures keep the page's look: the page's stylesheets load at parse (`lib/parse/figure-style.ts`), a chart svg carries the page's colors, fonts, and backdrop as inline style on its elements, and an image carries the backdrop the page drew behind it, so a dark site's white-line diagram renders on its own black instead of the reader's paper; and figures keep the page's layout: the same bake reads the page as a 1280×900 desktop browser lays it out and writes what it finds into the DOM before the walk — what that browser hides (a page's mobile tree beside its desktop tree) is pruned, centered captions stay centered, bold, italic, and monospace text keeps its style, headings keep their size, and every media element and every column of a figure row carries its width as a share of the text column, so two charts set side by side stay side by side at their size instead of stacking at full width (the layout walk: a px width sets, a percentage multiplies, padding subtracts, a grid divides by its tracks, a flex row shares the rest among its growing children; the text column is the most common width among the page's prose). The text column's width travels with the document (`Document.columnWidth`, 400–1100 px) and is the reader's article column for it, so the text runs as wide as it did on the page — the pane still caps the column, so it contracts when the notes tray opens; a figure the page sets wider than its text column (a chart at 844 px beside 680 px prose) carries the width past 100% on its `<figure>` and the reader draws it centered on the column and past its edges, as wide as the pane allows. A figure row — a flex or grid parent whose columns each hold media and a caption — is one FIGURE with one nested figure per column, its text the captions joined line by line; a single captioned figure is one figure with its caption. After the walk, a "Figure N" caption left with no figure beside it is rebuilt from the media nearest it in the page's DOM, and a caption beside a figure that has none folds into it (`lib/parse/figures.ts`). A page whose charts its scripts draw (an svg with a viewBox and nothing inside, a canvas) first renders in a real browser where one is configured (`lib/parse/render-page.ts`; `BROWSER_WS_ENDPOINT` or `CHROMIUM_PATH`, the browser §11 uses for transcripts, shared through `lib/browser.ts`): 1280×900, media, images, and fonts blocked, scrolled through one viewport at a time so scroll-revealed charts draw, 150 s at most, and the rendered DOM parses in the static page's place. A chart the page's scripts animate settles before the parse (`lib/parse/capture-animation.ts`): the page's clock is paused and stepped, a one-shot animation is drawn to its end, and a chart that loops is recorded frame by frame over one loop, encoded as a looping GIF (`lib/parse/gif.ts`, 10 frames a second, 64 colors, only the pixels that change per frame), stored as an `ImageAsset` of the document (`ImageAsset.documentId`; a re-parse or a delete removes it), and takes the svg's place as an `<img>` of the reader's own `/api/images/<id>` path — the upload assistant's review settles charts but stores nothing. Without a browser, or when the render fails, the static page stands and the figure audit (§15) reports the caption without its figure — followed by two AI passes that reference blocks by index and never write text: the core pass returns the block ranges that are the article (site navigation, footer link lists, newsletter, social, and legal chrome fall outside the ranges and are dropped), then the layout pass (`lib/parse/layout.ts`) reads the page's own HTML beside what survives — as a browser lays it out: class names, inline styles, and the layout facts the bake wrote in — and says what each block is on the page: the kicker over the title, the metadata line, the contents list and its label, a heading and its level, a pull quote, a quote, a caption, the figures that share one row, the chrome to drop, a wrong block type, a fragment split mid-sentence, and the page's font; a join concatenates label-and-value blocks with one separator, a merge joins a fragment to the block above it with a space, a figure row wraps figure blocks in one figure, and nothing else changes a block's words. The layout pass does the structure pass's work (drop, retype, merge) on the page's HTML; the structure pass alone runs for a PDF with upload instructions. The layout pass's decisions land as the same layout tokens the walk writes, so the reader renders both alike. Each pass runs against the request's time budget (`modelPassDeadline` in `lib/parse/ingest.ts`: the route's limit less a margin; `/api/documents` and `/api/documents/[documentId]/reparse` allow 300 s): a pass that cannot finish in time aborts or is skipped and the mechanical parse stands, never a failed add. Every ingest stream sends an empty heartbeat line every 5 s while a pass reasons in silence (`lib/ndjson.ts`), so the connection outlives the call. `@mozilla/readability` is the fallback for pages the structural walk cannot read. Ingest streams stage progress (fetch → extract → select → structure → layout → save) to the client. The browser render is the longest stretch of the fetch stage, so it reports each phase it enters as the stage's detail line — rendering the page, opening it, scrolling through it, settling chart n of m — and the progress card keeps moving instead of standing on one line. Every document is stamped with the parser version that produced it; a URL document stamped with an older version re-parses automatically — on open, and when its URL is added again — and can be re-parsed manually from the document menu.
- **Anchoring:** W3C Web Annotation selectors via `apache-annotator` (`@apache-annotator/dom`, `@apache-annotator/selector`).
- **Digest (Phase 6):** the assistant's stored context — one `NotebookDigest` row per corpus per user, rebuilt on read when a content fingerprint moves (§7). No embeddings: the assistant reads the corpus whole.
- **Styling:** Tailwind. Split-pane layout via CSS grid, not a heavy library.
- **Auth:** dual mode (Scalae pattern). With `SESSION_SECRET` plus Google (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`), Apple (`APPLE_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY`), or email (`RESEND_API_KEY`, `EMAIL_FROM`) credentials set, sign-in (hand-rolled OIDC code flows, database sessions in an httpOnly cookie, 30 days; accounts key on the email, so every provider lands in one account; Apple's callback is a cross-site form_post with a SameSite=None state cookie and a self-signed ES256 client secret; email sign-in stores a hashed single-use token per `EmailConfirmation` row (`purpose` "signup" | "reset"), 30-minute expiry, and creates the account only when the link is clicked; the link lands on `/welcome` to set a password (scrypt, `User.passwordHash` "s1$salt$hash", "" = none); returning users sign in with email + password at `/signin?mode=in`, and Forgot password emails a reset link to `/reset`, which sets the new password and signs every other session out) gates the app at `/signin`; corpora, profiles, and digests belong to accounts, and the first account to sign in adopts the local reader's data. Unset, the app runs as the single local reader (`user-1`), nothing gated. `/admin` keeps its own `ADMIN_PASSWORD` gate, decoupled from reader sign-in; the admin never has access to an account — no session, no impersonation, no edits — and sends notifications into accounts (§18) and nothing else. Corpus routes verify membership (owner or collaborator, §12); object routes resolve their object to its corpus or document and check the same roles. `/api/auth/test-login` is a QA door, sealed unless `TEST_LOGIN_TOKEN` is set. With sign-in on, `/signin` opens a beta notice once per tab (sessionStorage `unitos-beta-notice`): Unitos is in beta, thanks to every beta user, and every beta account gets Unitos free and unlimited for now — the notebook and the Kimi, Claude, Gemini, and Groq tokens it uses — signed by the Unitos team; Continue, Escape, or a click outside closes it. Above the notice's card a figure in the mark's outlined style — the upper half of a person, standing behind the card — bows and rises on a loop (`signin/beta-notice.tsx`, `bow-*` in globals.css; still under reduced motion). The page's hero reads "Got a ___? Put it in Unitos Notebook." — the blank rolls through a video, an audio file, an article, a research paper, a legal document, a PDF assignment, one every 2 seconds, up like a slot-machine reel (`signin/hero-reel.tsx`); set in capitals in the page's own display face, a condensed high-contrast serif (Noto Serif Display, `.font-hero`), the first line as large as the column allows and the second smaller — over one line on what Unitos is: an AI-assisted notebook you can share, every note anchored, every passage explained at your depth. Beside it, the reader in motion: a cursor tours the screenshot and each function's callout — "Function: what it does", the dot on that control — fades in as it is used.
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
  gist           String?    // the phrase a collapsed row shows, written by AI to fit the row (§6); null until written, cleared when content changes
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
  EXTRACT    // the reader's Match-it: origin phrase → the passages that reveal its topic, stored on the attachment
  SUMMARIZE  // document-level summary, one per depth
  SYNTHESIS  // notebook-scope assistant output
  DISTILL    // the reader's Extract: question → the quotes that answer it, stored on the attachment
  KEYPOINTS  // the reader's Distill: the article's most important points as bullets, each anchored, stored on the attachment
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
  glossary  Json?    // Phase 7: [{term, definition, blockIds[], lang, definitions: {en?, zh?}}]
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
  keypoints     Json?    // KEYPOINTS output: {id, createdAt, createdById, points}, one per attachment; Distill again overwrites
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
  page       Int?      // 1-based PDF page: FIGURE blocks from a PDF, PAGE blocks, converted text
  region     Json?     // FIGURE blocks from a PDF: the figure's region on its page (the §11 percent-coordinate shape); null = the whole page
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
  type: 'EXPLAIN' | 'SIMPLIFY' | 'SALIENCE' | 'EXTRACT' | 'DISTILL' | 'KEYPOINTS' | 'SUMMARIZE' | 'FORMALIZE' | 'ASK' | 'COMPARE' | 'ANALYZE' | 'VISUALIZE';
  documentId?: string;         // absent for corpus DISTILL and for COMPARE
  documentIds?: [string, string]; // COMPARE only: the two documents, both attached
  notebookId: string;
  anchor?: AnchorInput;        // required for EXPLAIN/SIMPLIFY/EXTRACT/ANALYZE/VISUALIZE; optional focus for DISTILL
  question?: string;           // DISTILL: the question the quotes must answer; ASK: the question about the range
  video?: { startTime, endTime, region?, frame? }; // EXPLAIN on a moment (§11); ASK: the range
  depth?: 'layman' | 'intermediate' | 'professional'; // SUMMARIZE only; default layman
  format?: 'article' | 'notes'; // FORMALIZE only: the destination shape
  sectionId?: string;          // FORMALIZE notes, COMPARE: where the notes land
};
```

Flow:
1. Load document blocks (cached prompt prefix) + ReaderProfile + notebook section skeleton.
2. Select prompt template by `type` (templates in `/lib/prompts/`, one file per type).
3. Stream response. A streamed text derivation (EXPLAIN, SIMPLIFY, ANALYZE, SUMMARIZE, ASK, and the assistant's answer) goes through `lib/derive/text-stream.ts`: a heartbeat space every 5 s until the first text delta (Kimi K3 reasons before it writes, in silence, and an idle connection dies at proxies), then the text; a failure reports in-band, the stream ending with `STREAM_ERROR_TOKEN` and the reason — the API's error, the output budget spent before the answer, or the model declining. The client drops the heartbeat spaces and shows the reason, never an empty answer for a failed call.
4. Route output by destination:
   - `EXPLAIN` → annotation bubble in the reader rail (persisted as a Note in a hidden "Annotations" section, so it's searchable, but rendered in the rail)
   - `SIMPLIFY` → bubble beside the article, level with the selection (ephemeral, not persisted; close to dismiss)
   - `SALIENCE` → highlight layer (persisted as document-level Json, per notebook)
   - `EXTRACT` (the reader's Match-it) → extraction on `NotebookDocument.extractions`, painted as a labeled highlight layer: the origin phrase plus the passages across the document that reveal its topic; every span opens the match card, which lists the origin phrase and every passage, each row jumping to its text
   - `DISTILL` (the reader's Extract) → distillation on `NotebookDocument.distillations`, rendered as the extract page; a quote reaches notes only through the page's "Add to notes", which lands a `Note` with `status: PENDING`
   - `KEYPOINTS` (the reader's Distill) → keypoints on `NotebookDocument.keypoints`, rendered as the distilled page; a point reaches notes only through the page's "Add to notes", which lands a `Note` with `status: PENDING`
   - `SUMMARIZE` → Summary tab in the side panel (persisted on `NotebookDocument.summaries`, one summary per depth; Regenerate overwrites)
   - `FORMALIZE` → the transcript rewritten (§11). format `article`: `{title, markdown}` on `NotebookDocument.formalized`, rendered under the transcript; Regenerate overwrites. format `notes`: one `PENDING` note per topic, each with a time source resolved from the topic's transcript blocks
   - `ASK` → the answer to a question about a time range of a video or audio document (§11), streamed as text into the pane's Ask card; persists nothing. "Add to notes" lands it as a `PENDING` note with a time source for the range (`/api/notes`, origin `ask`)
   - `COMPARE` → two documents read whole: one `PENDING` note of agreements, disagreements, and what only one covers, with a source per cited span on both documents. Opened from the document list: each other document's menu offers Compare with the open document
   - `ANALYZE` → a FIGURE or TABLE block read by the vision model, streamed into the card beside the block — the same card as EXPLAIN, titled Analysis — and persisted in the hidden Annotations section like EXPLAIN (the figure toolbar's Analyze figure; Analyze table on a selection inside a table). Never a note.
   - `VISUALIZE` (§20, Unitos Ultra) → the selection as a picture, into the same card as EXPLAIN, titled Visualization, and persisted in the hidden Annotations section like EXPLAIN: an SVG `ImageAsset` and one annotation whose markdown is the image and its caption. When the model is not certain a picture carries the passage's core idea, the run declines with the reason and persists nothing.

Prompt templates always receive: reader context, document title, section skeleton, and the anchored text with surrounding context (±2 blocks). Every reader-facing template ends with the one style rule (`STYLE_RULE` in `lib/prompts/types.ts`: short sentences, plain words, one point per sentence, no preamble, no filler, no closing summary) and a word cap: Explain 150, Ask 150, Analyze 220, the assistant's answer 250 unless the question needs more, summaries 180 (layman), 300 (insights), 400 (professional). Captions, compare points, find explanations, and glossary definitions are one sentence, two at most.

**DISTILL output contract:** model returns JSON `{quotes: [{blockId, start, end, caption}]}` — the verbatim spans across the whole document that answer the question, each captioned with how it answers the question in the document's context. Validate strictly; resolve every span against the real block text and drop what does not resolve; on parse failure, retry once with the error appended, then surface failure to user. Never write malformed output to DB. Stored quotes heal at render like salience and orphan visibly (§5). The HTTP response streams heartbeat bytes while the model works and ends with the distillation JSON (or the in-band error token), so the connection survives a minutes-long scan.

**KEYPOINTS output contract:** the model reads the whole document at `"max"` effort and returns JSON `{points: [{text, blockId, start, end}]}` — 5 to 20 of the document's most important points as bullets, in document order, each written in the reader's language and anchored to the verbatim span it comes from (a full sentence up to a full paragraph). Validate strictly; resolve every span against the real block text and drop the point when its span does not resolve — a bullet with nothing behind it is a claim of the model's own. One keypoints object per attachment; Distill again overwrites. Stored spans heal at render like salience and orphan visibly (§5). Runs behind the heartbeat stream.

**COMPARE output contract:** both documents ride as one cacheable system message under their ids (the corpus DISTILL rendering, 220k characters per document, cut with a marker past that). The model returns JSON `{agreements, disagreements, onlyFirst, onlySecond}`, each a list of `{point, spans: [{blockId, start, end}]}`; an agreement or disagreement cites one span per document. Validate strictly; resolve every span against the real block text and drop what does not resolve; a point with no resolvable span still stands as text. The note (`lib/derive/analysis.ts`) lists the points under Agree, Disagree, Only in <first>, Only in <second>; its sources are the distinct resolved spans, at most 24. No point at all fails the run. Runs behind the heartbeat stream.

**ANALYZE output contract:** the block's visual attaches as it does for EXPLAIN (`lib/derive/figure.ts`: the image, the SVG source, or the PDF page region); a TABLE block attaches its markup, plus its page region when the PDF has one. The model is the one that reads visuals with the least invention — `DERIVATION_MODEL.ANALYZE`, the most capable model, the same one upload and parse trust. It sees the corpus section EXPLAIN sees (related passages from the other documents, the reader's notes and annotations) and streams markdown in exactly three sections, always in this order, each under its bold label (`ANALYSIS_SECTIONS` in `lib/prompts/analyze.ts`, per language): **Insights** — one or two sentences on what the visual is there to show, then 2 to 5 patterns read from the data and interpreted against the document (a trend, a break, an outlier, a gap between groups, a comparison the argument rests on, what the visual shows that the text does not say); **Quantitative** — the numbers behind each pattern, as printed, never rounded, ≈ before a value estimated off an axis or a bar, "(text)" after a number taken from the document instead of the visual; **Linking to context** — where the visual contradicts, weakens, or complicates a claim in the document, cited as `[block <id>]`, and where it connects to the project's other documents and notes; one line when there is neither. Under 220 words. The stream ends with `STREAM_NOTE_TOKEN` + the annotation's id, like EXPLAIN; the annotation is anchored to the whole caption or the table selection, reopens from the block's side label, and lists under Analyses in the Annotations tab.

**VISUALIZE output contract:** see §20.

**EXTRACT output contract:** model returns JSON `{spans: [{blockId, start, end}]}` — the passages across the whole document most revealing about the highlighted phrase's topic. Validate strictly; resolve every span against the real block text; drop spans that overlap the origin or each other. Stored per notebook per document, oldest first — the index gives the label (M1, M2, …). Spans heal at render like salience; an unresolvable span stays stored but unpainted. (The v1 EXTRACT selection-to-note flow lives on as DISTILL's "Add to notes".)

---

## 5. Anchoring (make-or-break)

Anchors must survive re-parses and reflows. Dual strategy:

1. **Primary:** `blockId + startOffset + endOffset` against block plain text.
2. **Fallback:** `TextQuoteSelector` — `quotedText` + 32-char `prefix`/`suffix`. On load, if block resolution fails (block deleted or text changed), fuzzy-match the quote across the document via `@apache-annotator`.
3. **Never silently drop.** Unresolvable → set `orphaned: true`, render the note with a broken-link indicator and the quoted text preserved.

DOM ranges are never the source of truth. Convert selection → block-relative offsets at capture time using data attributes (`data-block-id`) on rendered blocks.

**Passages.** A selection that crosses blocks is one passage (`lib/anchors/passage.ts`): the reader captures one segment per block it touches, in reading order — the first block's span from the selection's start, whole blocks between, the last block's span to the selection's end — and sends the first segment as `anchor` with every segment as `segments`. Equations and pages take no span and are left out (the popover says so). Every tool works on the whole passage: the routes (`/api/derive`, `/api/annotations`, `/api/notes`, `/api/assistant/act`) resolve each segment through the ladder on its own, the anchored text is the segments' quotes one paragraph each, and the note gets one source per segment, so its marks cover the whole selection and each mark resolves, orphans, and jumps on its own. Simplify numbers the passage's sentences on through the blocks — a block boundary is always a sentence boundary (`lib/sentences.ts`) — so a pressed rewritten sentence mirrors its source sentences in whichever blocks hold them.

---

## 6. Layout & UX

**Split view, both panes persistent:**
- Reader views: Normal shows one document; Side by Side and Top and Bottom show two panes, each with the full tool set (`?view=side|stack&doc2=`). The bar between the two panes drags to change how they share the reader — like the notes tray's bar: double-click resets to half, arrow keys nudge, and the split is remembered per browser, one per view kind (`unitos-pane-split:<view>`, 0.2–0.8).
- **Left:** document reader. Blocks rendered from DB, selection popover on highlight. **One toolbar per content kind** (`TOOLBARS` in reader-interactions.tsx): the popover shows the tools of the kind under the selection and nothing else, and a tool missing from a kind's list is never offered there. The first tool after the assistant is the kind's lead tool and reads as recommended.

  | Kind | Blocks | Toolbar |
  |---|---|---|
  | Text | PARAGRAPH, HEADING, LIST, CODE | Assistant, Explain, Simplify, Match-it, Comment, Link across texts, highlight colors, Add to notes, Read aloud |
  | Table | TABLE | Table tools: Assistant, **Analyze table**, Explain, Comment, Link across texts, highlight colors, Add to notes |
  | Figure | FIGURE | Figure tools: Assistant, **Analyze figure**, Explain, Comment, Link across texts, highlight colors, Add to notes |
  | Equation | EQUATION | Equation tools: Assistant, Explain, Comment, Link across texts, highlight colors, Add to notes |

  Analyze (§4) exists only on the table and figure toolbars; Simplify, Match-it, and Read aloud only on text. A new kind of content gets a new row here and a new list in `TOOLBARS`, never a condition on a button.
- **Layout tokens.** A text block's html may open with class tokens — `<p class="kicker center">`, `<h2 class="center">`, `<ol class="contents">` — and the reader lays the block out by them (`layoutTokens`, block-view.tsx): `center` centers the text; `kicker` and `meta` are small mono uppercase, muted and letter-spaced; `label` is the same with a hairline rule under it; `contents` is the contents list — no list padding, one entry per 32px line, a hairline under each line drawn by a repeating gradient, so no text node joins the block; `display` is a standalone statement at 28px; `quote` a blockquote paragraph with a left rule; `caption` a caption standing alone at 13px, muted. One token decides a block's look; `center` only aligns. The masthead rule: when a centered kicker or meta line opens the document, or its first heading is centered, the title renders centered, large and light (40px, weight 400, `.reader-masthead-title`), the kicker above it and the meta line below. The kicker is the document's first block, pulled out of the flow and still rendered through `BlockView`, so its `data-block-id` and its marks work.
- **Figure rows.** A figure's html is one `<figure>`, and its children lay out as a wrapping row centered in the column (`.reader-figure > figure`, flex): a caption takes the full width, a nested `<figure style="width:33%">` is one captioned column stacking its media over its caption, and media keep an inline width from the page (`style="width:48%"`, a percent of the article column) — two charts share a row at the page's proportions instead of each filling the column. No figure rule is `!important`, so the inline width always wins. Media in a row sit 2% apart, so their widths must sum to 100% less the gaps (two at 48%) or the row wraps; a column carries its gap inside its own width as padding, so three columns at 33% fill one row.
- **Fonts.** `Document.font` is null (Figtree), `serif`, `mono`, or `sans`: the parser stores `sans` for a page set in a sans face, and the font picker offers it. The article carries `data-font`; for `sans` the headings and the title leave the display face for the body's sans (weight 600, `letter-spacing: -0.01em`; the masthead title stays 400). Heading sizes never change with the font.
- **Right:** docked notes drawer showing the section skeleton of the current notebook. Pending notes render with amber left-border + Accept (`Enter`) / Reject (`Backspace`) / Edit (`e`). Accepting must be exactly one keystroke when a pending note is focused.
- **Reader views** (`reader-panes.tsx`; the button at the bottom left of the reader): Normal shows one document; Side by Side and Top and Bottom show two panes, each with the full tool set, the view and the second document carried in the URL (`?view=side|stack&doc2=`); a fresh open is Normal. A split view is its own layout, so two panes never crowd each other:
  - Each pane has a **pane header** — one row at its top, above the scroller, never over the text: the pane's document (a select; choosing changes the URL), the article menu and the search, and Distill and Extract. In Normal view the article menu floats over the top of the page and hides once the reader scrolls; in a split view it lives in the header and stays in reach, its panels dropping below the header.
  - Tool cards stay **collapsed** in a split pane: a stored explanation, simplified rewrite, assistant conversation, or comment shows as its highlight and the tool's symbol at the end of the text, and opens only when the reader clicks the highlight or the symbol; the card then docks below the highlight at the article's width, as in a narrow reader. New output still opens as it streams.
  - With the tray folded the two panes fill the browser exactly. Opening a tab (the rail, a jump to a note or an annotation) does not shrink the panes: the reader keeps its width and the tray becomes a screen past its right edge, in a **strip** that scrolls sideways and snaps to one of two rests — the documents, or the documents' right part with the tray. Opening a tab scrolls to the tray; an edge button at either side (one at a time, on the side with a screen past it) and a sideways scroll move between the two; folding the tray scrolls back to the documents first, then the column closes. In Top and Bottom the pane header and the article column center in the part of the pane the strip leaves visible (`--strip-cut` on the strip, `--reader-cut` per pane), so no line starts under the edge; a Side by Side pane is narrower than the column, so its first pane peeks from under the edge instead. Below md the tray stays a bottom sheet and there is no strip. The workspace grid is one column that can never grow past the browser (`minmax(0, 1fr)`): a pane's widest line stays inside its pane instead of pushing the rail and the header off screen.
- Notes reorder by drag in the tray and on the notes full page: the grip at the left of a note's header (shown on hover; a viewer has none) drops the note where the note under the pointer sits; a search pauses it. The notes full page adds section reorder, renaming, compare, and export.
- A full page load keeps the reader where it was (a note, an annotation, or an AI tool refreshes the page, and a new deploy or a dropped response turns the next refresh into a full load): the reading position — the block at the top of the pane and its offset, not a pixel count, so a figure above it that loads late moves nothing — and the drawer's folded state and tab save per tab in sessionStorage (`lib/reading-position.ts`); an inline script restores them before the first paint, and the reader holds the position while the layout under it settles, until the reader scrolls. A `?src`, `?block`, or `?link` jump wins over the restore.
- **First open.** A document opened right after it was added reveals as the reader scrolls, as if laid out in sequence (`reveal.tsx`): the add sets `unitos-reveal:<documentId>` in sessionStorage before the open (document-bar.tsx), and the reader takes the flag on mount. Every block wrapper starts invisible in its place; one IntersectionObserver on the pane's scroll box gives each block its turn as it enters the pane — blocks in view together in document order, 110 ms apart — and a text block unclips line by line (`steps(n)`, one step per line at 70 ms, 1.4 s at most) while a figure, a table, or a page fades in and rises 8px over 320 ms. A revealed block stays revealed: the wrapper keeps no class and no style after its turn, and it has no padding, border, or overflow, so margins collapse through it as before. Reading mode only — never the transcript, never over a reading position restore or a `?src`, `?block`, or `?link` jump, never under reduced motion, and never on a full page load, where the article is already painted.
- Note edits auto-save: while a note's editor is open, every edit saves on its own — a debounced PATCH after the last keystroke, a keepalive flush when the window closes — so nothing typed is lost. Done closes the editor; Cancel and Esc restore the content from before this edit, auto-saves included.
- One note structure, everywhere a note renders (the tray, the notes full page, a compare pane): a header row — collapse chevron and the note's id at the left (`#` plus the last six characters of its cuid; click copies it; searching `#k3x9pq` finds the note), edit (the pencil), jump, pin, and select at the right (the circle; its tooltip names what the selected notes do together — merge, pin, delete, and on the notes full page compare) — then the body, then the actions. The editor keeps that shape: the header stays, and the note is edited as the document it renders to, so the note looks the same after Done as it did while editing.
- Any number of effects stack on the same words, and no surface shows their markers: the editor paints them live, the rendered note nests them, and the collapsed line strips them. The note's colors and underline are stored as tags (`<clay>`, `<u>`) that react-markdown drops, so the renderer turns them into links its `a` override paints (`components/markdown.tsx`); a link cannot hold another link, so nested tags are flattened first — every run of text is emitted once with all the styles covering it in its href, and a chip or a markdown link inside a tag is left alone, the styles passing over it. Converting one tag at a time nested the links and left the outer one showing as `[word](#dissect-style-clay)`.
- Editing renders live — headings, lists, quotes, bold, italic, underline, colors, ¶ chips, links — as markdown underneath (`lib/note-markup.ts` renders the document, `lib/note-doc.ts` reads it back after every edit). Typing "- " or "1. " starts a list, Enter continues it, Enter on an empty item ends it, Tab nests an item and Shift+Tab brings it back out, Backspace at the start of a marked line drops the marker (a nested item outdents first), Cmd+B/I/U and the bar's B/I/U style the selection or what is typed next. Each level draws its own marker — disc, circle, square; 1., a., i. — in the editor and in the rendered note alike. The editor nests by two spaces a level whatever the marker; markdown nests by the parent item's content column, so the renderer re-indents the lines to the columns markdown expects (`alignListIndents`, components/markdown.tsx) — without it a nested numbered item came out flat the moment the note was rendered. The editing card grows with the note, capped at the height of the pane it scrolls in — the tray's panel, or the window on the notes full page — and past the cap the text scrolls inside the card while the bar and the buttons stay; opening the editor brings the whole card into view. In the tray a note leaves the tray by a drag, editing or not: hold its header (or, while editing, the grip row above the bar) and move sideways about 24px, farther sideways than up or down — a vertical move is a scroll or a reorder, never a drag out; a shorter move stays a click — and the note becomes a floating card over the article, in its editor, with the same auto-save. While a card floats the tray folds and the article column moves to the pane's left edge, out from under the card; both come back when the card docks or closes. The card moves by its handle and resizes from its corner; dropping it on the rail or the tray, or Back to the tray, docks it. Wrap text, a toggle on the card remembered per browser (`unitos-note-wrap`): the card joins the article's scroll pane at its spot in the text, scrolls with the text, and the lines flow around it — the card announces the gap it needs (`lib/note-wrap.ts`) and the reader draws it as a pair of float spacers at the article's content top — the one position the card measures against exactly, since a float placed before a block lands at the block's margin edge, not its border edge — on the side of the column the card sits on, 18px clear of the card on every side; when less than 200px of text would remain beside the card, the text skips below it instead. Only paragraphs, headings, and lists flow around the card. A figure, a table, a video, a page, an equation, or a code block is one object that a sliver of column would ruin, so it clears the card and takes its place above or below it, whole. The tray card reads "Editing in a floating card" meanwhile.
- Every note, annotation, and edit jumps back to its exact position in the article: the jump button (the locate glyph) on a note's header opens the reader on the note's first source and flashes the quote (double-clicking the card does the same; each source chip jumps to its own quote); on an annotation card it is the existing jump to the anchor; on an edit row it scrolls the open document to the edited block and flashes it, while the block is still in the document.
- Notes have two views, per browser and per project (`unitos-notes-view:<notebookId>`; the tray and the notes full page share it). **Collapsed**, the default: every accepted note folds to one line — its id, its gist, and its source count. The gist is one short phrase, written by AI, that says what the note says and fits the row: at most 5 words and 30 characters (14 in Chinese), in the note's language, no trailing period (`lib/prompts/gist.ts`; `POST /api/notes/gist` writes it to `Note.gist` in one batched call when collapsed rows render without one; a content edit clears it). Until the gist arrives the row shows the note's first words, cut at a word boundary — never with an ellipsis. That fallback is the text the reader sees, never the markdown behind it: `lib/markdown-preview.ts` takes the markers off with the note's own parser (`parseNote`), so a stack of effects reads as plainly as one — a hand-rolled strip only knows the shapes it was written for, and left `**_word_**` reading as `_word_`. A chip reads as nothing and an image as its alt: a preview line has no room for a picture, and none for a URL. **Expanded**: every note shows whole — nothing clipped, nothing to scroll inside a card. One button beside the search — Expand all / Collapse all — switches the view; a note's own chevron opens or folds that one note against the view until the view switches again. Pending notes never collapse: they are read before they are accepted. A jump to a note (an issue card) opens it if it is collapsed.
- Annotations have the same two views (`unitos-annotations-view:<notebookId>`): every card in the Annotations tab — highlight, comment, explanation, analysis, assistant conversation, simplified rewrite — carries the note structure (chevron, the highlight's color, the id) and collapses to its id and its gist by default (the AI-written phrase a note's row shows, its first words until it arrives); Expand all shows every annotation whole, the assistant conversations included, with no scroll inside a card. Clicking an annotation's mark in the text opens its card if it is collapsed. Links keep their compact cards. Each group's label carries the symbol of the tool that made it — the comment bubble, Explain's question mark, Analyze's chart, the assistant's sparkle, Simplify's lines, the link chain — the glyph on the toolbar button and on the mark in the text, so a reader finds a comment or a link by the symbol they used. In the text the symbol is a small round chip at the end of the highlighted text, on the highlight's bottom edge right after its last character, in every view (`.mark-chip`); clicking it opens the card. A highlighted figure, table, or equation shows the same symbol in its side label.
- Compare, on the notes full page: select two or more notes and press Compare in the selection bar. The compare view opens over the page with one pane per note — each its own scroller holding the whole note card, so the notes read and edit next to each other — Side by side (columns) or Stacked (rows); the layout choice persists per browser (`unitos-compare-layout`). Add note… adds a pane, ✕ removes one, and Esc or Notes closes the view.

**Other UX rules:**
- Clicking a source chip on any note scrolls the reader to that anchor and flashes the highlight. If the document isn't open, open it.
- No pill, tab, select, or collapsed row cuts its text with an ellipsis. A label is written to fit (the Add-document tabs: PDF, image, or Markdown; Video or audio; Google Drive; URL; Library); a document title in the top bar's document pill, the document list, or a pane's document select is cut at a word boundary, the full title one hover away (`clipWords`, `lib/markdown-preview.ts`); a collapsed note or annotation shows its gist.
- The text under the open selection popover keeps a selection tint (a mark of kind `selection`, the same color as the browser's selection): the browser's own selection goes the moment the assistant's command box or the comment box takes focus, and while the assistant runs, but the tint stays until the popover closes. Every block of the passage (§5) keeps it, so the tint is the selection whole from the moment the pointer lifts, never the first block alone. The native selection over that mark paints nothing, so the two never stack. Reading mode only — edit mode's blocks are the browser's editable regions.
- A deleted note's marks answer at once, wherever the delete came from — a tool card's Delete, the on-mark card, the Annotations tab, the notes tray (`dissect:note-removed`): the mark fades (`.mark-out`), takes no clicks, and unpaints before the refresh; a failed delete puts it back (`dissect:note-restored`). Marks that open something deepen on hover. An Explain, Simplify, or Assistant run keeps its mark after its card closes, until the server's copy lands.
- SIMPLIFY opens a translucent bubble to the right of the article, level with the selection, sliding in with a smooth animation. The selection stays tinted while the bubble is open. The document text never changes. The output persists as a note in the hidden Annotations section (like EXPLAIN), so it is still there when the reader leaves and comes back — listed under Simplified in the Annotations tab. Sentence mirroring: the prompt numbers the original sentences and the model appends a source marker ([[1]] or [[2,3]], at least one number) after each rewritten sentence. Every sentence in the bubble is lightly tinted; pressing one turns it solid and tints exactly its source sentences in the article. Both sides split sentences with the same function (src/lib/sentences.ts), so marker indices map back to exact offsets — never model-quoted text.
- Edit mode has no Edit button: double-click a text block to edit it in place. A fading hint card beside the article teaches this until the first double-click. Done, Esc, or a press anywhere outside the article, its format bar, the edit-mode controls, and the selection tools returns to reading — whatever was being typed saves first, and the format bar never outlives the mode. Selecting text in edit mode opens the same selection popover as reading mode; unsaved typing saves before any anchor is stored.
- The edit toolbar: undo / redo, paragraph / h1 / h2 / h3 / bulleted list / numbered list, bold / italic / underline, indent / outdent (two-space steps on the caret's line), remove paragraph. List markers live in the text ("- ", "N. ").
- Undo and redo, on both editing surfaces, under the same two symbols — an arrow curving back and its mirror — and under Cmd+Z and Shift+Cmd+Z (Ctrl elsewhere). A note's history lives in its editable (`lib/note-editable.ts`), which already held it: the buttons are the same two steps. The article's edits are server calls, so its history is a stack of steps, each knowing how to take itself back and how to do itself again — a style is its own opposite, a format and a text edit remember what they replaced, an inserted paragraph is removed, and a removed one comes back through `/api/blocks/restore` with its own id, so anchors on it heal instead of orphaning. Undo settles the block being typed in first, so Cmd+Z after typing takes the typing back rather than the change before it; a fresh session of editing starts with an empty history.
- Cmd+B / Cmd+I / Cmd+U (Ctrl on Windows and Linux) style the selection on every surface that holds styled text, and a second press on the same words takes the style off: the reader's edit mode (`lib/markdown-style.ts` reads the keys, the same code path as the bar's B, I, U), the note editor everywhere it renders (`lib/note-editable.ts`, which owns the keys inside the editable — handling them again outside would toggle each press twice), and the comment boxes, whose text is markdown (the selection is wrapped in `**`, `*`, `<u>`). Markers hug the words: spaces at the selection's ends stay outside them, so the second press finds exactly what the first one styled. A reply is plain text, not markdown, and takes no styling.
- AI text cites document blocks as [block <id>] (the tags from the cached document prefix). Everywhere markdown renders — bubbles, chat, annotations, notes — the tag becomes a ¶ chip that scrolls the reader to that block and flashes it.
- The Assistant from the selection popover is conversational: the first command opens a miniature chat card beside the article; later turns send with the conversation history and the same anchor. The card resizes freely from its corner (native resize handle). Plans still go through the approval card (or run in Auto), and the chat narrates the outcome. Every assistant chat can be stopped mid-turn: the Run/Send button becomes Stop while a turn is in flight (closing the card or pressing Escape stops it too) — the request aborts server-side as well, the sent message stays, and no reply lands.
- Comment annotations show a small comment icon right after their span (SVG only — the block's DOM text stays the stored text). Clicking it opens the comment in a card with the same docking, dragging, and connector line as the other tool blocks.
- Stored EXPLAIN, ANALYZE, and SIMPLIFY annotations reopen their bubble: clicking the annotation's mark in the text (a figure's or table's side label) opens the bubble beside it with the saved content (sentence mirroring included for SIMPLIFY). Other annotation marks focus their card in the Annotations tab.
- Floating cards are freely moveable: drag the card header. Docking sets the initial position only.
- Tool blocks (Explanation, Simplified, Assistant chat) place by proximity to the highlighted text, never over the article: with nothing beside the text a new block goes right; with a block already close on the right it goes left; with both sides taken it drops below the existing blocks — right before left, top to bottom. Placement measures the blocks where they actually are, so dragged blocks count. Cards shrink to the margin (floor 260px) before ever overlapping the article. Every tool block grows with its content — a streaming explanation, a growing conversation — up to the pane's visible height (24px short of it), and past that its body scrolls while its header stays. A growing block that reaches a block below it on its side pushes that block down, and the pushed block pushes the next, each sliding to its new place; the growing block never moves, and nothing pulls a pushed block back up. A ResizeObserver on the blocks settles them (`settleSideCards`, reader-interactions.tsx); a manual resize of the assistant card counts as growth. The connector line follows every frame of a slide, and any scroll box under the text.
- The selection popover follows the same rule: right of the text when that side is clear, else left, else directly below the highlighted text.
- Link across texts (two-ended links): the first selection waits as the link's first end — tinted like a selection, a dashed sage line under it (mark kind `pending-link`) — while the reader finds the other end in this document, another attached document, or the other pane of a split view (the pending link lives in sessionStorage across a document switch). Highlighting text then shows the Close link chip at the end of the highlight; pressing it closes the link. Both ends paint the moment the link closes, sweeping in, in every pane that shows one (`dissect:link-created`), before the refresh delivers the server's copy. Then a link card opens beside the closing end, docked like the other tool blocks: both quotes and a box for what the link is about — Save stores it as the link's `reason` (the same field a recommended link's AI reason uses; `PATCH /api/links/:id {reason}`), Skip keeps the link as it is. The description shows in the mark's tip and under the link in the Annotations tab, where Describe / Edit change it.
- Voice: a round bubble under the selection popover reads the highlighted text aloud. The Edge voice reads it (`POST /api/speech`, Microsoft Edge's free read-aloud neural voices, no key — Xiaoxiao for Chinese text, Ava multilingual otherwise); when it fails and OPENAI_API_KEY is set, OpenAI TTS reads instead (model gpt-4o-mini-tts, voice alloy); when both are out, the most natural browser voice reads (zh-CN for Chinese text, en-US otherwise). The reading outlives the popover: dismissing the selection leaves a floating "Stop reading" control; that, the bubble, or switching documents stops it.
- Voice note: Speak, beside "+ note" on every section in the notes tray and on the notes full page. Press to record (five minutes at most, at a low bitrate so the recording fits one request), press again to stop; the recording goes to `POST /api/notes/voice?sectionId=` as its bytes, takes the upload transcription ladder (§11: Groq Whisper, then OpenAI Whisper, then Gemini), is cleaned line by line like a transcript (`lib/video/tidy.ts`), breaks into paragraphs at pauses over two seconds, and lands as one `PENDING` note (derivation type `VOICE`) at the top of the pending queue — transcribed speech is AI output, so the reader reads it over and accepts it. A refused microphone, a browser that cannot record, an empty recording, or a failed transcription says so under the section header.
- Highlight colors: a separate bubble right above the selection popover holds the four color dots (clay, sage, gold, plum); one click highlights the selection in that color. Near the top of the page the bubble drops below the popover instead, beside the voice bubble.
- A faint dashed connector line runs from the edge of each tool block's highlighted text to the block, so the correspondence stays visible with several blocks open.
- Figures, equations, and tables open their toolbar with a hold-and-circle gesture (pointer down + ≥300° of turning), anchored to the whole block; a selection inside a table opens the table toolbar too. Explain on a figure deciphers the visual — image figures attach the image, SVG charts attach their source, videos explain from caption. A highlighted figure shows a side label on its right that jumps to the annotation, instead of text marks.
- Distill (`KEYPOINTS`): the article as bullet points — from the Distill button at the top right of the reader, the Distill tab in the side tray, or the article menu. The distilled page opens over the article: the document's title at the top, under it its most important points as bullets, in document order, each anchored to the passage it comes from. Clicking a point closes the page and jumps to its exact span. Add to notes lands the point as a PENDING note (point as content, passage as source). Distill again replaces the points; Delete removes them. Cancel stops a running Distill — the request aborts, nothing persists, and the stored points stay; closing the page never cancels, and the Distill button carries a progress bar while a run goes. One distillation per notebook per document; the Distill tab shows it.
- Extract (`DISTILL`): the reader asks the article one question — from the Extract button at the top right of the reader, the Distill tab in the side tray, or the article menu. The extract page opens over the article: the question large at the top, under it the quotes that answer it, in document order, each with a caption saying how it answers the question and how it sits in the document's context. Clicking a quote closes the page and jumps to its exact span. Add to notes lands the quote as a PENDING note (caption as content, quote as source). Cancel stops a running extraction — the request aborts, nothing persists, and the ask view keeps the question for editing; closing the page never cancels, and the Extract button carries a progress bar while an extraction runs. Extractions persist per notebook per document, newest first; the page and the Distill tab list them, and the page deletes them one by one.
- Match-it (`EXTRACT`): from the selection popover, the passages across the document that reveal the highlighted phrase's topic paint as a labeled layer — the origin phrase solid-underlined, its passages dash-underlined, every span carrying the match's label chip (M1, M2, …). Clicking any span of the match — the origin phrase, a passage, or a label chip — opens the match card: the origin quote, then every passage quote, then Delete. Each quote in the card jumps to its text in the article; a quote the article no longer holds does not jump.
- Key terms (the dotted glossary underlines) are pressable: hover for the definition, press for the selection toolbar on the term with Match-it first, marked recommended.
- The article menu floats open at the top left of the page. It hides once the reader scrolls and returns when the reader is back at the top. It lists the frequent functions: Summarize article, Key takeaways, and Explain simply send the question to the assistant, which reads the whole document (document scope, cached prefix) and answers in the assistant chat card beside the article; Ask the assistant opens the same chat empty; Distill opens the distilled page; Extract opens the extract page.
- Summary lives in the side panel: one rail button, a depth control with three levels (layman / intermediate / professional), one stored summary per depth.
- The salience toggle gave its top-right spot to the Distill and Extract buttons; the SALIENCE derivation stays in the pipeline without a reader control.
- Context tab in the workspace header: one Background field, optional, editable any time. Saves globally or as a per-notebook override. Older purpose/application values merge into it on the next save. No onboarding dialog — nothing blocks reading or upload.
- Keyboard-first: `j/k` navigate pending queue, `Enter` accept, `Backspace` reject, `e` edit, `g` jump to source.
- **Welcome flow (first visit):** on the dashboard of an account with no project yet, a screen fades in — "Welcome to your all-powerful notebook." over the mark covering the whole background — and fades out into the dashboard (`components/works/welcome-flow.tsx`; localStorage keeps it to one showing per account — the stored value is the account's id and `createdAt`, so an account an admin reset is welcomed again). Then the first-steps card explains the functions: start a new project (the directive), add documents, the AI tools, and the ? at the top right of a project. That ? button carries a pulsing dot until the guide is opened once; the guide leads with Distill, then an emphasized Circle & ask section (figures, and handwritten pages where the whole PDF is a figure — lasso highlight included), then one card per selection tool, then the side panel. The /signin backdrop carries the same mark, dimmed, covering the page's top-left quadrant.

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
- **Stop:** Ask streams into the card; the Ask button becomes Stop while it runs and keeps whatever has streamed in so far — the read simply stops, the request aborts server-side too.
- **Web access:** the Web toggle beside the scopes (on by default, remembered in the browser) lets Ask search the web through Moonshot's official web-search tool (`moonshot/web-search:latest` on the Formula API: a standard `web_search` function tool the model calls, run by `lib/kimi.ts`; at most five searches per answer; `web: true` on `/api/assistant`). The material stays the first source: the prompt has the model answer from the project, then verify the factual claims against outside sources and add what the project lacks, cite every web source as a markdown link at the point it supports, say plainly when the web contradicts the project, and end with a Web sources list. The search result reaches the model alone (Moonshot returns it encrypted), so the links the model writes are the sources on screen; an outside link opens in a new tab. Never a web result presented as the project's own. Each search records $0.005 on top of the tokens in usage telemetry. The tasks (contradictions, gaps, unsourced), the selection chat, and the media pane's assistant stay off the web.
- **Usage telemetry:** every model call records tokens and estimated cost to `UsageEvent` (list prices at call time; fire-and-forget, never blocking a response). The admin usage page (`/admin/usage`) aggregates per function, model, account, and day.
- **Admin digest page** (`/admin/digest`, admin-gated like the feedback inbox): the store per user — every corpus → every document → its annotations, notes, and distillations — with counts, built time, forced Rebuild, and the exact text each scope sends (`/api/admin/digest`). Each account is one scroller: its header stays pinned while its corpora scroll under it, and the page scrolls from account to account.
- **Admin accounts page** (`/admin/accounts`, admin-gated): every account with the projects, documents, and notes it holds, and Reset account (`lib/account-reset.ts`, `POST /api/admin/accounts/reset`, the account's email typed to confirm) — deletes the account's projects with everything under them, the documents only its projects held (one still attached to another account's project, or cited by a note in one, stays in the library), its profile, digests, sessions, memberships on shared projects, pending email links, Drive link (revoked), picture, symbol, color, and premium flag; keeps the account row (email, name, password), its usage telemetry, and its work inside other accounts' projects; stamps `createdAt` anew, so the account starts at onboarding like a new account. Sign-in off: the local reader is the one account, and the same data reset applies.
- **Click telemetry:** every click on a reader control records one `ClickEvent` row: the surface the control lives on (top bar, sidebar, AI toolbar, article menu, reader, notes tray — `lib/clicks.ts`) and the control's id. Controls carry `data-track`; regions carry `data-track-surface`; a control outside a marked region records nothing. An id carries the control's type or source after a colon where it has one: `highlight:<color>`, `annotation-recolor:<color>`, `page-highlight:<color>`, `assistant-ask:<scope>`, `assistant-task:<task>`, `assistant-recommended:<depth>`, `ask:<question>`, `note-format:<kind>`. The client (`components/click-tracker.tsx`, mounted by the workspace) batches clicks and posts them to `POST /api/clicks` fire-and-forget, so telemetry never blocks the reader. The admin clicks page (`/admin/clicks`) reports the reader's functions in three groups — the AI tools, the notes functions, and the annotations made; `lib/clicks.ts` names the controls of each — as uses per day by group, every function per group, a table of every function, and uses per account by group. General controls (navigation, dialogs, video playback, the article edit toolbar, closes and cancels) record but stay off the page. The daily cron deletes rows older than 180 days.

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
- URL replica fidelity (`lib/parse/url.ts`, parser version 16): the walk reads the page's baked layout (`data-unitos-hidden`, `data-align`, `data-style`, `data-font-size`, `data-font`, `data-box`, from `lib/parse/figure-style.ts`) and works without it. A box (`data-box`) is an element the page paints its own background under, different from the background behind it, or sets in its own font while it holds a chart; text in a box that holds a figure's media is the figure's words (a chart's title, legend, axis labels, source line), never its caption — a caption sits outside the box, on the page's background, unless it is labeled ("Figure N", or a `figcaption`), which is a caption wherever it sits (`lib/parse/figures.ts`). The figure's words keep the page's look: the bake writes their font size, weight, style, color, transform, spacing, and alignment as inline style, a legend swatch keeps its size, color, corner, and gap, and the box carries its background, padding, and corner (`data-box-style`); in the figure's html a wrapper holding only inline content becomes a `<p>` (a legend of spans stays one row), the box stays as the one `<div>` a figure keeps, with the box's look inline, and the sanitizer keeps exactly those properties with plain values (`lib/parse/sanitize.ts`; `.reader-figure figure > div` in globals.css stacks the box's content at the column's width). A caption inside the box keeps the reader's caption look. An element hidden at a desktop viewport is pruned. A contents list — a `nav` labeled contents, or a list whose links all point at the page's own fragments — stays: its header row is a `label` paragraph ("Contents · 5 sections"), its entries one LIST block with html `<ol class="contents">`, one entry per line (`<label> <title>`, nested entries indented two spaces), the label a `code` style span and the title a link span whose `targetFragment` becomes `targetOrder` in `resolveContentsLinks` right before the blocks are saved (after the model passes; fragments never reach the database). A contents target set as a paragraph (`<p id>`) becomes a HEADING at 1 + the entry's depth; tag levels shift so the document's shallowest level (the banner aside) is 1; with sizes baked in, a short bold or larger paragraph with no sentence end becomes a heading placed into the ladder of the document's heading sizes, and a large short statement is a `display` line. Text blocks carry html layout tokens the reader renders: `kicker` (a short label line first, before the banner heading), `meta` (≥ 2 sibling rows of "Label: value" joined with " · "), `label`, `contents`, `display`, `quote` (from a blockquote), `caption` (a figure caption standing as a paragraph), `center` and `right`. Bold, italic, underline, and code runs (`strong`/`b`, `em`/`i`/`var`, `u`/`ins`, `code`/`kbd`/`samp`/`tt`, and `data-style`) become style spans on PARAGRAPH, LIST, and HEADING blocks, measured on the final block text; a span over a whole heading drops. The page's font family travels as `ParsedDocument.font` into `Document.font` on creation only. A newsletter section (a form's wrapper with ≤ 300 chars naming the signup) and a trailing run of ≥ 6 short paragraphs after the last section's content (the footer's link columns) drop mechanically. Progress adds a `layout` stage, and the `save` stage carries the final figure check as JSON (`figures`, `captionsWithoutFigure`).
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
- On-ingest glossary extraction (terms/acronyms/symbols); hover definitions in reader. Definitions are written in the reader's language (§4): every ingest captures it before its after() scan and passes it to `buildGlossary`. The entry stores one definition per language — `Document.glossary`: `[{term, definition, blockIds[], lang, definitions: {en?, zh?}}]`, `lang` the language `definition` was written in, `definitions[lang]` mirroring it; an entry saved before `lang` was stored is unknown-language. A document opened in another language asks `POST /api/documents/[documentId]/glossary {lang}` (editor) for that language's definitions once per browser session; one model call over the term list writes them, and the hover shows them when they land. Until then the term still underlines and its hover shows only "Click for tools". The term itself is never translated: it reads as the document writes it.
- Export notebook → Markdown and .docx with footnotes resolving to `documentTitle, blockId` citations.

---

## 9. Non-Goals (v1)

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

## 11. Video and audio

A video is a document. Its transcript is its blocks; a video anchor is a time range instead of a text span. Everything downstream — notes, source chips, pending/accept, the derivation pipeline — is unchanged. The video file is never modified; annotations are a layer on top of the player.

An audio file is the same document with no frame. Upload takes mp3, m4a, aac, wav, flac, or ogg (sniffed by magic bytes like video; `VideoAsset.mimeType` audio/* marks the document audio); the pane renders the audio player — a compact stage with a waveform decoration, timed comments fading in over it, no fullscreen — and drops everything frame-bound: no circling (the annotate button opens the composer on the current moment), no Visual thumbnails (cards carry time and text), no frame capture on Explain. Transcript, Find, the assistant, time anchors, and the derivation pipeline are identical.

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
- Upload video or audio takes an mp4/webm/ogg/mov or mp3/m4a/aac/wav/flac/ogg file, or a YouTube link. A file becomes kind `UPLOAD` (an audio/* sniff makes it an audio document); a YouTube link becomes kind `YOUTUBE` (title from oEmbed, deduped by `youtubeId`, no bytes stored). A YouTube link pasted into Add URL lands in the same path.
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
- Transcript: its own scroll box under Visual. Click a line to seek; the current line highlights and follows playback without moving the page. A transcript line is an anchor like a circled spot: hovering one offers Comment and Explain on that line's time range, and a line covered by an annotation is underlined and opens it. The lines are the reader's blocks: the video pane hosts the reader's interaction layer (`ReaderInteractions` with `transcript`, reader-interactions.tsx; the lines render through `TranscriptBody`, reader.tsx) with the player and the video tools above the lines, so selecting transcript text opens the article's text toolbar — Assistant, Explain, Simplify, Match-it, Comment, Link across texts, highlight colors, Add to notes, Read aloud — and marks, links, and tool cards work on the lines through the same code path. No edit mode, no article menu, no Distill or Extract on a transcript.
- On open, a caption floats over the player for a few seconds naming the tools — circle to comment, search the video, click a transcript line to seek — then fades.

### Transcription

Transcription starts on its own the moment a video or audio is added — the transcript is the point. The pane never shows a Transcribe button: it shows Transcribing…, then the lines; Retry and Paste transcript appear only when every rung failed, and Transcribe again redoes a finished transcript. The job runs a provider ladder ordered by source, cleans the lines, writes them as TRANSCRIPT blocks, and stores which rung succeeded (`POST /api/documents/[documentId]/transcribe` runs the same job for retries):

- **YouTube video:** caption tracks from the player API, keyless — the transcript YouTube itself shows, so it goes first: exact, free, and seconds to fetch. Clients in the order that answers a datacenter IP (ANDROID, then IOS, then ANDROID_VR — the app clients still answer where the web clients demand a bot check), then the watch page scrape. A client's track list is read the way YouTube picks the panel's default: the default track when the response names one, then a human track in the spoken language, then the auto-generated track, then the first human track (a translation). Cues fetch as json3 with the track URL's own `fmt` replaced (a track URL can carry `fmt=srv3`, and a second `fmt` appended is ignored), srv3 XML as the second format, up to three tracks per client (`lib/video/captions.ts`) → the same captions read by a real browser, where one is configured (`lib/video/browser-transcript.ts`; `BROWSER_WS_ENDPOINT`, the CDP websocket of a browser service, or `CHROMIUM_PATH`, a Chromium binary on the server, with `CHROMIUM_ARGS` for flags; the browser opens the watch page, fetches the page's own caption track from inside the page, then clicks Show transcript and reads the panel. YouTube answers a browser on a datacenter IP with the same captcha it gives a plain fetch, so on Vercel the rung needs the service; on a desktop or a self-hosted server a local Chromium is enough) → Gemini reads the video by URL (`GEMINI_API_KEY`; `gemini-3.7-flash`, then the `gemini-flash-latest` alias, so a retired model can never take the feature down; Google's own network, so YouTube's per-IP bot checks cannot touch it) → the audio-only stream downloads through the same app clients and takes the upload ladder below (`lib/video/youtube-audio.ts`; the best stream under the upload cap — 25 MB with a Whisper key, 14 MB with Gemini alone — and a video whose smallest stream is over the cap says so). YouTube bot-checks a server IP that asks too often, and every server-side rung shares that IP, so the ladder ends with the one rung that never depends on it: the reader pastes the transcript (below).

A video costs Gemini about 100 tokens per second, so anything past roughly two hours overruns the 1M context window in one call. Past 700k tokens the video transcribes in 30-minute windows: `countTokens` on the whole video and on one known minute gives the video's own token rate, and the two divide into a duration. Windows run together (six at a time, four hours maximum) so the wall clock is about one window rather than their sum, timestamps inside a window are clip-relative and get shifted back onto the video's clock, and one dead window leaves a gap instead of losing the transcript.
- **Uploaded video or audio:** Groq Whisper (`GROQ_API_KEY`; whisper-large-v3-turbo, $0.04/hour with a free tier — the best transcription quality per dollar, so it goes first) → OpenAI Whisper (`OPENAI_API_KEY`) → Gemini, inline when the bytes fit a request (≤14 MB) and through **Gemini's file store** when they do not. The Whisper rungs cap an upload at 25 MB; an MP3 past the cap splits at frame boundaries (lib/video/mp3.ts) into under-cap chunks that transcribe a few at a time and shift back onto the audio's clock — hour-plus podcasts work; other containers cannot be cut safely and keep that cap.

  An hour of video is far past every one of those caps, so the file store is what carries it (`lib/video/gemini-files.ts`): Google's resumable upload puts the bytes there — 2 GB allowed, so the app's own 200 MB upload ceiling is the real cap — and the file is then referred to by its URI exactly as a YouTube URL is, which puts uploads on the same long-context path, windows and all (`geminiWindowed` serves both; only video can be asked for by time range, and an audio file long enough to need windows is past the upload ceiling anyway). A stored file lives 48 hours and its URI is kept on `VideoAsset.geminiFileUri`, so a retry inside that window skips the upload — sending an hour of media is the slow part of a run, and a run that lost the function's clock should not repeat it. The upload goes through the app's proxy-aware fetch like every other outbound call. Without `GEMINI_API_KEY` the 25 MB cap still ends it, and the reason says which key would lift it.

Transcription runs at low media resolution throughout — it needs the audio, not the pixels.

**Cleanup:** before the blocks are written, every transcript (all sources) is cleaned line by line — filler words (um, uh, er), stutters, immediate word repeats, and false starts removed; punctuation and casing fixed — so the transcript reads like written prose. Gemini cleans when a key is set (lib/video/tidy.ts; batch calls, same line count in and out, never a paraphrase); a deterministic rules pass is the keyless fallback. Time ranges never change; a line cleaned down to nothing drops.

Each rung fails with a plain reason; the ladder tries the next and reports every reason when all fail. `VideoAsset.transcriptStatus`: NONE → PENDING → READY | FAILED with the reason stored. Upload and playback work without any key; the transcript pane offers Transcribe and states plainly what is missing.

The ladder has a time budget: 240 seconds of the 300-second function, and a rung does not start with under 20 seconds left, so a slow rung cannot push the next past the function's end.

**Pasted transcript:** when every rung failed, the pane offers Paste transcript beside Retry. The reader opens the video on YouTube, clicks ...more, clicks Show transcript, copies the lines, and pastes them; `POST /api/documents/[documentId]/transcript` (`{text}`) stores them. `lib/video/paste.ts` reads the panel's copy format (a time on one line, its words on the next), a time and its words on one line, and SRT and WebVTT cues; a segment without its own end runs to the next segment's start; text with no times is refused with the reason. The pasted lines take the same cleanup and block writes as a transcribed transcript.

**The transcript pane is article-shaped:** lines flow into first-line-indented paragraphs, split at speech gaps (or at length once a sentence ends), each paragraph opening with a seekable time chip. A line is still the unit: click to seek, hover for Comment / Explain / Open note, follow-along highlight during playback.

### Video derivations (same pipeline, §4)

- The cached document prefix tags timed blocks: `[block <id>] (TRANSCRIPT 12.4s–18.2s)`. One cache entry per video document, like every document.
- `FIND` — the video content reader. `{type: FIND, query}` → JSON `{matches: [{blockIds, explanation}]}`; the server resolves each match's blocks to a time range. Renders as cards with seek chips. "Add to notes" lands a `PENDING` note with a time source — never persisted without the user.
- `ASK` — a question about a range. Ask about a range in the tool bar (open to viewers too: it persists nothing) opens a card with a start and an end time — the current moment and five minutes on, or the end — and a question; `{type: ASK, question, video: {startTime, endTime}}` answers from the transcript lines inside the range (repeated in the prompt with their times; the whole timed transcript stays the cached prefix, so the answer can say where else the recording deals with it, and that it is outside the range). The answer streams as text into the card; "Add to notes" lands it as a `PENDING` note whose time source is the range. Needs the transcript.
- `EXPLAIN` with a video anchor `{startTime, endTime, region?}`: the client captures the frame at that moment — from the file for an upload, from the storyboard sheets for a YouTube video — cropped to the drawn loop, and attaches it; the model reads the frame plus the timed transcript. A storyboard frame is small, so Gemini also watches the same clip at full resolution and its description rides along: two independent looks that corroborate each other, with the prompt telling the model to trust the image, never claim what it cannot see, and say so when the frame is too small to be sure. Output persists as an annotation with the same time source, so explained moments join Visual. Audio has no frame; Explain works from the transcript alone.
- `FORMALIZE` — the transcript rewritten, the media pane's two assistant skills. format `article`: a formal article for publishing the ideas — title, section headings, clean written prose, nothing invented — stored as `{title, markdown}` on `NotebookDocument.formalized` and rendered under the transcript with Copy markdown and Regenerate (overwrites, like summaries). format `notes`: personal bullet-point notes — topics in transcript order, each `{heading, bullets, blockIds}` — landing as one `PENDING` note per topic with a time source resolved from its blocks (§1: nothing enters notes without the user). Runs behind the DISTILL heartbeat stream; needs the transcript.

### The assistant on the media pane

An Assistant button in the tool bar opens a chat card under it (editor-gated, document scope — the model reads the whole timed transcript through `/api/assistant/act`). Facing video and audio content the card carries the two FORMALIZE skills as suggestion chips — "Formalize into an article" and "Formalize into bullet-point notes" — disabled until the transcript lands; typed questions answer in the chat. The chat executes no plan actions on media documents yet and says so when a plan proposes any. Send becomes Stop while a turn is running (closing the card stops it too, same as the reader's chat) — the sent message stays, no reply lands.

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

---

## 12. Community

A corpus can be shared (Google Docs pattern). The owner (Notebook.userId) adds collaborators by email with a role; accounts key on the email (§2), so an invite works before the account exists. Everything inside the corpus — documents, notes, annotations, distillations, extractions, edits — is the shared surface; the derivation pipeline (§4) is unchanged.

### Data model additions

```prisma
model NotebookCollaborator {
  id         String     @id @default(cuid())
  notebookId String
  notebook   Notebook   @relation(fields: [notebookId], references: [id], onDelete: Cascade)
  email      String     // lowercase; invite works before the account exists
  role       CollabRole @default(EDITOR)
  addedById  String?
  createdAt  DateTime   @default(now())
  @@unique([notebookId, email])
}

enum CollabRole { EDITOR VIEWER }

model NotebookPresence {
  id         String   @id @default(cuid())
  notebookId String
  notebook   Notebook @relation(fields: [notebookId], references: [id], onDelete: Cascade)
  userId     String
  documentId String?  // the open document; null = the notes full page
  lastSeenAt DateTime @default(now())
  @@unique([notebookId, userId])
}
```

Plus columns: `Notebook.rev Int` (change counter), `Note.createdById String?`, `BlockEdit.userId String?`, `User.symbol String` and `User.color String` (the badge).

### Roles

| Role | Held by | Can |
|---|---|---|
| owner | Notebook.userId | everything, plus delete the corpus and manage sharing |
| editor | CollabRole EDITOR | read and write: notes, sections, annotations, derivations, block edits, links, documents |
| viewer | CollabRole VIEWER | read only; FIND (persists nothing) is the one derivation open to viewers |

Enforcement is server-side in `lib/collab.ts`: `notebookAccess(notebookId, min)` for corpus routes, `documentAccess(documentId, min)` for document routes (best role across the corpora the document is attached to), `sectionAccess`/`noteAccess` resolving objects to their corpus. A non-member answers 404 (existence undisclosed); a member below the required role answers 403. The UI mirrors the same rule: viewers get no selection popover, no edit mode, no assistant, no write buttons, and a "Viewing only" badge.

### Attribution

Every write is labeled with its author: `Note.createdById` (manual notes, highlights, comments, EXPLAIN/SIMPLIFY annotations, assistant output), `BlockEdit.userId` (text edits, formats, styles, links, block add/remove), `createdById` inside stored distillations, extractions, and keypoints. The author renders as a person badge — picture, or symbol on color (`lib/person.ts`; defaults: first letter of the name, color hashed from the account id) — on note cards, annotation cards, the Edits panel, the distilled page, the extract page, and the match card. Labels render only on shared corpora; solo work stays unlabeled.

### Live sync

Every write bumps `Notebook.rev` (document writes bump every corpus the document is attached to). Open workspaces poll `GET /api/notebooks/[id]/sync` every 4 seconds: the call stamps the caller's `NotebookPresence` row and answers `{rev, people}` — who else has the corpus open (25-second window). When the rev moves, the client refreshes the page — deferred while an input, textarea, or editable block has focus or a selection is open, so typing is never clobbered. Presence renders as badges in the workspace header.

### Replies

Every note (annotations included — a highlight, comment, explanation, or assistant conversation is a note), every edit in the Edits panel, and every link carries a discussion: `Reply` rows (`noteId`, `blockEditId`, or `docLinkId`; author; content), flat, oldest first. Collaborators comment on each other's work there. Editors reply; viewers read; a reply deletes by its author or the owner. Open replies always render under their card; any editor resolves a reply (`resolvedById`; `PATCH /api/replies/[replyId]`), and resolved ones collapse behind a count. The Reply affordance appears once the corpus is shared. `POST /api/replies`, `DELETE /api/replies/[replyId]`; replies bump the rev like every write.

### Attribution rule

The author label marks the other person's work: your own notes, annotations, and edits render default, unlabeled. Every action still carries its author — the History panel lists everyone's, your own included.

### History

The History panel (the clock-rewind button beside Share) is the corpus's whole record: every edit and every deletion, newest first, each entry signed. It merges `BlockEdit` rows across the attached documents (text edits, formats, styles, links, paragraph add/remove) with `NotebookEvent` rows for what BlockEdit cannot see — note removals (content snapshot), section removals, document detachments — recorded at delete time with the deleter's id. A person's badge in the panel filters the feed to their actions. The rail's per-document Edits tab keeps the pencil icon; the clock-rewind icon is the corpus history's.

### Stale tabs

Cookies are per browser, not per tab: signing out or switching accounts in one tab changes every tab's cookies. Sign-in therefore also sets a readable account cookie (`dissect-account`, the account id — grants nothing; the session cookie alone authorizes). Account-scoped pages mount an account guard that latches the account the page was rendered for, watches the cookie (on focus, on visibility, every 5 seconds), confirms a mismatch against `GET /api/auth/account` (which also re-stamps the cookie, healing sessions from before it existed), and freezes the tab with an account-changed notice instead of silently becoming the new account. Live sync stops polling on mismatch so a stale tab never stamps presence or refreshes as someone else. `api()` sends the tab's rendered account as a header; the middleware answers 409 when it no longer matches the cookie, so a stale tab's write can never land as the wrong account.

### Sharing surfaces

- Share dialog in the workspace header: the owner adds by email with a role, re-roles, removes; a collaborator sees the list and can leave. `GET/POST/DELETE /api/notebooks/[id]/collaborators`.
- The dashboard shows "Shared with you": the corpora shared with the account, with the owner's name and the role. Editors can rename from the card menu; only Leave replaces Delete.
- The profile (Settings): picture (uploaded, resized client-side to a small JPEG data URL, stored on `User.picture`), name, symbol, color, and the one Background field (`PUT /api/account`, `PUT /api/profile`). Sign-in fills name and picture only when empty — it never overwrites what the person set. Service/env status lives on `/admin`, not in Settings. Settings also shows Connections — the services connected to the account and what each reaches: sign-in (the email, and whether a password is set) and Google Drive (§14: link, what the stored grant reaches, Link again for all files, Unlink) — and Your data: every stored field and count about the account, read-only (`lib/account-data.ts`: email, name, picture, password, created and last-active dates, live sessions, background, projects, documents, notes, digests, clicks, AI calls, feedback, notifications, the Drive grant, what stays in the browser, and the hosting provider's logs), with a link to the Privacy Policy and the deletion contact.

---

## 13. Connections

Every piece of content in a corpus should connect. Two mechanisms:

### Recommended links

When a document joins a corpus — upload, URL, YouTube (after its transcript lands), or attach from the library — a scan (`lib/connect.ts`, prompt in `/lib/prompts/connect.ts`, model `CONNECT_MODEL`) reads it against the corpus's other documents for shared concepts, claims, quotes, and keywords, video transcripts included. The scan reads the content only — the article text or the transcript; document titles are never sent to the model, so two documents with similar titles but unrelated content do not connect. Each hit becomes a `DocLink` with `recommended: true`, a `reason`, and both quotes resolved verbatim against the real blocks (unresolvable output drops, SPEC.md §4 discipline). At most 8 per scan; duplicates skip; the scan runs `after()` the response like the glossary, and "Recommend links" in the document menu runs it on demand (`POST /api/documents/[documentId]/connect`).

A recommended link paints nowhere until accepted — the user approves everything (§1). It lives in the Graph, under its Recommended links list (folded beside the canvas; every recommended link of the project, newest first): the reason, both quotes, the two documents, the author badge, a reply thread, and Accept / Dismiss. The Annotations panel lists accepted links only. Accept clears `recommended`, paints the link, and records a LINK_ADD by its accepter; Dismiss deletes it without a history entry.

### Corpus extraction

Extract's second scope (code: corpus DISTILL): the reader asks the whole corpus one question (`POST /api/derive` with `type: DISTILL, scope: "corpus"`, no documentId). The corpus rides as one cacheable system message — every document rendered `[document <id>] "title"` then block lines, later documents cut whole with a declared marker past the budget — and the model returns the same DISTILL quote contract; the server maps each quote to its document by block id (block ids are unique across the corpus) and stores the distillation on `Notebook.distillations`, newest first, capped at 20. The corpus extract page (Distill tab → "Extract from the project") renders each quote under its document's title chip; clicking a quote opens that document; Add to notes lands the quote `PENDING` with a source in its own document — one distillation, sources across the corpus. Delete goes through `PATCH /api/notebooks/[id]` `removeDistillationId`. Quotes heal at render and orphan visibly (§5).

### Graph

The Graph (rail button; full-screen overlay; `reactflow`, the release-edu tree pattern) draws the corpus as a connected whole: every attached document a node, every linked pair one curve. The more links between two documents, the thicker and deeper the curve: width and clay depth both scale with the count — one link a fine light line, eight or more the widest and darkest — and the tone is deepest at the curve's middle. Hovering a curve, or clicking it to pin, opens the pair's link list at the curve: every link's description (the reader's, or the AI's reason for a recommended link) and both quotes; a link opens the reader on that link (`?link=`); a recommended one is marked. A pair held together only by recommended links draws dashed until one is accepted — the Recommended links list beside the canvas is where that happens. Nodes drag; click one to open the document; pan and zoom Obsidian-style. Node, edge, and recommended-link data come from the workspace page (`GraphNode`, `GraphEdge`, `RecommendedLinkView` in `lib/types.ts`); reactflow lazy-loads when the overlay opens.

---

## 14. Google Drive upload

A new way to add a document: pick it from Google Drive instead of the local disk. The reader's Google account is already the common case (§2's auth), so Drive access rides the same OAuth client.

- **Grant:** the client asks for a Drive token with Google Identity Services and opens the Google Picker with it. `GOOGLE_DRIVE_ACCESS` picks the scope every grant asks for (`lib/drive/types.ts`): `all` (default) is `drive.readonly` — read access to every file the account can read, so any picked file and any pasted Drive link imports. Google calls this scope restricted: the deployer lists it on the OAuth consent screen's Data access page, and until Google verifies the app (brand verification plus a CASA security assessment) the consent shows Google's unverified-app warning, with a lifetime cap of 100 users who saw it; a consent screen still in Testing status grants it to its test users only and expires the grant after seven days (the mint then reports it revoked and the link clears). `picked` is `drive.file` — the files the reader picks in the Google Picker only, non-sensitive, no verification. Neither scope writes to Drive. The picker always carries the Cloud project number (`setAppId`, the numeric prefix of the OAuth client id): without it a `drive.file` grant never reaches the picked file and Drive answers 404 for every pick. A per-visit token lives in the browser only, for one picking session; nothing about that grant is written to the database. `GOOGLE_CLIENT_ID` (§2) is reused; the deployer additionally lists this app's origin under that client's "Authorized JavaScript origins" in the Google Cloud console. `GOOGLE_PICKER_API_KEY` (optional, a Picker-only API key) improves file previews in the picker; the feature works with `GOOGLE_CLIENT_ID` alone. `GOOGLE_CLIENT_ID` unset = the option stays hidden, the same DUAL MODE as sign-in (§2).
- **Link Google Drive (the durable grant):** with Google sign-in configured, an account can link Google Drive once — the same hand-rolled code flow as sign-in (`GET /api/drive/link` → consent → `/api/auth/callback`, the one redirect URI registered on the OAuth client — Google rejects any other with redirect_uri_mismatch — where the Drive state cookie tells the link apart from a sign-in), asking the configured scope with offline access; the refresh token and the scope Google granted land on `User.driveRefreshToken` and `User.driveScope` (a grant stored before the scope was counts as picked files only). On an account that can link but has not, Add from Google Drive links first (full-page consent, back to the workspace with `?drive=linked`, then the picker opens) instead of asking the browser for a per-visit token. Linked, the picker gets its token from `POST /api/drive/token` (minted server-side; a revoked grant clears itself there) — no consent popup per visit — and a **pasted Drive or Docs link** imports server-side through the same grant: `parseDriveFileId` recognizes the link, `/api/drive/import` takes a bare `fileId`, reads name and mimeType from Drive metadata, and mints the token itself (an all-files grant reaches any file the account can read; a picked-files grant reaches picked files only, and Drive's refusal reports as that — pick it from the Drive tab, or link again for all files — never as "private or removed"). Unlinked, a pasted Drive link answers with a pointer to the Drive tab, never a parse failure. Link lives in Settings under Connections (the Google Drive row: what the stored grant reaches, Link again for all files when it reaches picked files only while the deployment asks for all, Unlink = revoke + clear); the Drive tab says the first pick links and what the grant reaches. The local reader (sign-in off) has no account row and keeps the per-visit grant.
- **One ingest path, three sources:** a picked file is sniffed by mime type (`lib/drive/types.ts`) into the same handlers a local upload already uses — Drive is a new source, never a new parser (§4's discipline extended to ingest):
  - Google Docs, Sheets, Slides, and Drawings export to PDF through Drive's own conversion (`files.export`, capped at 10 MB by Drive), then ingest exactly like an uploaded PDF.
  - A PDF already in Drive downloads (`files.get?alt=media`) and ingests exactly like an uploaded PDF — Import PDF judgment, the pages directive, and conversion included (§16).
  - A video or audio file downloads the same way and ingests exactly like a direct video/audio upload (§11) — same chunked storage, same transcription.
  - Anything else (images, Forms, raw .docx/.xlsx/.pptx, …) is declined with a plain reason; the picker's own mime filter keeps most of these from being selected at all.
- **Provenance and dedupe:** a picked video or audio file's Drive download URL (no token in it) becomes the document's `sourceUrl`, so re-picking the same file dedupes like a re-added web link (§11's own dedupe). A picked PDF, Doc, Sheet, or Slide dedupes by the downloaded bytes' hash instead, the same as any other PDF upload — Drive gives no stable pre-download key for those.
- **Surface:** "Add from Google Drive" is a tab in the add-document dialog, beside Upload PDF and Upload video. Picking hands the picks to the upload assistant box (§15) like every add — instructions and the PDF directives ride each `/api/drive/import` request, one per pick; only the sandbox review has nothing to read (the server fetches the file at import time). Drive adds need the server and never queue offline.

---

## 15. The upload assistant

Every add — the add-document dialog's Add URL, Upload PDF or image, Upload video or audio, and Add from Google Drive tabs (in that order; the dialog opens on Add URL), and drag-and-drop (PDFs, images, video and audio files) — opens the upload assistant box (`components/reader/upload-assistant.tsx`) before anything is saved. The box states the content type's nuances (formats, caps, what the parse can and cannot read), takes upload instructions, and drives the add itself, one streamed request per page or file, progress in place. While an add runs the box can be hidden — ✕, Escape, or a click outside — and the add runs on: the document bar shows a small running pill (a spinner and "Adding {title}…") that brings the box back, and the box comes back on its own when an add ends with something to read (a failure, a lost figure). Every add ends with a finishing step before the document opens, so it opens complete — text, figures, links, and glossary in place instead of filling in after the open: `GET /api/documents/{id}/finish` says what is left (`scans`: "client" for a text document, whose glossary and recommended-links scans the box runs now through `POST /api/documents/{id}/glossary` and `POST /api/documents/{id}/connect` — the ingest request carried `scans: "client"`, so the server skipped its own after() scans; "server" when a job the server owns runs them after its own work, conversion or transcription; and `images`, every visual the reader will request — PDF figure and page renders, remote figures in figure and table html), then the box loads every image once into the browser's cache (`lib/finish.ts`: six at a time, 30 s each, three minutes in all), and only then closes and opens the document. An add that has run 20 s opens its first document before the finishing step is done, when the document reads well — saved, with at least 90% of its captions carrying their figure (the save stage's figure check): the box hides, the running pill reads "Finishing {title}…" while the glossary, links, and figures load on, clicking it shows the progress, and the close that ends the add refreshes the open document instead of opening it again; a shorter add opens complete. The progress card shows the add's elapsed time beside its step count. Attaching from the library is not an upload and opens no box; a pasted Drive link on a linked account imports directly (§14); the reader's media-figure toast and re-parse keep the floating progress card.

**Review.** For an article URL the assistant first reads the page in a private sandbox — a server-side fetch (`lib/upload-assistant.ts`, `POST /api/uploads/review`), parsed exactly as ingest would parse it, streaming fetch → extract → review stages. The review reports what the page is (`article` / `index` / `other`), a summary, up to 6 recommendations for adding it, and the page facts (page estimate at 3,000 chars per page, block count). Linked same-site pages are harvested from the raw DOM before any pruning (a series' table of contents often lives in navigation), listed to the model by number, and resolved back against the real list — a page the model invented drops (§4 discipline). A keyless or failed model call degrades to the parsed facts; review failure never blocks adding. Review again re-runs the review with the current instructions.

**Figure check.** Before any model call the review audits the parsed blocks against the figures the page describes (`lib/parse/figure-audit.ts`, deterministic): a block that opens like a caption ("Figure 4", "Table 2", "图 3") with no figure beside it is a figure the parse did not load. The counts — figures, captions, captions without a figure, figures without a caption — travel with the review as facts and survive a failed model call. The model gets the same facts and must report every caption without a figure in its advice, naming the figure label; the box lists each one under the page facts ("No figure loaded for Figure 4") and says "Every caption has its figure." when the check passes. Review again re-runs the review and so re-checks. Ingest carries the final counts: the progress card's extract and save steps show them, and the box's done line states the verification ("7 figures loaded · every caption has its figure"); a caption without a figure keeps the box open until Close. A page that draws its figures with scripts (an empty chart svg in the static HTML) needs a browser to render before the parse (`lib/parse/render-page.ts`; `BROWSER_WS_ENDPOINT` or `CHROMIUM_PATH`, the §11 browser); without one the box says so and the model says the figure needs a browser render. A re-parse carries the same check on its save stage (`scriptedFigures` beside the counts), and the document bar shows one line after the automatic re-parse when a caption is left without its figure — naming the figure, and the browser to configure when scripts draw it. The browser render reports what it did (`RenderReport` in `lib/parse/render-page.ts`: whether one ran, and why it did not deliver — the connection refused, the time up, the chart capture failed, a loop not found in the time sampled): the report rides with the save stage as `renderError`, in the document bar's line, and on the document as `Document.figureRenderAt` and `figureRenderError`. In the reader, every caption left without its figure carries the figure's place above it (`components/reader/figure-capture.tsx`): while a render runs, a small moving picture and "Unitos is moving Figure 4 over…" (the document bar shows the same pill); when it failed, why, with Try again; when no browser is configured, the variable to set. Where a browser is configured and no render has run for the document, opening it runs one — the same silent re-parse the parser-version upgrade runs, once per document until Try again — so a browser configured after the add brings the figures over on the next open. A Browserless endpoint that sets no `timeout` gets one of 300 s (`lib/browser.ts`): the service ends a session at 60 s otherwise, before a chart capture is done.

**Pages.** When the review finds linked pages that are parts of the same work (a multi-part essay, chapters), the box comes back asking which pages to add: a checkbox list in reading order, recommended parts pre-checked, "This page" included when its own text is worth adding. The box then adds the picked pages one request at a time, `Page i of n` progress, one failure never killing the batch.

**Split.** Very long content (estimate ≥ 40 pages always; the model may propose from 15) raises the split question before any content is saved: split into N documents at its headings, or keep one document. A split add partitions blocks at the shallowest repeating heading level (`lib/parse/split.ts`), delivers exactly the promised part count (smallest parts merge into neighbors), titles parts `{title} — {heading}`, gives each part the references its blocks cite, and stamps `sourceUrl` with `#unitos-part-N`: parts dedupe on re-add and never re-parse (a re-parse would paste the whole page over one part).

**Instructions.** The instructions field rides along with every add. Before anything is saved, the assistant answers each instruction (`/api/uploads/review` with kind alone; one model call): willFollow plus one plain reply — what it will do, or honestly that the upload cannot do it (rewrite, translate, sign in, run scripts, edit figures or the file). An unfollowable instruction stops the first Add so the replies are read; the reader edits or presses Add again. Only the feasible part travels to ingest as blunt imperatives, threaded into the URL core and structure passes and, for a PDF, a structure pass over the parsed blocks — instructions steer selection, typing, and merging, never write text. A PDF check also returns the two PDF directives (§16) — `pages` and `convert` — which travel as typed fields beside the instructions on every PDF add path (`/api/documents` multipart, `/api/uploads/complete`, `/api/drive/import`); every fallback (no key, failed call, no instructions) answers the defaults, so ingest never guesses. The box also carries an explicit PDF import pick — judge automatically (default), pages as they are, pages + convert to text — three pills that set the same two directives without a model call; an explicit pick overrides the directives read out of the instructions. Instructed adds raise the structure pass's drop ceiling (0.4 → 0.9): "keep only the appendix" is a big drop the reader asked for. Video and audio adds have no lever: the assistant says so deterministically, no model call.

Nothing in the box writes before Add; the review and the check are advisory and ingest never depends on them. Model calls use `UPLOAD_MODEL` and record usage under `upload`.

---

## 16. Handwritten documents

Import PDF judges each PDF (AI judgment, not a file-type rule): a computer-text article parses to text blocks as before; rough handwritten notes and drawings become a **handwritten document** — the pages themselves render in the reader, with two tools on them: conversion to text and Circle & ask. This amends §9's "no scanned-PDF OCR": image-only PDFs now land usefully as handwritten documents instead of empty articles.

### Classification (in `ingestPdf`, every PDF path — upload, chunked, Drive)

1. Parse the text layer as always. Article-scale yield (≥250 chars/page) that reads like language = article, no model call. A junk text layer — handwriting apps embed garbled recognition output ("rightrightfracleftleft…"; detected as ≥15% of characters in unbroken 25+ letter-digit runs, URLs excluded) — never counts as article yield.
2. Below that, or on junk, render sample pages (first, middle, last) and ask a vision model (`CLASSIFY_MODEL`, prompt in `/lib/prompts/classify.ts`): typeset computer text → article; handwritten notes, drawings, sketches, or scanned pages whose content the text layer missed or garbled → handwritten.
3. No key or a failed call: junk = handwritten; else yield decides alone (<40 chars/page = handwritten).
4. Upload instructions override the judgment (§15): the instruction check reads two PDF directives out of the instructions — `pages` ("import as pages", "keep the handwriting", "keep it as it is") imports the PDF as a handwritten document with no classification call; `convert: false` ("do not convert", "add nothing I did not write") sets `conversionStatus: OFF`, so conversion never auto-starts and the strip offers **Convert to text** instead. The pages stay exactly as they are — the as-is import format. The upload assistant's PDF import pick sets the same directives directly: pages as they are = `pages: true, convert: false`; pages + convert to text = `pages: true, convert: true`; judge automatically leaves the judgment and the instruction check in force.

The judgment can be wrong, so the document menu carries the escape hatch: "Parse as text article" on a handwritten document, "Open as handwritten pages" on a PDF article (`POST /api/documents/[documentId]/reparse` with `{as}`). Anchors on replaced blocks re-resolve by quote or orphan visibly (§5).

### Data model

- `Document.handwritten Boolean` plus `conversionStatus ConversionStatus` (NONE → PENDING → READY | FAILED, the transcript pattern; OFF = the reader said not to convert — nothing auto-starts, the strip offers Convert to text), `conversionError`, `conversionStartedAt`. The PDF bytes stay in `Document.fileData`.
- `BlockType` gains `PAGE`: one block per PDF page at orders 0…n−1, `Block.page` the 1-based page, `Block.text` "Page N" (so chips, search, and the digest read well). `GET /api/documents/[documentId]/page/[blockId]` renders the page to PNG from the stored bytes — the figure image route's twin.
- A **page anchor** is a `Source` with `region` set (the §11 percent-coordinate shape) on a PAGE block, offsets 0/0, `quotedText` "Page N". It skips the text ladder — pages never change — and orphans only when the PAGE block is gone (shape switch).
- A **PDF figure** is a FIGURE block with `page` set and, when the parse found the figure's place on the page, `region` (the same shape): the text of a vector chart or a display equation, or the blank area above a "Figure N" caption. `GET /api/documents/[documentId]/figure/[blockId]` renders the page and crops it to the region; without a region it serves the whole page, as before. The caption is the block's text and its only DOM text (§5); Explain attaches the same crop.

### Conversion (pages → text blocks)

Conversion starts on its own when a handwritten document is added with `conversionStatus: NONE` — the text is the point; OFF (the reader's "do not convert") starts nothing, and glossary and the recommended-links scan skip too (they would read only "Page N" lines) — and `POST /api/documents/[documentId]/convert` runs the same job for Retry, Convert again, and the OFF strip's Convert to text (`lib/handwritten/convert.ts`, prompt in `/lib/prompts/convert.ts`, model `CONVERT_MODEL`). Pages render to images and transcribe in batches that run together, so the wall clock is about one batch. The model transcribes the author's wording verbatim and imitates the notes' formatting: headings by prominence, lists with the reader's own markers, tables with the invisible cell separators (§5 holds inside converted tables), standalone math as EQUATION TeX, drawings as one-sentence bracketed descriptions, illegible words as "[illegible]" — never a guess. Converted blocks land after the PAGE blocks, each stamped with the page it came from; the reader shows pages first, then the converted text as a normal article — anchors, the selection popover, and every derivation work on it. Convert again deletes only the non-PAGE blocks, so page anchors never move. One failed batch fails the run with its reason — a partial text never lands silently; past 60 pages the cut is declared in a final paragraph. Glossary and the recommended-links scan run after conversion, reading the converted text.

The strip under the pages shows the status: Converting…, the failure reason with Retry, or the Converted text header with Convert again. A PENDING older than 10 minutes is a dead run and may start again.

### Images

An image adds like a PDF — dropped on the page, picked under Upload PDF or image, or queued offline — and imports as one handwritten page. Before ingest the server wraps it into a one-page PDF (`lib/handwritten/image-pdf.ts`; png, jpg, gif, webp, bmp, told apart by their bytes in `lib/handwritten/image.ts`, the one definition the drop filter, the file input, and the upload assistant share) and runs `ingestPdf` with `pages` set: one PAGE block, the page image, Circle & ask, and conversion, exactly as a scanned page — a new source, never a new parser. The stored bytes are the PDF, so dedupe, the page image route, re-parse, and the shape switch read them as they read any PDF. A JPEG embeds as it is (DCTDecode; baseline or progressive, 8-bit, gray or RGB), and its EXIF orientation becomes the page's `/Rotate`, so a phone photo shows upright; any other format, and a JPEG outside that set, decodes through `@napi-rs/canvas` onto a white ground and stores pixel for pixel (Flate) up to 6 MP, as JPEG above that, drawn no larger than 24 MP. The page fits inside Letter and never upscales — the size sets the aspect only; every render scales to its own width. The upload assistant states the image's nuances and offers the pages pick without judge — pages as they are, or pages + convert to text — since an image has no text layer to weigh; an image in a mixed add follows the PDF pick. Google Drive still declines images (§14).

### Images dropped into a note or into the reader

An image dropped on a note goes into the note; an image dropped on a paragraph while the reader is in edit mode goes into the article, as a figure right after that paragraph. Both paths store the bytes once: `POST /api/images` takes the file as the whole body, reads the format from the bytes (never the file name), and answers with the id; `GET /api/images/[imageId]` serves them, cached for a year — the id is a cuid and the bytes never change. A note points at that URL in its markdown (`![name](/api/images/<id>)`, the file's name as the alt so a note read without the image still says what was there); a figure block points at it in its html. `components/use-image-drop.ts` is the one drop handler both surfaces use: it tells a drag carrying files from any other, refuses what the tier does not allow before anything leaves the browser, and stops the drop there — anything that is not an image keeps travelling to the window, where a dropped file is added as a document (§15).

The note editor shows a dropped image as the image, not as its markdown: `![alt](url)` is an atom in the note grammar, like the `[block id]` chip — the whole tag shows as one thing the caret steps over, and reading the document back writes the same markdown (`lib/note-markup.ts`, `lib/note-doc.ts`). A collapsed note's one-line summary reads an image as its alt text: a preview line has no room for a picture and none for a URL.

**Tiers (TIERS.md).** An account whose Premium trial ended drops images up to 5 MB; above that the account needs Unitos Premium. No tier stores an image past 25 MB. The client checks the size before the upload so the refusal is instant, and the route checks it again — the client's check is a courtesy, not the gate.

### Circle & ask

On a page, holding the mouse and dragging draws a freehand loop (the §11 draw, on a page instead of a frame). Releasing opens the Circle & ask card under the loop: a question box, three actions — **Ask** (the typed question), **Explain** (no question), **Comment** — and the four highlight color dots (§6's hues, shared via `components/reader/hues.ts`). A color dot saves a **lasso highlight**: the whole PDF is a figure, and the loop persists as a highlight painted in that color (a `Note` with `color` and a page anchor; typed text rides on it as the note). The guide's Circle & ask section, right after Distill, covers handwritten pages too. Ask and Explain run through the one pipeline (§4): `POST /api/derive` `type: EXPLAIN` with `page: {blockId, region, question?}`; the server renders the page and the circled part from the stored bytes, attaches both (the page carries context, the crop carries the spot, enlarged), and the prompt's page variant answers — transcribe what is there, never guess at illegible handwriting. The answer streams into the card and persists as an annotation with a page anchor; Comment posts to `/api/annotations` `{page}`. Marks paint on the page as SVG loops carrying `data-source-id`, so source chips jump to them and flash them like text marks, and clicking a mark opens its annotation. Viewers see marks, draw nothing.

---

## 17. Unitos Premium: offline work

Offline, the open tab keeps working — reading what is loaded, and for an account with Unitos Premium active (a running trial, a granted Premium, or Ultra; `premiumActive` in `lib/tiers.ts`), the non-AI writes. Writes made offline queue in IndexedDB (`lib/offline/queue.ts`) and sync in order when the browser is back online. AI features (derivations, the assistant, the upload review, conversion) need the server and stay unavailable offline for everyone.

- **The flag:** `User.tier` (PREMIUM | ULTRA) and `User.trialEndsAt` (TIERS.md). A new account is PREMIUM with the trial's end two months out; past that date on PREMIUM the account is expired and this gate closes. The operator grants for good by clearing `trialEndsAt` or setting ULTRA. No billing yet. The single local reader (sign-in off) is ULTRA: there is no account to gate. Settings shows the state under Plan.
- **What queues:** note edits (auto-save included), note create and delete, section renames and reorders, replies, block text edits and deletes, highlights and comments (`/api/annotations`; the optimistic paint stays), and content uploads — a file's bytes queue whole (single-request or chunked replay, same caps as online), a URL queues as the plain ingest request. The upload assistant's review needs the server, so an offline add skips the box and says so.
- **What does not queue:** any write whose response the caller reads (a created section's id, the style route's healed spans), everything AI, and every write on an account whose trial ended — those fail with the plain offline message.
- **Sync:** at-least-once, oldest first, writes before uploads. A record leaves the queue when the server answers; a 4xx drops it with a console warning (stale by then); a network failure stops the drain until the next online event. The workspace header shows the pill: offline with the queued count, then the sync until the queue drains.
- **The boundary:** offline work lives in the open tab. There is no service worker yet — a reload while offline does not load the app; queued records survive the reload and sync on the next online visit.

---

## 18. Notifications

The admin sends notifications to accounts; the admin never has access to an account. `/admin` is the operator's console — feedback, digest, usage, notifications — behind its own password (§2). It holds no session for any account, opens no account, and changes nothing on one: no impersonation, no profile edits, no premium toggle. The notification is the one thing the admin sends into an account, and it flows one way — the recipient reads and dismisses; nothing comes back. Feedback is the reader's one message to the admin, and the admin's reply to it is a notification too (kind `feedback`).

**The feedback pipeline** (`.claude/skills/feedback-pipeline`): a daily Routine reads the inbox (`GET /api/admin/feedback?status=new,seen&take=2000`), clusters the requests that fit this spec, makes each change on a `feedback/<slug>` branch, and opens one pull request per change with the feedback quoted and a review checklist, marking the feedback `seen`. A person reviews and merges; Vercel deploys `main`. The next run finds the merged pull request by its `Feedback-Ids:` line, replies to each sender ("Shipped: …", the admin's reply notification) and marks the feedback `resolved`. The pipeline never pushes to `main`, never merges, never replies before the change is on `main`, and opens at most five pull requests per run. Feedback it cannot place — vague, out of scope, or rejected by a closed pull request — keeps its status for a person.

### Data model additions

```prisma
model Notification {
  id         String   @id @default(cuid())
  kind       String   @default("update") // "update" | "account" | "feedback"
  title      String
  body       String   // markdown
  feedbackId String?  // kind "feedback": the feedback this replies to; SetNull when that feedback goes
  feedback   Feedback? @relation(fields: [feedbackId], references: [id], onDelete: SetNull)
  recipients NotificationRecipient[]
  createdAt  DateTime @default(now())
}

// Feedback gains the account that sent it:
//   userId  String?  // soft reference like Notebook.userId; null = sent signed out, no reply possible
//   replies Notification[]

model NotificationRecipient {
  id             String       @id @default(cuid())
  notificationId String
  notification   Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  userId         String       // soft reference like Notebook.userId; "user-1" = the local reader
  dismissedAt    DateTime?    // null = open on the dashboard
  @@unique([notificationId, userId])
}
```

- **Kinds:** `update` — an update to Unitos (a new function, a changed behavior); `account` — a change made to the account (Unitos Premium turned on, a limit changed); `feedback` — a reply to feedback the account sent (made only by Reply in the feedback inbox, never composed on the notifications page). The kind renders as a chip on both sides.
- **Sending** (`/admin/notifications`, `POST /api/admin/notifications`): kind, title, body, recipients — every account, or accounts chosen from the list (name and email, nothing else; `lib/notifications.ts` is the admin's whole view of accounts). One `Notification` row and one `NotificationRecipient` row per recipient. With sign-in off the local reader is the one account. The page lists every send, newest first, with its recipient count and how many dismissed it; Delete (`DELETE /api/admin/notifications`) removes a send for every recipient.
- **Receiving:** the dashboard shows the account's open notifications above Projects — kind, date, title, body (markdown) — until Dismiss (`PATCH /api/notifications/[id]`, the recipient only) stamps `dismissedAt`. Dismissed rows stay, so the admin's count holds; only the admin's Delete removes them.
- **Replying to feedback** (`/admin`, `POST /api/admin/feedback`): `POST /api/feedback` records `Feedback.userId`, the account that sent it (signed out: null). Reply writes one `Notification` of kind `feedback` — title the feedback's message on one line, body the reply (markdown), `feedbackId` the feedback — with one `NotificationRecipient`, the account that sent it; new feedback turns seen. The inbox names the account under each feedback and lists its replies with whether the account dismissed each; the dashboard card reads "Reply to your feedback", the feedback's message, then the reply. Feedback with no account, or an account the recipient list does not know, cannot be replied to (400). Delete on the notifications page removes a reply like any send. The first account to sign in adopts the local reader's feedback and notifications with the rest of its data (§2).
- **The boundary, enforced:** the admin routes touch `Notification`, `NotificationRecipient`, and `Feedback` only; no admin route reads or writes `User`, `Session`, `ReaderProfile`, or a corpus. No email: the notification lives in the app.

---

## 19. Translation

The reader's language (the `dissect-lang` cookie, §2) and a document's language can differ: a Chinese paper opened in the English reader, an English podcast transcript in the Chinese reader. Translation closes the gap through DeepL — the one translation provider, Chinese and English both ways (`DEEPL_API_KEY`; a Free API key ends in `:fx` and takes the free host on its own, any other key the Pro host; `DEEPL_API_URL` points a local run at a stand-in). Nothing here is a model call of the app's own: DeepL translates, the app caches and shows.

- **The offer.** When `DEEPL_API_KEY` is set, a bar above the article (and above a media document's transcript) says which language the document is in and offers Translate to the reader's language. The document's language is judged from its characters (`lib/translate/detect.ts`: Chinese when a fifth or more of the letters are CJK, English when the letters are Latin, unknown otherwise — no model call); a document already in the reader's language gets no offer, an unknown one is offered anyway, since DeepL detects the source itself.
- **The translation.** `POST /api/documents/[documentId]/translate` `{lang}` (editor) translates every PARAGRAPH, HEADING, LIST, TRANSCRIPT, TABLE (plain text under 5,000 characters), and FIGURE caption block the document has, in batches of at most 50 texts and about 100 KB (DeepL's limits), and stores each as a `BlockTranslation` row keyed by block and language with a hash of the block text it came from. A block edited since reads as stale and translates again on the next Translate; everything else is served from the cache, so a document costs its characters once per language. `GET …/translate?lang=` answers the cache (viewer). Usage telemetry records the characters sent, at $25 per million (provider `deepl`).
- **The reading.** Each translation reads under its block, quieter, marked by a rule, in the reader's language; in the transcript a paragraph's lines read together under it. Anchors, highlights, links, and every tool stay on the original text — the translation is a layer, never a replacement. Hide translation puts the article back; the choice is remembered per document in the browser, and a remembered document shows its cached translation again on open without a DeepL call. Edit mode shows no translations.
- **Not translated.** Notes, annotations, and the assistant's answers: those are written in the reader's language already (§4). Code and equations. A table past the plain-text cap.

---

## 20. Visualize (Unitos Ultra)

Visualize turns a selected passage into one picture that delivers its core idea at a glance: a directed diagram for named things and the relations between them, a still picture for a mechanism, a physical arrangement, or the shape a formula describes, or a short animation for a process whose order is the point. It is a derivation (§4, type `VISUALIZE`, template `lib/prompts/visualize.ts`), Unitos Ultra only (TIERS.md; the toolbar shows the tool to every account and answers a non-Ultra click with the plain Ultra message; the route answers 403), and runs on the most capable model at its highest effort (`VISUALIZE_MODEL`, `VISUALIZE_EFFORT` in `lib/derive/config.ts`: Claude Fable 5.1, `max`), because the picture has to be faithful or refused.

- **The judgment comes first.** The model draws only when all four hold: the passage has a structure a picture shows better than words; the picture needs nothing the passage or its context does not state; a reader who sees the picture without the passage takes away the passage's main point and not another; and the model is certain the picture is the best way to show it, not merely a possible way. Otherwise it declines. A decline is a valid outcome: the card says there is not enough certainty for a picture that carries the core idea of this passage, shows the model's reason, and points at the assistant, Explain, and Simplify; nothing persists. An analogy is drawn only when the passage makes it or when it is the standard one in the field, and the caption names it as an analogy.
- **Output contract.** JSON `{judgment: {structure, certain, reason}, visual: null | {kind: 'diagram' | 'picture' | 'animation', caption, diagram?, svg?}}`, validated strictly (`lib/derive/visualize.ts`), retried once on a failed parse like every JSON derivation. `certain: false` or a null visual is a decline. A diagram is a spec — `{direction: 'right' | 'down', nodes: [{id, label, detail?}], edges: [{from, to, label?}]}`, 3 to 12 nodes, labels at most 6 words — that the server lays out itself: ranks by longest path (a cycle's closing edge is marked and arcs around the nodes), one barycenter pass within a rank, boxes sized from measured text (`@napi-rs/canvas`, an estimate without it), and the direction flipped when the drawing would be a strip too wide for the card. A picture or an animation is SVG source the model writes to the prompt's rules (a 480-wide viewBox, the reader's palette, text at 14 to 20, SMIL for motion) and the server reduces before storing: only the listed elements survive (shapes, text, defs, gradients, clip paths, and the SMIL animation elements), no script, foreignObject, image, style element, event attribute, or reference outside the file; a link keeps what it wraps; the root keeps its viewBox and loses width and height. An SVG that is not well-formed, has no viewBox, or is empty fails the run with the reason.
- **Destination.** The SVG is stored as an `ImageAsset` (`image/svg+xml`, the account's; `/api/images/[imageId]` serves it with a Content-Security-Policy that runs nothing) and one annotation lands in the hidden Annotations section with `derivationType: VISUALIZE`, one source per segment of the selection, and the markdown `![caption](/api/images/<id>)` followed by the caption in italics. The reader's card is EXPLAIN's card titled Visualization; its Open link shows the picture full size in a new tab; Delete removes the annotation and its mark. The mark carries the tool's symbol, reopens the card from the stored markdown, and lists under Visualizations in the Annotations tab. An animation plays wherever the image shows: SMIL runs inside an `<img>`.
- **The run.** Behind the heartbeat stream (§4): spaces while the model reasons, then `{ok, noteId, kind, caption, content}` or `{ok, declined, reason}`, or the error token with the reason. Cancel aborts the model call and persists nothing.

## 21. Tool conversations and the log

Every AI tool's card can continue into a conversation, and every conversation anchored in the text — a tool's, or the assistant's from the selection popover — shows its condensed log when the reader hovers its mark.

- **Continue.** An Explain, Simplify, Analyze, or Visualize card, once its output is saved, carries one button at its foot: Continue in a conversation. Pressing it turns the foot into a text box and the card into Explain+ (Simplify+, Analyze+, Visualize+): the same card, the tool's symbol with a plus, the output above, the turns under it in the same scroll body, the box at the bottom. Every turn goes deeper on the output: the server (`/api/assistant/act` with `toolNoteId`) reads the selection from the annotation's own sources, puts the output in the prompt as what the reader ran and got, and answers from the output, the selection, and the document, adding to the output and never repeating it. It is the assistant's own route, so a turn can still propose actions, which go through the plan card as ever. Stop mid-turn, closing the card, and Delete work as on the assistant card.
- **Where the turns live.** On the tool's own annotation: `Note.conversation`, `[{role, content}]` oldest first, at most 60 turns. The output stays in `content`, so Simplify's sentence mirroring, the gist, and the Annotations tab read it as before; the Annotations tab shows the turns under the output, labeled Conversation, and the digest renders them after the output in the assistant conversation's transcript format. The assistant's own conversation keeps its transcript in `content` (§4); `lib/conversation.ts` reads both forms into one shape. Deleting the annotation deletes the conversation.
- **The mark.** The tool's symbol at the end of the highlighted text (`.mark-chip`) and on a figure's side label carries the plus once the annotation holds turns (`Highlight.plus`; `ToolSymbol` in block-view.tsx draws every symbol with or without it), and its tip says the card opens with its conversation. The card reopens from the mark with the turns and the box open. An open card's turns count before the refresh delivers the server's copy.
- **The log.** Hovering a mark whose annotation holds a conversation — the tool's or the assistant's — shows the log card where the conversation's card would open (the same slot the card claims, the same connector line; `data-log-card`, never a side card, so it takes no slot and pushes nothing): one line per message, the reader's lines as chat bubbles, the assistant's plain, so the conversation's point is clear at a glance. The pointer has to rest on the mark for 320 ms; the card stays while the pointer is on the mark or the card and leaves 220 ms after it goes; a scroll or a click closes it, and clicking the mark opens the card in its place. An open card shows no log for its own conversation.
- **Writing the log.** `POST /api/notes/[noteId]/log` (viewer) answers the stored log when its `turns` matches the conversation's message count, else writes one (`lib/notes/conversation-log.ts`, `lib/prompts/conversation-log.ts`, the gist's model and effort): one line per message, at most 15 words and 90 characters (40 in Chinese), in the message's own language, the reader's lines saying what the reader asked, the assistant's the answer's core point; a message the model skips shows its first words. For a tool conversation the output is the first message logged. Stored on `Note.log` as `{turns, lines: [{role, text}]}`; the reader caches it per conversation length for the session, so a hover asks once. Usage telemetry records the call as `log`.
