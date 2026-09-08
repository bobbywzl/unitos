**Intent:** Videos keep the reader column instead of the page's wider figure width, which made them soft on high-density screens; an animated chart is not mistaken for a still one when sampling starts inside one of its pauses.

**Files:**
- `src/lib/parse/figures.ts`: `liftWideWidth` leaves a figure alone when its media is a video. Measured: the page's videos are 1280–1920 px wide; at the page's 124% width on a 2× screen they run past their pixels (1.03–1.32× upscaled) where the column width (720 px) downscaled them. The file picked is the same as before (the full-size mp4, verified at the pre-change commit and now, static and browser-rendered).
- `src/lib/parse/capture-animation.ts`: `STILL_MS` 1 s → 6 s. The animated chart's longest pause measured 2.0 s; sampling that started inside it called the chart still and left it as the static drawing, with no error. A loop found by the review (no store) counts as looped, not as a failure.
- `SPEC.md` §2.

**Decisions:**
- Videos exempted by media kind rather than by measured pixel size: the parse cannot read a video's dimensions without downloading it, and the page's own column is what its videos were made for.
- 6 s rather than 4 s: three times the measured pause, at 3.8 s of real time per still chart locally; the capture of the saved page runs 58 s with no network latency, inside the free plan's session.
- Verified locally: video figures carry no width; charts and photos keep theirs; the capture finds the 19 s loop (241 samples, period 190) and stores a 355 KB GIF. `next build`, `tsc`, `eslint` pass.
