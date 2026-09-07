**Intent:** Stop the URL parse from taking the words inside a figure (a chart's title, legend, axis labels, source line) as the figure's caption.

**Files:**
- `src/lib/parse/figure-style.ts`: a new bake pass, `markBoxes`, writes `data-box` on every element the page paints its own background under (different from the page's background) or sets in its own font while it holds a chart with text. Two small helpers compare colors and font-family lists.
- `src/lib/parse/figures.ts`: text inside a box that holds the figure's media, below the container, is the figure's words, not a plain caption; the caption is the text outside the box. A labeled caption ("Figure N", or a figcaption) is a caption wherever it sits. The residual-text fallback and the composite-figure check leave the box's words out too. A box with more than 400 characters outside its media is prose, not a figure box.
- `src/lib/parse/layout.ts`: the layout pass's page digest keeps `data-box`, and the prompt says text inside a box that holds the figure is never a caption.
- `src/lib/parse/types.ts`: parser version 18, so stored URL documents re-parse.
- `SPEC.md`: the box fact in the URL replica fidelity entry.

**Decisions:**
- Both signals the reader named are used: the box's background against the page's, and the box's own font around a chart. The font signal only marks an element that holds a chart svg with text, so a wrapper that sets the article's font does not become a box.
- A plain (unlabeled) caption set inside the same box as the media is now read as the figure's words, so the block text falls to the image's alt or "Figure". Labeled captions and figcaptions inside the box still count as captions.
- The PDF parse is unchanged: it only takes a "Figure N" line as a caption, so a figure's words cannot become its caption there unless they open with that label.
- No test runner exists in the repo; the change was checked with a scratch jsdom script (nine cases: boxed chart with and without an outside caption, labeled caption inside the box, figcaption inside a card, font-only box, same-as-page background, boxed image with words, no stylesheet, boxed prose section) and the full `parseHtmlContent` walk on the boxed-chart case.
