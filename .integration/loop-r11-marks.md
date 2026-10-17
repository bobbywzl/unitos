# loop/r11-marks

**Intent:** fix round 11's marks and hold package in the block reader: every note and annotation on shared words opens from the text in a stable order (SEL11-01, TOOL11-10), a hold on a mark tells selecting from carrying (SEL11-02), and a proposal for the column slide (SEL11-06).

## Findings

- **SEL11-01 (blocking): fixed** in the block reader (the page editor side is another worker's). Sources resolve in id order and the mark picks the innermost anchor, equal spans by source id, so the pick never flips between loads. A plain note's mark no longer paints its default clay over a highlight's or a comment's color. A click on words under more than one note or annotation sends all of them to the chooser, notes included, and the chooser has a Note row that opens the note in the tray. The same rule (`markStack`) runs for a table's marks and a figure's label. The Note row and the open handler are in reader-interactions.tsx: **the Needs diff below must land with this branch**; without it a note shows in the chooser as a Highlight row that opens nothing useful. Screenshots: `.qa-tmp/fix/SEL11-01-before.png` (chooser with no note) / `SEL11-01-after.png` (Highlight, Comment, Note); `SEL11-01b-before.png` (clay over gold) / `SEL11-01b-after.png` (gold kept, chooser Note + Highlight); `SEL11-01c-after.png` (the Note row opened the note in the tray). Before the fix the clay highlight dropped on a note opened the highlight only and the note could not be reached; now both are in the chooser.
- **TOOL11-10: fixed.** Every mark on stacked words carries every source's id (`data-source-ids`), and the open handler finds a source through it (`markOfSource`, Needs diff). Picking the second of two highlights on exactly the same words opens its card. Screenshots: `.qa-tmp/fix/TOOL11-10-before.png` (row 1 picked, nothing opens) / `TOOL11-10-after.png` (its card). The run's date on rows of the same kind is not added (Decisions).
- **SEL11-02 (blocking on touch): fixed.** `watchHold` has a `words` mode for marks. A mouse rests 500 ms (`WORDS_HOLD_MS`) before the quote is ready, the mark then rises (`mark[data-held]`: deeper fill, shadow, grab cursor), and only the move after that lifts the quote; a press that ends where it began opens the card however long it was held (200 ms and 700 ms both open it); a pause under 500 ms and then a drag selects (300 ms and 450 ms both select, the toolbar opens). A touch never lifts a quote from the words: no ghost, no cleared selection, no `user-select: none`, so the browser's long press selects the word; on touch the quote is carried from the on-mark card's grip, which still lifts on a hold. Round 9's held highlight dropped on a note still lands (hold 650 ms, the quote and its source saved: `.qa-tmp/sel/holddrop.mjs`). Screenshots: `.qa-tmp/fix/SEL11-02-before.png` (pause 250 ms then drag: a ghost, no selection) / `SEL11-02-after.png` (pause 300 ms then drag: words selected, toolbar); `SEL11-02-after-armed.png` (the held mark); `SEL11-02c-after-held-drop.png` (the quote carried over a note); `SEL11-02b-before.png` (touch long press: ghost) / `SEL11-02b-after.png` (no ghost; headless Chromium does not run the browser's long-press word selection, so the selection itself is not pictured). The mark's call passes `words` and `armed` from reader-interactions.tsx (Needs diff).
- **SEL11-06 (polish): not fixed, proposal only.** The slide comes from `claimSideSlot` and `cardRoom` in reader-interactions.tsx, which this package does not own, and no change in the mark CSS keeps the words still. Proposal: the on-mark card (a highlight's or a comment's, read at a glance) never moves the column; when neither margin holds it, it opens under the paragraph as in the narrow reader (`dockBelowCard` plus `layoutNarrowCards` for that card alone), so the clicked words stay under the pointer; tool cards, read at length beside the words, keep the slide. Trade-off: the text after the paragraph moves down by the card's height, and the card can stand a few lines below a click on a paragraph's first line. It is worth a try against the 1440 layout before it replaces the spec line. `.qa-tmp/fix/SEL11-06-before.png` (the column 98 px left after a click).

## Files

- `src/lib/anchors/resolve.ts`: `orderBy: { id: "asc" }` on the source read, so stacked sources come back in the order they were made. Ordering only; how anchors resolve is unchanged.
- `src/components/reader/table-marks.ts`: `markStack` (one rule for which anchor paints and which ones a click opens), used by table marks; table marks carry `data-source-ids` and send the stack to the chooser; `comment` added to the paint signature.
- `src/components/reader/block-view.tsx`: paragraph marks use `markStack`, carry `data-source-ids`, send every note and annotation on the words to the chooser, and say "view the note" when the stack is notes only; a figure's label sends its stack to the chooser too.
- `src/lib/i18n/dict/reader.ts`: `reader.note` ("Note" / "笔记") for the chooser's Note row.
- `src/lib/hold-drag.ts`: `WORDS_HOLD_MS` and the `words` and `armed` options of `watchHold`.
- `src/app/globals.css`: `mark[data-held]`, the held mark.
- `SPEC.md` §6: the chooser line (notes in the chooser, the order, the paint rule) and the hold-on-a-highlight passage (the words mode, touch).

## Decisions

- The paint rule: an annotation's color wins over a plain note only where the annotation has a fill of its own (a highlight's hue or a comment). A tool's mark (an underline with no fill while its card is closed) still loses to a note inside it, so the note's words stay visible.
- A hold on stacked words lifts the painted mark's passage (now the highlight where a note sits inside it, before the note's): the passage the reader sees is the one that lifts.
- 500 ms for a mouse hold on words, the platform's long press: a pause before a drag rarely lasts that long, and the mark shows the moment it is ready. Carrying a quote costs 350 ms more than before; the mark's grip on the card (and the Annotations tab) carries without the wait.
- Touch never carries a quote from the words. The alternative (a longer touch hold that lifts once the browser has not started a selection) races the browser's own long press.
- Equal spans order by source id (cuids are time-ordered), not by kind. The chooser lists innermost first.
- The run's date on chooser rows of the same kind (TOOL11-10's second suggestion) is not added: `annotationsBySource` has no date, and adding one touches the page's data shape.

## Data

Test project "Fix r11 marks" with a copy of How Reading Shapes Memory ("FIX11 Reading", `.qa-tmp/sel/copydoc.mjs`) and the stacked cases of `stack-setup.mjs` (plus K clay and sage highlights each with a note on the same words, and two highlights on exactly the same words). Every Source row of the document compared before and after all runs: the 19 rows are byte-identical (`.qa-tmp/sel/sources-before.txt`, `sources-after.txt`); one row was added, by the held drop test. The project was deleted at the end through the app (`DELETE /api/documents/:id`, `DELETE /api/notebooks/:id`).

## Needs

`src/components/reader/reader-interactions.tsx` (another worker's): the open handler finds a source through `data-source-ids` (`markOfSource`), the chooser gets the Note row, and the mark's hold passes `words` and `armed`. Also at `.qa-tmp/needs-reader-interactions.diff` in this worktree (left applied, uncommitted, in the worktree's reader-interactions.tsx). Against the base of this branch:

```diff
diff --git a/src/components/reader/reader-interactions.tsx b/src/components/reader/reader-interactions.tsx
index 43a8635..4c97a7b 100644
--- a/src/components/reader/reader-interactions.tsx
+++ b/src/components/reader/reader-interactions.tsx
@@ -85,7 +85,8 @@ import { useWeb, WebChip } from "@/components/assistant/web-chip";
 import { SaveAsNote } from "@/components/assistant/save-as-note";
 import { QueuedList, queuedKey, type QueuedText } from "@/components/assistant/queued-list";
 import { useLang, useT } from "@/components/lang-provider";
-import { clipWords } from "@/lib/markdown-preview";
+import { clipWords, markdownPreview } from "@/lib/markdown-preview";
+import { noteTitle } from "@/lib/note-title";
 import { AnnotationGrip } from "@/components/outline/annotation-grip";
 import { useCardDropOpen } from "@/components/outline/use-card-drop";
 import {
@@ -361,6 +362,15 @@ const CARET_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "
 // (its code loads on demand; a long import takes a while to stand).
 const PAGE_WAIT_MS = 30_000;
 
+/** The mark a source paints on: its own, or, on stacked words, the mark
+    whose words it shares (block-view.tsx data-source-ids). */
+function markOfSource(root: ParentNode, sourceId: string): HTMLElement | null {
+  return (
+    root.querySelector<HTMLElement>(`[data-source-id="${sourceId}"]`) ??
+    root.querySelector<HTMLElement>(`[data-source-ids~="${sourceId}"]`)
+  );
+}
+
 // A jump flashes the mark or the block it lands on; the page editor paints it.
 function flashElement(el: HTMLElement) {
   if (flashInPage(el)) return;
@@ -3782,7 +3792,7 @@ export function ReaderInteractions({
           rows ??= unitRows(pane, unit, richTextRef.current !== null);
           found = (rows ?? []).flatMap((row) => wordsOf(pane, row) ?? []);
         } else if (!wordsHidden(pane, keys.filter((key) => !isCoreKey(key)), readWholeRef.current)) {
-          const el = pane.querySelector<HTMLElement>(`[data-source-id="${sourceId}"]`);
+          const el = markOfSource(pane, sourceId);
           if (el) found = [el];
         }
       }
@@ -3835,7 +3845,7 @@ export function ReaderInteractions({
     let attempts = 0;
     let timer: ReturnType<typeof setTimeout> | null = null;
     const tryOpen = () => {
-      const el = containerRef.current?.querySelector<HTMLElement>(`[data-source-id="${src}"]`);
+      const el = containerRef.current ? markOfSource(containerRef.current, src) : null;
       // Drawn: a mark in a collapsed unit waits for the unit read whole.
       if (el && el.getClientRects().length > 0) {
         window.dispatchEvent(new CustomEvent("dissect:open-annotation", { detail: { sourceId: src } }));
@@ -3897,11 +3907,31 @@ export function ReaderInteractions({
   const markTop = useCallback((sourceId: string) => {
     const container = containerRef.current;
     if (!container) return 80;
-    const markEl = container.querySelector<HTMLElement>(`[data-source-id="${sourceId}"]`);
+    const markEl = markOfSource(container, sourceId);
     return markEl
       ? markEl.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
       : 80;
   }, []);
+  // The plain note a source quotes for, when it is no annotation's: the
+  // chooser's Note row (SPEC.md §6).
+  const noteOfSource = (sourceId: string): string | null => {
+    for (const list of Object.values(anchorHighlights)) {
+      const hit = list.find((h) => h.sourceId === sourceId);
+      if (hit) return hit.annotation ? null : (hit.noteId ?? null);
+    }
+    return null;
+  };
+  const notesById = useMemo(() => {
+    const byId = new Map<string, NoteView>();
+    const walk = (list: SectionView[]) => {
+      for (const section of list) {
+        for (const note of section.notes) byId.set(note.id, note);
+        walk(section.children);
+      }
+    };
+    walk(sections);
+    return byId;
+  }, [sections]);
   // The anchor a stored mark paints, rebuilt from its highlight entry.
   const anchorOfSource = useCallback((sourceId: string): Anchor | null => {
     for (const [blockId, list] of Object.entries(anchorHighlightsRef.current)) {
@@ -3925,11 +3955,13 @@ export function ReaderInteractions({
   }, []);
 
   // A hold on a highlight in the text lifts its passage (SPEC.md §6,
-  // lib/card-drag.ts): the pointer stays on the mark for HOLD_MS, the quote
-  // follows the pointer as a ghost, and let go on a note — a note card of
-  // the tray, or the floating card — it lands there as a quote, the mark's
-  // anchor its source. A press that moves first is a selection, as ever, and
-  // a shorter press is the click that opens the annotation. The article
+  // lib/card-drag.ts): the mouse stays on the mark for WORDS_HOLD_MS, the
+  // mark lifts (data-held), and the move that follows carries the quote as
+  // a ghost; let go on a note — a note card of the tray, or the floating
+  // card — it lands there as a quote, the mark's anchor its source. A press
+  // that moves first is a selection, as ever, and a press that ends where
+  // it began is the click that opens the annotation, however long. A touch
+  // never lifts from the words: its long press selects them. The article
   // stops selecting while the ghost is out: the press already started a
   // selection, and it would otherwise grow under the pointer.
   useEffect(() => {
@@ -3964,7 +3996,7 @@ export function ReaderInteractions({
             },
           );
         },
-        { pull: false },
+        { pull: false, words: true, armed: (on) => mark.toggleAttribute("data-held", on) },
       );
     };
     container.addEventListener("pointerdown", onDown);
@@ -4081,9 +4113,9 @@ export function ReaderInteractions({
       ).detail;
       const container = containerRef.current;
       // Another pane owns marks this pane does not paint.
-      if (!container?.querySelector(`[data-source-id="${sourceId}"]`)) return;
-      // Words under two annotations or more: a small chooser at the click
-      // lists every one, and the one picked opens (SPEC.md §6).
+      if (!container || !markOfSource(container, sourceId)) return;
+      // Words under more than one note or annotation: a small chooser at the
+      // click lists every one, and the one picked opens (SPEC.md §6).
       if (sources && sources.length > 1 && x !== undefined && y !== undefined) {
         const crect = container.getBoundingClientRect();
         setStackChooser({
@@ -4098,7 +4130,7 @@ export function ReaderInteractions({
       if (!stored) {
         // Highlight or comment: the on-mark card, right below the mark.
         const summary = annotationsBySourceRef.current[sourceId];
-        const markEl = container.querySelector<HTMLElement>(`[data-source-id="${sourceId}"]`);
+        const markEl = markOfSource(container, sourceId);
         if (!summary || !markEl) {
           window.dispatchEvent(
             new CustomEvent("dissect:focus-annotation", { detail: { sourceId } }),
@@ -9302,6 +9334,31 @@ function blockFormatKind(block: { type: string; html: string | null; text: strin
           {stackChooser.sources.map((sid) => {
             const tool = annotationBubbles[sid];
             const summary = annotationsBySource[sid];
+            // A plain note on the words: its row opens the note in the tray.
+            const noteId = tool || summary ? null : noteOfSource(sid);
+            if (noteId) {
+              const note = notesById.get(noteId);
+              const line = note
+                ? noteTitle(note.content) || note.gist || markdownPreview(note.content)
+                : (anchorOfSource(sid)?.quotedText ?? "");
+              return (
+                <button
+                  key={sid}
+                  role="menuitem"
+                  data-track="stack-chooser-note"
+                  onClick={() => {
+                    setStackChooser(null);
+                    window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId } }));
+                  }}
+                  className="flex min-w-0 flex-col items-start rounded-xl px-2.5 py-1.5 text-left hover:bg-sand-100"
+                >
+                  <span className="text-[10.5px] font-bold tracking-[0.08em] text-clay-600 uppercase">
+                    {t("reader.note")}
+                  </span>
+                  <span className="line-clamp-2 text-[12px] text-sand-700">{line}</span>
+                </button>
+              );
+            }
             const kind = tool?.kind ?? summary?.kind ?? "highlight";
             const quote = summary?.quotedText ?? anchorOfSource(sid)?.quotedText ?? "";
             return (
```
