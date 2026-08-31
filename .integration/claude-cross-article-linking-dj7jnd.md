# claude/cross-article-linking-dj7jnd

**Intent:** Make manual linking work across documents — a pending link now survives switching to another document, and a highlight made while a link is pending shows a Close link button at its end instead of auto-creating the link.

**Files:**

- `src/components/reader/reader-interactions.tsx` — the whole change. (1) Persistence: the pending link writes through to sessionStorage (`unitos-pending-link`, scoped by notebookId) on every set/clear, and a mount effect restores it — switching documents remounts the reader (pane keyed by document id), which is why links only ever closed inside one article or an already-open split view. (2) The chip: with a link pending, selection capture no longer calls `completeLinkTo` directly; it stores the anchor plus the end-of-highlight coordinates (new `endLeft`/`endTop` on the `Popover` type, from the selection's last client rect) and renders a Close link chip there. The chip is cleared on Escape, click-away, document switch, link completion, and pending-link cancellation (including from the other pane, via the existing window event).
- `src/lib/i18n/dict/reader.ts` — renamed `linkHere` to `closeLink` ("Close link" / "闭合链接") and updated `linkingBanner` and `completeLinkToast` to name that button, en and zh.

**Decisions:**

- sessionStorage over localStorage: an in-progress gesture is tab-scoped; a leftover from another tab or a past session should not arm linking forever. Reads/writes wrapped in try/catch so blocked storage degrades to the old in-memory behavior.
- The store is scoped to the notebook: a pending link never restores inside another project. It does survive a full page reload within the tab — deliberate, and the banner's ✕ always cancels.
- Replaced the auto-complete-on-selection entirely rather than keeping it alongside the chip: instant creation on any selection was itself an instability (accidental selections created links). The popover's "Link here" option stays (relabeled Close link) for the cross-pane and figure/term-popover cases.
- "Close link" as the one term for completing (user's words, and it matches the existing broken-chain → closed-chain icon vocabulary in block-view); zh 闭合链接. The dict key renamed with it.
- Verified end to end with Playwright against a seeded two-document project: begin in A → switch via document bar → banner survives → highlight in B → chip at highlight end → link created, marks paint and navigate both ways; also hard-reload persistence, ✕ cancel clearing the store, and no chip without a pending link. `lint`, `tsc --noEmit`, and `next build` pass.
