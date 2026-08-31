# graph-ui-polish-91a1nn

**Intent:** Polish the graph overlay — cleaner nodes and connections, spotlight linking on hover, and the release-edu canvas animations (scatter→settle float-in, breathing, marching dashes, fluid pan/zoom).

**Files:**
- `src/components/graph/graph-view.tsx` — rewritten. Ring layout ordered by a BFS walk over the link graph so linked documents sit adjacent; card-ringed dots sized by link count, clay active document, breathing on documents with recommended links pending; slimmer swept curves with count pills, sand dashed marching recommended-only pairs; hover spotlight (node + its links + linked documents, or a curve's pair) carried by a React context so hover never rebuilds reactflow's node/edge arrays; scatter→settle first open with edge fade-in; release-edu navigation (two-finger scroll pans, pinch or Ctrl/Cmd+wheel zooms, double-click zoom off).
- `src/app/globals.css` — graph section: settle transition, edge fade, `graph-breathe`, `graph-dash-march`, overlay fade-in, reactflow controls in the app palette (scoped `.corpus-graph` to outrank reactflow's stylesheet).
- `src/components/graph/graph-overlay.tsx` — overlay fades in; header counts use the new localized `graphCounts` key.
- `src/lib/i18n/dict/panes.ts` — `graphCounts` (en/zh); graphHint mentions the hover spotlight (en/zh).

**Decisions:**
- Spotlight state rides a context instead of node/edge `data`. Rebuilding the arrays per hover made reactflow replace elements mid-gesture, which ate a click landing in the same frame as pointer entry (verified with Playwright; context fixed it, taps and clicks all navigate).
- Edge mouse-leave is lost by reactflow when the hovered edge re-renders; a pane mouse-move gated on `e.target` being the pane clears stale spotlight.
- Navigation follows release-edu (scroll pans, Ctrl/Cmd+wheel zooms) rather than wheel-zoom; SPEC.md §13 says "Obsidian-style", which reads as free pan/zoom/drag, but if wheel-zoom is wanted it is two props.
- Scatter→settle phase lives in a ref with an rAF guard so strict-mode double effects re-render the scatter instead of skipping it.
- Recommended-only pairs draw sand (not clay) as well as dashed — release-edu's pending-vs-real color split.
- Verified in the running app (local Postgres + seeded corpus, Playwright, light and dark, mouse and touch): float-in, spotlight enter/leave, drag with curves following, count pills, click-to-open, themed controls. `tsc`, `eslint`, and `next build` pass.
