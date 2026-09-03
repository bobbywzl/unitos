# claude/signin-screen-messaging-mzxhj8

**Intent:** Replace the sign-in hero with "Got a ___? Put it in Unitos." (the blank rolling through document kinds every 2 seconds like a slot-machine reel) plus one line on what Unitos is; put a bowing outlined figure above the beta notice; make every reader-showcase callout point at the control it names and reword the callouts as "Function: what it does".

**Files:**
- `src/lib/i18n/dict/signin.ts` — hero keys (heroA with `{item}`, heroItems, heroB, heroSub) replace heroA/heroAccent; callout copy rewritten, en and zh.
- `src/app/signin/hero-reel.tsx` — new client component: the reel, rolling one row per beat with a no-transition jump back to the first row; one still sentence for screen readers.
- `src/app/signin/page.tsx` — the hero (two bold lines, the second larger, the subheading), the callout positions measured on `public/signin-reader.png`.
- `src/app/signin/reader-showcase.tsx` — chips size in container units so the callout layout holds at every image width.
- `src/app/signin/beta-notice.tsx` — the bowing figure (SVG) above the card; the card and the figure share a wrapper so the dialog's enter and exit animate them together.
- `src/app/globals.css` — `.hero-reel-*` (window, roll, snap) and `bow-*` keyframes with SVG-unit origins; both respect reduced motion.
- `SPEC.md` — §2 auth paragraph describes the hero, the figure, and the callouts.

**Decisions:**
- The rotating words carry their own article ("an article", "a PDF assignment") so the sentence stays grammatical; the template is "Got {item}?".
- The reel rolls upward (the next item rises into place) with a slight overshoot, and cuts instead of rolling under reduced motion; it does not stop.
- The figure is in profile, cut at the waist by the card's top edge, and bows toward the right; the arm hangs by counter-rotation and the head nods a little further. The bow loops every 4.4 s.
- Six callouts instead of adding a seventh for links: the highlight callout now points at the highlighted phrase only, the comment callout at the comment mark, the pending callout at the Accept button, the assistant callout at "Explain simply" in the assistant menu.
- Chips scale with the image (clamp 8–12px) rather than staying 11px, because a fixed chip is 74% of the image width at the 1024px breakpoint and covered the marks it pointed at.
- The hero type sizes with its column (cqw, capped at 3.6rem and 4.25rem): the reel is as wide as its longest item, so with fixed breakpoint sizes "Got a research paper?" wrapped between 1024px and 1366px.
- The reel's glow is a drop-shadow filter on the window, not a text-shadow: a text-shadow was clipped at the window's edges and the hidden rows' shadows bled into it as a band.
