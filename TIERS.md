# Unitos tiers

Three tiers: **Unitos Free**, **Unitos Premium**, **Unitos Ultra**.

This file is the record of every tier decision, kept as it is made, so the
payment structure can be lifted from it whole when billing is built. Nothing
here is a plan or a proposal: each line is either a decision the owner stated
(dated, in their words' meaning) or the behavior the code has today. A feature
nobody has assigned to a tier is listed under **Unassigned** rather than
guessed at.

Today there is no billing. The flag is `User.premium` (a boolean), set by the
operator on the account; the single local reader (sign-in off) always has it.
Three tiers will need a `tier` column in its place — Free, Premium, Ultra —
and every check below written against that.

## Unitos Free

| Feature | Limit |
|---|---|
| Reading, notes, anchoring, export | Whole |
| Documents: PDF, web page, image, video, audio | Whole |
| AI: derivations, assistant, distill, extract, glossary, conversion | Whole |
| Sharing and collaboration | Whole |
| Images dropped into a note or into the reader's edit mode | Up to 5 MB per image (`FREE_IMAGE_BYTES`, `lib/images.ts`) |
| Offline work | Not available: an offline write fails with the plain offline message |

## Unitos Premium

| Feature | Limit |
|---|---|
| Everything in Free | Whole |
| Offline work (SPEC.md §17) | Note edits, note create and delete, section renames and reorders, replies, block text edits and deletes, highlights and comments, and content uploads queue in IndexedDB and sync when the browser is back online |
| Large images dropped into a note or into the reader's edit mode | 5 MB to 25 MB per image (`MAX_IMAGE_BYTES` caps every tier) |
| Video dropped into a note or into the reader's edit mode | Not built yet: a video dropped anywhere is still added as a video document, which is Free today |

## Unitos Ultra

Nothing assigned yet.

## Unassigned

Everything not named above sits in Free today because that is what the code
does. Naming a tier for any of it is a decision, not a cleanup: leave it here
until the owner makes one.

- Document count per project, project count per account, storage in total
- AI usage: calls per day, which model answers, the digest's size budget
- Video length and transcription minutes
- Google Drive import
- Admin surfaces (already gated by `ADMIN_PASSWORD`, not by tier)
- Translation (SPEC.md §19): DeepL bills per character — $25 per million on the Pro API, 500k a month free on the Free API — and a document translates once per language. A characters-per-month cap, or the feature itself, is a natural Premium line; nobody has drawn it
- The assistant's web access (SPEC.md §7): each answer with Web on can run up to five searches at $0.01 each on top of the tokens
- Figure and table analysis (SPEC.md §4): runs on the most capable model, the most expensive call per use in the app
- Voice notes (SPEC.md §6): transcription minutes, like video
- Compare two documents and Ask about a range: tokens like every derivation

## Open questions

- **The free image cap.** "Relatively small photos" was the owner's phrase.
  Built at 5 MB per image — a phone photo is 2 to 5 MB, a screenshot well
  under — with 25 MB the ceiling for every tier. Confirm or move either.
- **Video inside a note or a paragraph.** Nothing plays inside a note today,
  so there is nothing to gate: a dropped video is added as a video document,
  as it always was, and that is Free. Say whether video documents themselves
  should become Premium, or whether this was only about video inside a note.

## Decisions, as they were made

- **2026-09-04** — Three tiers: Unitos Free, Unitos Premium, Unitos Ultra.
  Differences to be decided over time; each one lands here when it is stated.
- **2026-09-04** — Images drop into a note and into the reader's edit mode.
  Small images are Free; larger images and video of any kind are Premium.
- **before this file** — Offline work is Premium (SPEC.md §17).
