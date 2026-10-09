# r9-cost9

**Intent:** COST9-05: bump the graph's generation once per change the graph shows, so a reply, link or written page reads the part titles and an open link's passages once, not twice; and verify COST8-06 on d330f124 (the Stitch box sends each answer's record and the back selection takes it), measured, with no code change.

**Files:**
- `src/components/graph/graph-data.tsx`: `GraphOverlayLoader`'s effect remembers whether the fetch began with a rev bump (`revMoved`) and bumps on its 200 only when it did not. The first open, the provenance switch and Retry keep their bump. Header comment extended.
- `scripts/qa/ui-graph-etag.mjs`: the integrator's round 8 fixed copy (`r9/audit/rev/ui-graph-etag.fixed.mjs`: WAIT, service workers blocked, requests attributed to their open) plus, with `DB=<postgres url>`, two phases: a change from another account with the Documents list open reads the titles once; the same with a link open reads its passages once.
- `.integration/r9-cost9.md`: this file.

**Decisions:**
- The check case went into `ui-graph-etag.mjs` (Playwright), not `graph-version-check.ts`: the double read is client behaviour, which an in-process check cannot see. The phases run only with `DB` set, so without it the script is the fixed copy.
- The script's base is the integrator's fixed copy, not the tree's round 7 version: the tree's fails on timing on this base (round 8's note). If the fixed copy is also merged onto the base, the lines agree and git resolves to mine.
- SPEC.md unchanged: it has no sentence on the graph's generation or on the per-change reads, and the reader sees nothing different.
- COST8-06 needed no fix in the route or the box: the box's history builder sends `data.result.record`, the route's schema accepts it, and `stitch.ts:2107` takes the back selection; proved on the dev server with the mock models and re-measured with the harness (RESULT.md). The reading passes were not touched (RETRIEVAL9's).
- The harness copy for the measurement sends an assistant turn's record whenever the result has one, an empty one too, because that is what `stitch-box.tsx` `recordOf` does; the audit's `ctx9.ts` sent only records with links or a page.
- COST9-06, COST9-07 (gist md5), COST9-04, COST9-08 measured, not built, as the brief says (RESULT.md).
