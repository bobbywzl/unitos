# parseloop-pdf-r16

**Intent:** PDF parse loop round 16: nine parser rules from the weakest sweep documents (qm-madsen-ch23, a Tufte-layout quantum mechanics textbook; ipsur-ch11, a statistics book with R listings, new to the sweep), one rule per commit, plus the new sweep entry.

**Files:**
- `src/lib/parse/pdf/columns.ts` — sideNote: a margin note at the body's size beyond a justified column reads beside the column (`inMargin`); a margin figure reads beside the paragraph that holds its top, as a group of its own.
- `src/lib/parse/pdf/figures.ts` — pageGraphics: a drawing of a few paths in the margin beside the text column is a figure (`margin`); a chart's title and axis titles are the chart's (`titlesOf`), the ticks' reach grows to 1.7 lines, a run's face is its dominant face.
- `src/lib/parse/pdf/math/layout.ts` — textAtom: a digit of a font with no name reads as `\mathbb`; `?` is a formula's close mark; accents(): a text font's macron on an italic h's own baseline reads as `\hbar`.
- `src/lib/parse/pdf/math/check.ts` — symbolLevels and lay count ħ/ℏ as h and a bar.
- `src/lib/parse/pdf/glyphs.ts` — FAMILIES: txfonts' rtxmi/txex/rtxr (and bold twins) are OML/OMX/OT1.
- `src/lib/parse/pdf/index.ts` — a named font whose name says no shape and whose glyphs all advance the same is monospace (`widthsByFont`), keeping `realNames` per font.
- `src/lib/parse/pdf/faces.ts` — `nameShape` exported for the monospace rule.
- `scripts/parse-bench/corpus.json` — `ipsur-ch11` sweep entry (GFDL 1.3, raw.githubusercontent.com/gjkerns/IPSUR, pages 239–268); the PDF stays uncommitted under `.bench/real/`.

**Decisions:**
- Three qm-madsen rules (\mathbb digit, "?", \hbar) each lower that document's composite by about 0.05 while reading more displays as LaTeX; each commit message states the bench artifact behind the drop (crop-count denominator, pdftotext's "h" for ⟨, formula words the LaTeX does not match word for word). Someone could instead have changed the bench's coverage normalization.
- The monospace-by-advance rule requires a narrow and a wide character among eight distinct ones, so a text font's digits never pass; a document whose body is sans and whose charts are in the same face keeps its chart titles as text.
- The chart-title rule takes a label into its figure, so two documents lose one coverage word each (qm "v0", Art of Linear Algebra "AAᵀ"), a hundredth of composite; stated in the commit.
- Pending qm rules left uncommitted (a glyph on another display row's baseline; a text accent never hangs; a crop's parts stand across the display's column; a margin caption beside a centered figure): each verified on its page but not scored within the round's budget.
