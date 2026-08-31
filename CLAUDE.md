# CLAUDE.md

## Text Production Style (applies to ALL text you write: UI copy, prompts, docs, comments, commit messages, and AI prompt templates in /lib/prompts/)

Do not use different phrases and sentence structures for the sake of using different phrases and sentence structures. The goal is to be simple, concise, and straight to the point — most easily interpretable and suitable for the target audience.

Concretely:

1. **Repetition of the right word beats variation.** If "note" is the correct term, write "note" every time. Never rotate through synonyms (annotation, entry, item, snippet) to avoid repeating a word. Synonym rotation forces the reader to check whether two words mean two things.
2. **One term per concept, everywhere.** The vocabulary is fixed: project (one binding of documents; the dashboard collection is Projects; code identifiers keep `notebook`/`corpus`), section, note, source, anchor, block, derivation, pending, accepted, distillation (one question and its quotes), quote, caption, extraction (one origin phrase and its revealing passages), digest (the stored project context the assistant reads: one row per project per user), share, collaborator (a person a project is shared with), role (owner / editor / viewer), person (the badge: name, symbol, color, picture), profile (the account's own settings page section), background (the one context field injected into prompts), reply (one entry in the discussion under a note, an edit, or a link; resolve closes one), account (the signed-in identity), recommended link (an AI-proposed link awaiting Accept), graph (the project's documents and links drawn as nodes and curves), history (the project's record of edits and deletions). Use these exact words in UI, code, prompts, and docs. Never introduce a second name for an existing concept. The same rule holds in Chinese: the zh glossary at the top of `src/lib/i18n/dict/common.ts` fixes one Chinese term per concept — every namespace keeps to it.
3. **Default to the same sentence structure for parallel content.** Error messages, empty states, tooltips, and prompt instructions that do parallel jobs should have parallel structure. Uniformity is a feature, not a flaw.
4. **Cut preamble and postamble.** No "Let's dive in", no "In summary", no restating what was just said. Start with the point.
5. **Short sentences. Concrete words.** Prefer "Click a source chip to jump to the highlight" over "Selecting the associated source indicator will navigate the user to the corresponding highlighted region."
6. **Casual is fine; vague is not.** Plain conversational language is acceptable when it carries a precise, logical point. Never trade precision for polish.
7. **Prompt templates follow the same rules.** Instructions to the model should be blunt, ordered, and unadorned. No elegant variation inside prompts — repeated exact terms improve model compliance.

## Project Conventions

- Read SPEC.md before writing any code. It is the source of truth for data model, phases, and quality bars.
- Build in the exact phase order in SPEC.md §8. Do not start a phase before the previous phase's "Done when" criteria pass.
- The derivation pipeline (SPEC.md §4) is one code path. Never fork it per feature. New features = new prompt template + destination handler only.
- Anchors: dual strategy per SPEC.md §5. DOM ranges are never persisted.
- All AI output destined for notes is `status: PENDING` until user accepts. No exceptions.
- TypeScript strict mode. No `any`. Zod-validate every API request body and every LLM JSON output.
- Prompt templates live in `/lib/prompts/`, one file per DerivationType, each exporting a single function `(ctx) => string`.
- Keep components small; server components by default, client components only where interaction requires it.
- After each phase, run the app and verify the "Done when" criteria manually before moving on. State plainly which criteria pass and which do not.
- Deploys: Vercel builds `main`. After the user accepts a change, push it to `main` — the user has standing instructions to auto-deploy accepted work.
