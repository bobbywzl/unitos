**Intent:** The chart capture finishes inside a Browserless session — 2 minutes at most on the free plan, 60 s by default — instead of being cut mid-recording and leaving the chart as the page's static drawing.

**Files:**
- `src/lib/browser.ts`: a Browserless endpoint that sets no `timeout` is tried with 300 s, then 120 s, then as given (400 = past the plan's maximum); `sessionLengthOf(browser)` reports the session length the connection got.
- `src/lib/parse/render-page.ts`: the capture's deadline is the earlier of its budget and the session's end less a margin; the scroll pass waits 150 ms a step, not 250.
- `src/lib/parse/capture-animation.ts`: the page samples its own chart's shape every step of its stepped clock into a list on the window, so the server steps the clock in batches and reads the list — a dozen round trips for the loop detection instead of six hundred; the recording measures its frames as it goes and, when the loop will not be done by the deadline with 30% to spare, records every second, third, or fourth step at the matching delay; one trace line per chart.
- `src/components/reader/document-bar.tsx`: a render error is logged even when every caption has a figure — the chart stayed as the page's static drawing.
- `SPEC.md` §2.

**Decisions:**
- PNG frames stay: JPEG frames were three times faster per frame but their noise leaked into the GIF's diff frames (1.7 MB against 350 KB). Raw CDP capture saved 65 ms a frame but sends twice the bytes and can read a stale surface.
- The stride adapts rather than the frame rate being lowered for everyone: a local browser keeps 10 frames a second; a remote one drops to 5 or fewer only when the measured pace says the loop will not fit.
- Measured locally against the saved dyna.co page: unlimited budget, 10 fps, 351 KB, 47 s; a 45 s budget, 5 fps, 278 KB, 36 s; a 30 s budget fails, below what any Browserless session gives. `next build`, `tsc`, `eslint` pass.
