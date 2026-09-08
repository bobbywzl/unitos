# claude/unitos-ultra-visualize-n6wq2n

**Intent:** Add Visualize (Unitos Ultra): the selection as a picture, drawn on Claude Fable 5.1 only when the model is certain the picture carries the passage's core idea; simplify the tiers to Unitos Premium and Unitos Ultra with a two-month Premium trial for new accounts; and add the bimonthly model update cron that moves each model to the newest version its provider publishes.

**Files:**
- `prisma/schema.prisma`, `prisma/migrations/20260907150000_tier_type`, `…150100_tiers_premium_ultra`, `…150200_visualize_derivation`, `…150300_model_choice` — `Tier` enum, `User.tier` and `User.trialEndsAt` replace `User.premium` (carried over: premium = granted, else a trial from `createdAt`); `VISUALIZE` derivation type; `ModelChoice` table.
- `src/lib/tiers.ts` — `trialEnd`, `tierState`, `premiumActive`, `ultraActive`; no server imports.
- `src/lib/auth.ts`, `src/lib/account-reset.ts`, `src/app/api/images/route.ts`, `src/app/settings/page.tsx`, `src/components/settings-form.tsx`, `src/app/admin/accounts/page.tsx`, `src/components/collab/collab-context.tsx`, `src/app/n/[notebookId]/page.tsx`, `src/app/n/[notebookId]/notes/page.tsx` — read the tier instead of the flag; `CollabState.ultra`; Settings shows Plan; admin shows the tier chip.
- `src/lib/models.ts`, `src/lib/model-update.ts`, `src/lib/kimi.ts`, `src/lib/claude.ts`, `src/lib/video/gemini.ts`, `src/lib/derive/config.ts`, every `kimi(`/`claude(` call site (now awaited), `src/app/api/cron/models/route.ts`, `src/app/api/admin/models/route.ts`, `src/components/admin/model-check.tsx`, `src/app/admin/page.tsx`, `vercel.json` — the model registry, the update job, the cron on the 1st of every second month, the admin Models section with Check now.
- `src/lib/prompts/visualize.ts`, `src/lib/prompts/index.ts`, `src/lib/derive/visualize.ts`, `src/app/api/derive/route.ts`, `src/app/api/images/[imageId]/route.ts` — the VISUALIZE template, output contract, diagram layout, SVG reduction, the route branch behind the heartbeat stream, the SVG served with a CSP.
- `src/components/reader/reader-interactions.tsx`, `src/components/reader/block-view.tsx`, `src/components/panels/annotations-panel.tsx`, `src/components/icons.tsx`, `src/lib/types.ts`, `src/lib/clicks.ts`, `src/lib/i18n/dict/*` — the Visualize tool, the card (declined state, Open link), the mark symbol, the Visualizations group, strings in both languages.
- `SPEC.md` (§2, §4, §16, §17, new §20), `TIERS.md`, `README.md`, `.env.example`, `CLAUDE.md` — docs.

**Decisions:**
- "Bimonthly" read as every two months (`0 9 1 */2 *`), not twice a month.
- The model update moves a role only within its family at the same id shape (`claude-<name>-<version>`, `kimi-k<version>`, `gemini-<version>-flash`), after one probe call; a differently shaped id is another product. The registry is a table read by the clients, not a code edit.
- A diagram is a spec the server lays out with measured text, not model-drawn SVG, so labels never overflow; a picture or an animation is model SVG reduced to an allowlist.
- A declined visualization persists nothing; the card shows the model's reason and points at the assistant, Explain, and Simplify.
- The expired trial keeps everything but offline work and large images (the old Free limits); what else closes is left as an open question in TIERS.md.
- The Visualize tool shows to every account; a non-Ultra click gets the plain Ultra message (no billing exists to send anyone to).
