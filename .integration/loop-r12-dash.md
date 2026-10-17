# loop/r12-dash: round 12, package 6 (dashboard, Settings, toasts, offline notices)

**Intent:** make the dashboard, Settings, the bottom toasts, and the offline notices denser and easier, per NAV12-06, 10, 16 and EDGE12-06, 07, 08, 14 (dashboard and empty project part), without adding controls.

## Findings

Screenshots under `/home/user/wt/r12-dash/.qa-tmp/fix/` (git-excluded). Counts with the audit's own `controls()` (navigation `lib.mjs`, edge `lib.mjs`) or the report's method. Other workers add projects to the shared database, so the dashboard after has more cards than before (11 vs 6); per-card and first-card numbers are the fair comparison.

| id | status | before | after | screenshots |
|---|---|---|---|---|
| NAV12-06 dashboard hides the projects | fixed | 1440: notification 234 px, first card at y 576; New project on its own row (y 482) | notification 136 px, New project on the Projects row (y 265), first card at y 348 (-228 px); 8 cards in view | NAV12-06-before/after.png |
| EDGE12-08 phone dashboard | fixed | 390: notification 128-550 with Dismiss clipped by its scroll box, first card at y 751, card 342x529, 0 project titles on the first screen, 1.3 projects per screen | notification 88-224, Dismiss and Dismiss all on its top row (never clipped), first card at y 313, card 165x255, 4 projects on the first screen; page 6112 -> 2896 px with more projects | EDGE12-08-before/after.png |
| NAV12-10 Feedback on the first card's ⋯ at 390 | fixed | elementFromPoint at the ⋯ = "Send feedback"; the card menu did not open | ⋯ hit is the ⋯ itself; the menu opens (Notes, Save for offline, Rename, Delete); Feedback is a 38 px button in the header left of Settings (phone only); controls on the phone header 1 -> 2, floating pill 1 -> 0 | NAV12-10-before/after.png, dash-feedback-390.png |
| NAV12-16 Settings | fixed | Language at y 1727 / 2231 (phone), Theme at 1815 / 2319; Theme three 2-line cards; help "A work can override this from its Context tab"; signed in: badge link + gear = 2 links to Settings | Language at y 476 / 509, Theme at 512 / 545 (one row each, Theme 3 pills, description in the tooltip); Your data last; help "Who you are and what you read for. Every AI tool reads it: notes, extraction, analysis. Optional."; signed in: 1 link (the badge). Page 1933 -> 1802 px (1440), 2453 -> 2306 (390). Controls on the page 9 -> 9 | NAV12-16-before(-390)/after(-390).png |
| EDGE12-06 bottom toasts on the bar | fixed (mine); Stop reading not mine | phone: progress 741-820 and "Saved for offline" toast 776-820 on the bar (790-844), toast two lines | progress 699-778, toast 750-778 one line; 0 of 2 over the bar (was 2 of 2) | EDGE12-06-before(-late)/after(-late, -saved).png |
| EDGE12-07 offline add | fixed | phone: header notice + pill = 2 sentences; page 481 px wide for 4 s, bar at y 985; held repeat add: "Syncing 1 offline changes…" on every load | 1 sentence (the pill's count); page 390 px; while the held ask shows the pill is gone (0 sentences); one record reads "Syncing 1 offline change…" (zh 正在同步 1 项离线更改…). The held add stays in the queue: `uploads` holds it until Add again / Open / Cancel; Add again synced it as a new document, Cancel emptied the queue | EDGE12-07-before/after-queued.png, -held.png |
| EDGE12-14 empty project (the part outside the notes tray) | fixed | "No document open. Upload a PDF, drop one here, or add a URL…", 0 controls for the one thing to do (phone 9 controls, none adds) | "No document yet. Add a PDF, a web page, or a file to start reading." + one Add a document button (phone 10 controls); "drop one here" gone | EDGE12-14-before(-desk)/after(-desk, -dialog).png |

EDGE12-14 before screenshots are the audit's own (same code at 0c1d0af): the dev server was OOM-killed every time the stashed giant project page recompiled. The tray part of EDGE12-14 is package 3's.

## Files

- `src/components/works/notifications.tsx`: kind, count, Dismiss all, Dismiss on one row; title with date; body folded to two lines, a press opens and folds it (links still follow).
- `src/components/works/works-shelf.tsx`: New project at the right of the Projects heading; two columns below sm; the toast takes `BOTTOM_STATUS`.
- `src/components/works/work-card.tsx`: no empty band above the title (`mt-14` -> `mt-6`); smaller type, padding, and tags below sm.
- `src/app/page.tsx`: `pt-16` -> `pt-6 sm:pt-10`; header: Feedback button on a phone; signed in, the badge is the one Settings link (gear only when sign-in is off).
- `src/components/feedback-button.tsx`: `FeedbackHeaderButton`; the floating pill hides below sm on `/`; the icon is one function.
- `src/components/settings-form.tsx`: Language and Theme moved under Profile, one row each; Your data last. Not named in PACKAGES.md but no package owns it; it is the Settings surface.
- `src/lib/i18n/dict/settings.ts`: `backgroundDesc` en and zh.
- `src/lib/offline/queue.ts`: `queuedCount` counts only records waiting for the sync (held repeat adds left out). Nothing removed from the queue.
- `src/components/offline-status.tsx`: "Syncing 1 offline change…" for one.
- `src/lib/i18n/dict/common.ts`: `offlineSyncingOne` en and zh.
- `src/components/reader/document-bar.tsx` (package 5's file, the offline queue's notice): the queued-offline notice is gone (the pill counts it); a failed queue sets "Offline. This change did not save."; the bar's notice span truncates (`min-w-0 truncate`, words in `data-tip`) instead of `shrink-0`. Two small hunks.
- `src/components/progress-bar.tsx`: `BOTTOM_STATUS` (66 px over the window's foot below md, 24 px from md); the progress bar takes it.
- `src/components/reader/workspace.tsx` (package 5's file): the offline toast's className and the import line only.
- `src/components/reader/empty-project-add.tsx` (new): the empty project's Add a document button; presses the header's + after its own press ends.
- `src/app/n/[notebookId]/page.tsx`: renders it under the empty line for editors.
- `src/lib/i18n/dict/panes.ts` (package 5's dict): `noDocumentOpen` en and zh only.
- `SPEC.md`: Dashboard, Receiving (notifications), Where Feedback is, Settings order, §17 Sync and the offline copy's progress bar, the empty project.

## Where moved actions went

- Dismiss and Dismiss all: from the notification's foot to its top row.
- New project: from its own row under Projects to the right of the heading.
- Feedback on a phone's dashboard: from the floating pill to the header (left of Settings). Everywhere else unchanged.
- Settings (signed in): the gear goes; the person badge (already a link to Settings) is the link, with "Settings" as its tooltip and label.
- Theme descriptions (Always light, …): from a second line on each card to the pill's tooltip.
- The queued-offline header notice: gone; the offline pill's count ("Offline · 1 to sync") says it.

## Decisions

- The notification body folds to two lines at every width (EDGE12-08 asked three on a phone, NAV12-06 asked it closed); two lines keep the gist readable and the card at 136 px. The folded body is pressable (role=button), which the counter counts as one control: no new button was drawn.
- The date moved beside the title, so the top row fits 390 px with both Dismiss buttons.
- Cards keep the book shape on a phone (two to a row), as EDGE12-08 proposed, rather than a list.
- The "Saved for offline" toast was not merged into the progress card's last state (that needs state changes in `workspace.tsx`, package 5's); they already never show together, and both now sit over the bar.
- The empty project gets a button under the line rather than a sentence-as-button; it reuses the header +'s dialog through a click on it, so `document-bar.tsx` needs no new event.
- `queuedCount` excludes held records instead of the pill filtering, so any future reader of the count gets the same rule.

## Needs (files I do not own)

- `src/components/reader/reader-interactions.tsx:11304` (Stop reading) and `:11320` (the plan card): still `fixed bottom-6`, on the phone's bar (Stop reading measured at 785-820 over the bar 790-844). Use `BOTTOM_STATUS` from `src/components/progress-bar.tsx`.
- `src/lib/i18n/dict/panes.ts`: `uploadQueuedOffline` is now unused (en and zh); package 5 may delete it.
- Package 5: `workspace.tsx` has my one-line className change on the offline toast and its import; `document-bar.tsx` has the two hunks above (lines ~795-805 and ~1547).

## Checks

- `npx tsc --noEmit`: clean. `npx eslint` on every changed file: clean (one pre-existing warning in `document-bar.tsx:425`, not mine).
- Re-run: navigation `01-dash.mjs` (1440, 390), `13-dash-more.mjs` (390), edge `c02-dash.mjs` (phone zh), `s05-offline-add.mjs` (phone en), an Add again variant (phone zh), `s08-bottom-toasts.mjs`, `s06-empty.mjs`; New project still opens the new project (its dialog check was cut by a crashed tab; the project was made and is deleted). The machine OOM-killed the dev server five times; scripts were retried.
- Data made and deleted through the app's routes: projects "Fix r12 dash" (3 documents) and "Fix r12 dash empty", one "Untitled project" from the New project check. Database after: 0 projects, 0 documents of mine.
