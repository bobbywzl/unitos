# claude/explore-commands-dir-asqh16

**Intent:** Fix the instrument fan (the five tools that spring out above a hovered work on the dashboard) rendering underneath the works and text in the row above.

**Files:**

- `src/app/globals.css` — the only change. Covers are `z-1` and fans `z-0`, and every `li.work` had `z-index: auto`, so all of them shared one stacking context: any cover painted over any fan, and a fan springing 46px above its work's top edge slid under the work above. Added rules beside the existing fan block: each `.work` is its own stacking context (`z-index: 0`), and on `:hover`/`:focus-within` the work rises to `z-index: 5`, above its siblings. The drop back is delayed 0.5s (`transition: z-index 0s 0.5s`, delay reset to `0s` while raised) so the retracting fan is not clipped on mouse-out.

**Decisions:**

- Fixed in `globals.css` next to the fan rules rather than with Tailwind classes in `work-card.tsx` — the fix needs state selectors plus a transition delay, and it keeps all fan stacking behavior in one place.
- Raise on hover/focus only, not a permanent fan raise above covers — the rest state ("tucked behind the cover") depends on the fan sitting under its own work's cover.
- Base `z-index: 0` on every `.work` (not left `auto`) because `z-index` only transitions between integers; this also makes each work a stacking context. Checked the ⋯ menu (`z-2`): it stays inside its work's bounds, so containment cannot put it under a sibling, and while it is open the focused button keeps the work raised via `:focus-within`.
- Drop-back delay matches the fan's 0.5s retraction exactly.
- Verified in headless Chromium against a static repro of the card grid: with the fix disabled the sprung fan's pixels show the cover of the card above (the reported bug); with the fix they show the fan. Also verified the raise holds during retraction, drops after 0.5s, and triggers on keyboard focus. `npm run lint` and `npm run build` pass.
