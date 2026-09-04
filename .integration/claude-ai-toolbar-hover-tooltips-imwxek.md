# claude/ai-toolbar-hover-tooltips-imwxek

**Intent:** Every control shows what it does on hover, in the UI language — the AI toolbar first — plus three asks that arrived mid-round: Distill second-last in the rail, recommended links moved from Annotations into the graph, and Link Google Drive fixed (Google refused its redirect URI).

**Files:**

- `src/components/tooltip.tsx` — new. The app's one tooltip layer: any element with `data-tip` shows a bubble on hover and keyboard focus (fast, styled, above the control, clamped to the viewport, hidden on press, scroll, resize, Escape; never on touch; `aria-describedby` while shown).
- `src/app/layout.tsx` — mounts `TooltipLayer` once. `src/app/globals.css` — the `tip-in` keyframes.
- 37 component files — every `title=` on a DOM element (and on `Link`) became `data-tip=`, so the native tooltip is gone from the app. Then `data-tip` added where a control had none: the AI toolbar (Assistant, Explain, Simplify, Comment, Close link, Run, section choices), the article menu, the rail, the header back link, the document bar's +, every card's close and stop button, the notes tray, the reply thread, the assistant panel, the edits panel, the annotations panel, video cards, drag handles. `history-control.tsx` keeps its person filter's accessible name with `aria-label`.
- `src/lib/i18n/dict/{reader,panes,outline,common,works,panels,assistant}.ts` — the new tooltip strings, en and zh. Two toolbar tips now say "the selection" (was "the highlighted text"), matching the guide and the zh glossary term 选中内容.
- `src/components/reader/workspace.tsx` — rail order: Assistant, Graph, Notes, Annotations, Distill, Edit history; `graph` prop carries `recommended`. `works.ts` nudge text and `guide-dialog.tsx` panel order follow.
- `src/lib/types.ts` — `RecommendedLinkView`. `src/app/n/[notebookId]/page.tsx` — queries the project's recommended links for the graph; annotation count excludes recommended links.
- `src/components/graph/graph-overlay.tsx` — Recommended links list (folded behind a toggle with the count): reason, both quotes, both documents, author, replies, Accept / Dismiss. `src/components/panels/annotations-panel.tsx` — recommended section removed; accepted links only.
- `src/lib/auth.ts` — `googleRedirectUri`, the one redirect URI, shared. `src/lib/drive/link.ts` — sends that URI; `completeDriveLink` finishes the link. `src/app/api/auth/callback/route.ts` — hands a Drive link (its own state cookie) to `completeDriveLink`. `src/app/api/drive/link/callback/route.ts` — deleted.
- `src/components/reader/document-bar.tsx` — Add from Google Drive on a linkable, unlinked account links first (full page), and on return (`?drive=linked`) opens the dialog on the Drive tab and the picker at once; `?drive=link-failed` shows the reason. `add-document-dialog.tsx` — `initialTab`; the Drive tab explains the first pick. `settings-form.tsx` — shows how the link went.
- `src/components/feedback-button.tsx` — the pill sits above the rail's More button on md+ (see Decisions).
- `README.md`, `SPEC.md` (§13, §14), `.env.example` — docs follow.

**Decisions:**

- One custom tooltip layer instead of adding native `title` attributes: the native tooltip waits about a second, looks different per browser, never shows on keyboard focus, and cannot be styled — which is why it read as "does not show". `data-tip` is the single mechanism now; keeping `title` alongside would double the bubble.
- Tooltips only where a control's function is not its label: icon-only buttons, AI tools, and text buttons with a consequence worth stating (Revert, Accept, Delete). Plain Save / Cancel / Sign in got none.
- "Second last" in the rail read as the last tab before Edit history; the More menu (pinned at the bottom, not a tab) stays last. If the ask meant below Edit history, it is a one-block move in `workspace.tsx`.
- Recommended links are listed for the whole project in the graph (not just the open document), collapsed by default behind a toggle showing the count — the dashed curves are theirs.
- Drive: reusing the sign-in redirect URI removes the console dependency entirely; the alternative (documenting a second URI to register) would have left every deployer one missed entry away from the same error. The old callback route is deleted rather than kept as an alias, so there is one code path.
- Add from Google Drive links first on accounts that can link; the per-visit browser token (which needs an Authorized JavaScript origins entry) remains only where linking is unavailable (sign-in off).
- Seen while testing, fixed: on desktop the fixed Feedback pill sat on top of the rail's More (⋯) button, so More could be neither hovered nor pressed. `feedback-button.tsx` now puts the pill above More on md+ (`md:bottom-[60px]`).

**Verified:** `npm run lint`, `npx tsc --noEmit` (after `next typegen`), `npm run build` all pass. Ran the built app against a local Postgres: hover on the AI toolbar, rail, and article menu shows every bubble with the expected text in en and zh; keyboard focus shows it; the graph lists a seeded recommended link and Accept clears it; Annotations shows no Recommended links section.
