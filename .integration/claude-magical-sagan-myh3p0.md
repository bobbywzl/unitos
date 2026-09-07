**Intent:** Stop the URL parse from reading the words inside a figure (a chart's title, legend, axis labels, source line) as its caption, keep those words looking as they did on the page, and import Markdown files with every construct intact.

**Files:**
- `src/lib/parse/figure-style.ts`: `markBoxes` writes `data-box` on every element the page paints its own background under (different from the background behind it) or sets in its own font while it holds a chart with text; `bakeFigureWords` writes the page's look onto the figure's words as inline style (font size, weight, style, color, transform, spacing, alignment), a legend swatch's size, color, corner, and gap, and the box's background, padding, and corner as `data-box-style`. Helpers compare colors and font lists and resolve shorthands to pixels.
- `src/lib/parse/figures.ts`: text inside a box that holds the figure's media is the figure's words, not a plain caption; a labeled caption is a caption wherever it sits; a wrapper holding only inline content becomes a `<p>` so a legend stays one row; a container that is itself a box passes its look to the figure.
- `src/lib/parse/sanitize.ts`: inside a figure, text elements keep the baked inline style (an allowlist of properties, plain values, bounded lengths), a box stays as the one `<div>` a figure keeps, and a boxed figure keeps the box's look.
- `src/app/globals.css`: `.reader-figure figure > div` stacks a box's content at the column's width.
- `src/lib/parse/layout.ts`: the page digest keeps `data-box`; the prompt says text inside a box that holds the figure is never a caption.
- `src/lib/parse/markdown-document.ts` (new): a Markdown file becomes one HTML page (remark with GFM, math set aside first, front matter dropped, GitHub-style heading ids) and the URL walk reads it — the same shapes, one code path.
- `src/lib/markdown-file.ts` (new): the accept list and file test the client and the routes share.
- `src/lib/parse/ingest.ts`: `ingestMarkdown` (hash dedupe, bytes kept, no model pass, structure pass with instructions); `reparseDocument` re-reads a stored file that is not a PDF as Markdown; `isPdfBytes`.
- `src/app/api/documents/route.ts`, `src/app/api/uploads/complete/route.ts`, `src/app/share/target/route.ts`: a Markdown upload takes the Markdown path.
- `src/components/reader/document-bar.tsx`, `src/components/reader/upload-assistant.tsx`: Markdown files are accepted, dropped, and take no PDF judgment.
- `src/lib/i18n/dict/api.ts`, `src/lib/i18n/dict/panes.ts`: the file-type strings name Markdown, in both languages.
- `src/lib/parse/types.ts`: parser version 18 (its note). `SPEC.md`: Markdown import, the box, and the figure's words. `package.json`: `unified`, `remark-parse`, `@types/mdast` declared (already installed through react-markdown).

**Decisions:**
- A box is compared against the background behind it, not the body's: a white card on an ivory section is a box.
- The box stays a `<div>` in the figure html rather than moving its look to the figure, so the caption sits outside it as on the page. It is the only `<div>` the sanitizer keeps, and only with the box's look.
- A caption inside the box keeps the reader's caption look; only the figure's words take the page's look.
- Markdown: inline math stays as written (the reader renders display math only); an image with a relative path is its caption; a relative link is its text; a `.txt` file reads as Markdown.
- No test runner in the repo. Checked with scratch scripts: nine synthetic box cases, a Markdown fixture covering every construct, a real README, the dyna.co page (the reported case: the words now carry their look inside the box, the captions outside), and a four-page regression scan whose block lists are identical to the pre-change baseline.
