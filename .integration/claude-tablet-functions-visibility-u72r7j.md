# claude/tablet-functions-visibility-u72r7j

**Intent:** Redo onboarding as a welcome splash ("Welcome <first name>" and the tagline over the dimmed mark) followed by one floating nudge bubble at a time: start a project, add an article with +, the ? guide, the sidebar.

**Files:**
- `src/components/nudges.tsx` — new. The nudge layer: reads the step from localStorage, finds the target by `data-nudge`, positions one bubble, advances on target press or ✕.
- `src/components/works/welcome-flow.tsx` — the splash only: first name, tagline, starts the nudges. The first-steps card is gone.
- `src/app/page.tsx` — passes the reader's first name to the splash.
- `src/app/layout.tsx` — mounts the nudge layer under the language provider.
- `src/components/works/works-shelf.tsx` — `data-nudge="project"` on the New project form.
- `src/components/reader/document-bar.tsx` — `data-nudge="document"` on the + button.
- `src/components/reader/workspace.tsx` — `data-nudge="guide"` on the ? button, `data-nudge="rail"` on the rail.
- `src/lib/i18n/dict/works.ts` — welcome and nudge strings replace the first-steps strings, en and zh.
- `src/app/globals.css` — the splash fade lasts 4.6s; a delayed rise for the tagline.

Earlier commits on this branch, already on main: tablet-sized selection tools, aligned tool box widths, editable document title, guide cards.

**Decisions:**
- The nudge sequence lives in localStorage (`unitos-nudge-step`), not on the account, matching the existing welcome flag. Only the splash starts it, so existing accounts never see nudges.
- A nudge ends on any press inside its target, including a click into the project form's input, not only on Create.
- Opening an existing project skips ahead to the first nudge whose target is on screen.
- The rail's bubble sits to the left of the rail on desktop and above the bottom bar on phones.
- Not run in a browser: typecheck and lint pass, but animation timing and bubble placement are unverified on screen.
