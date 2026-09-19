# claude/peaceful-lovelace-r8gxh9

**Intent:** Add slides (.pptx, Google Slides) and sheets (.xlsx, .csv, .tsv, Google Sheets) as parsed documents with their own reader forms, on which every AI tool, annotation, and note works as on an article (SPEC.md §27).

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260919150000_slides_sheets/`: `BlockType` gains `SLIDE` and `SHEET`; `Document.format` ("slides" | "sheets").
- `src/lib/parse/office.ts` (new): the zip (fflate), XML (jsdom's DOMParser), relationships, theme, colors, units, and markup helpers both parsers share; `sniffOfficeFile` reads the format from the zip's parts.
- `src/lib/parse/slides.ts` (new): the slides parser — one SLIDE block per slide, the replica html, the text in reading order with speaker notes, pictures stored as `ImageAsset`s, placeholder inheritance from layout and master.
- `src/lib/parse/sheets.ts` (new): the sheets parser — one HEADING and one SHEET block per sheet, the grid html with styles, merges, frozen panes, number formats (`ssf`), and the CSV/TSV reader.
- `src/lib/office-file.ts` (new): client-safe accept lists and file tests.
- `src/lib/parse/ingest.ts`: `ingestSlides`, `ingestSheets`, re-parse by `Document.format`, image claiming for `url()` backgrounds, `format` on create.
- `src/lib/parse/types.ts`: `ParsedDocument.format`, `slideAspect`.
- `src/lib/handwritten/page-images.ts`: slide pictures from Drive's PDF export (`storeSlidePictureSizes`, `renderSlidePictures`, carry-over on re-parse).
- `src/lib/drive/types.ts`, `src/lib/drive/fetch.ts`, `src/app/api/drive/import/route.ts`: Drive kinds `slides`, `sheets`, `slides-file`, `sheets-file`; `fetchExported` for any export mime; `fetchDriveFile`.
- `src/app/api/documents/route.ts`, `src/app/api/uploads/complete/route.ts`: the upload paths route .pptx/.xlsx/.csv/.tsv to the new parsers.
- `src/app/api/documents/[documentId]/page/[blockId]/route.ts`: serves a SLIDE block's stored picture; `finish/route.ts` preloads it; `translate/route.ts` translates slides; `src/app/api/blocks/[blockId]/route.ts`, `style/route.ts`: refuse edits on SLIDE/SHEET.
- `src/lib/derive/context.ts`: `formatLines` — the document prefix says what SLIDE and SHEET blocks are (only when the document has them, so cached prefixes stay identical).
- `src/components/reader/block-view.tsx`: `MarkedHtml` (was `TableHtml`) renders TABLE, SLIDE, SHEET and loads a slide's picture; `reader-interactions.tsx`: no edit mode on SLIDE/SHEET; `document-bar.tsx`, `upload-assistant.tsx`: accept lists, drop filter, item labels, Drive size checks.
- `src/app/globals.css`: `.reader-slide` and `.reader-sheet` styles.
- `src/lib/i18n/dict/panes.ts`, `api.ts`, `common.ts`: new keys, messages, zh glossary terms.
- `SPEC.md` (§27), `CLAUDE.md` (glossary), `package.json` (fflate, ssf).

**Decisions:**
- Own OOXML parsers over a library: no npm pptx reader keeps positions, styles, and notes together, and the DOM-text-equals-block-text rule needs control over every text node. The zip reader is fflate; XML goes through jsdom's DOMParser, already a dependency. Number formats use SheetJS's standalone `ssf`.
- A sheet is one SHEET block per sheet (capped at 10k rows / 200k cells) in a scroll box with sticky frozen rows and columns, not chunked blocks: chunks would split the grid into several scroll boxes.
- A slide's picture (Drive's PDF export) is drawn over the replica with the replica's words transparent, a PDF viewer's text layer; uploaded .pptx files have no picture and show the replica. The PDF bytes are not stored; a re-parse carries the stored pictures over by slide number.
- Bullets and numbers are part of the block text ("• ", "1. "), like LIST blocks carry their markers.
- `Document.format` is a column rather than a byte sniff because a .csv has no magic and would read as Markdown on re-parse.
- `PARSER_VERSION` is not bumped: the new formats do not change existing documents, and a bump re-parses every URL document on open.
