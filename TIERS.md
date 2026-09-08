# Unitos tiers

Two tiers: **Unitos Premium** and **Unitos Ultra**. There is no free tier: a
new account gets Unitos Premium free for two months, and the operator grants
a tier for good after that.

This file is the record of every tier decision, kept as it is made, so the
payment structure can be lifted from it whole when billing is built. Nothing
here is a plan or a proposal: each line is either a decision the owner stated
(dated, in their words' meaning) or the behavior the code has today. A feature
nobody has assigned to a tier is listed under **Unassigned** rather than
guessed at.

Today there is no billing. The columns are `User.tier` (`PREMIUM` | `ULTRA`,
default `PREMIUM`) and `User.trialEndsAt` (`lib/tiers.ts`): a new account gets
`trialEndsAt` two months out; the operator grants Premium for good by clearing
it, or Ultra by setting the tier. Past `trialEndsAt` on `PREMIUM` the account
is **expired**: Premium features gate until the operator extends or grants
(`premiumActive`). Ultra never expires (`ultraActive`). The single local reader
(sign-in off) is Ultra: there is no account to gate.

## Where the tier is set

The admin accounts page (`/admin/accounts`, `ADMIN_PASSWORD`) has a Tier
control on every account (`components/admin/tier-control.tsx`, `POST
/api/admin/accounts/tier`): Unitos Ultra, Unitos Premium for good, or Unitos
Premium on a trial until a date. A past date ends the trial now. Nothing else
writes the tier: sign-in never changes it, and Reset account puts the account
back on a new trial like a new account.

## Where the tier is read

One path. Every server gate reads `User.tier` and `User.trialEndsAt` off the
session's user row on each request (`ultraActive`, `premiumActive`), so a
tier the admin sets holds on the very next request. Every page reads the same
row once through `accountTier` (`lib/tiers.ts`): the reader and the notes page
put it in `CollabState` (`tier`, `trialEndsAt`, `premium`, `ultra`), the
dashboard and Settings read it directly. A page loaded before the change
still carries the old tier until it reloads: the client's gate (the toast on
Visualize or Continue) is a courtesy, the route is the gate.

## How the tier shows

The tier mark is one symbol per tier, drawn once (`components/tier-mark.tsx`)
and shown at every size: **the white crystal is Unitos Premium** (a quartz
point in white and pale sand; hollow when the trial ended and nothing was
granted) and **the black diamond is Unitos Ultra** (a brilliant cut in
obsidian with a gold hairline). It sits at the corner of the person's badge
(`PersonBadge`, on a badge 24 px or larger: the dashboard header, Settings,
presence, the share dialog, the admin accounts page), so the tier reads
beside the profile the way a verified badge does on X or a star does on
Telegram Premium. `Person.tier` carries it; `personOf` fills it from the
user row.

Around the mark, each tier has one material, used the same way everywhere:
Ultra is obsidian and gold, Premium is pearl, expired is plain sand. The tier
chip (mark and name, one pill) sits beside the badge in the dashboard header,
in the reader header (to Settings), and on the admin accounts page; the plan
card in Settings is the same material at full size with the tier's name as
its title and what the tier holds under it; a hairline band in the material
runs along the top of the dashboard and the reader. Ultra is the richer of
the two on purpose; Premium is the same idea, toned down. Inside the reader,
Visualize's toolbar row and the Continue button carry the black diamond
beside the word Ultra when the account is not Ultra.

## The trial

| | |
|---|---|
| Who | Every new account (`lib/auth.ts` sets `trialEndsAt` on create; a reset account starts a new trial) |
| What | Unitos Premium, whole |
| How long | Two months (`TRIAL_MONTHS`, `lib/tiers.ts`) |
| After | Expired: offline changes do not save, images over 5 MB do not drop, until the operator grants a tier |

## Unitos Premium

| Feature | Limit |
|---|---|
| Reading, notes, anchoring, export | Whole |
| Documents: PDF, web page, image, video, audio | Whole |
| AI: derivations, assistant, distill, extract, glossary, conversion | Whole |
| Sharing and collaboration | Whole |
| Offline work (SPEC.md §17) | Note edits, note create and delete, section renames and reorders, replies, block text edits and deletes, highlights and comments, and content uploads queue in IndexedDB and sync when the browser is back online |
| Images dropped into a note or into the reader's edit mode | Up to 25 MB per image (`MAX_IMAGE_BYTES`, `lib/images.ts`) |
| Video dropped into a note or into the reader's edit mode | Not built yet: a video dropped anywhere is still added as a video document |

## Unitos Ultra

| Feature | Limit |
|---|---|
| Everything in Premium | Whole |
| Visualize (SPEC.md §20) | The selection as a picture — a directed diagram, a drawing, or a short animation — on Claude Fable 5.1 at its highest effort; declined with the reason when the model is not certain the picture carries the passage's core idea |
| Tool conversations (SPEC.md §21) | Continuing an Explain, Simplify, Analyze, or Visualize card's output into a conversation (Explain+, Simplify+, …). Offered to every account at the end of the tool's output; a non-Ultra press answers with the plain Ultra message, like Visualize, and the route answers 403 |

## Expired (trial ended, nothing granted)

| Feature | Limit |
|---|---|
| Reading, notes, anchoring, export, documents, AI, sharing | Whole — the code gates none of these today |
| Offline work | Not available: an offline write fails with the plain offline message |
| Images dropped into a note or into the reader's edit mode | Up to 5 MB per image (`FREE_IMAGE_BYTES`, `lib/images.ts`) |

## Unassigned

Everything not named above is ungated today because that is what the code
does. Naming a tier for any of it is a decision, not a cleanup: leave it here
until the owner makes one.

- Document count per project, project count per account, storage in total
- AI usage: calls per day, which model answers, the digest's size budget
- Video length and transcription minutes
- Google Drive import
- Admin surfaces (already gated by `ADMIN_PASSWORD`, not by tier)
- Translation (SPEC.md §19): DeepL bills per character — $25 per million on the Pro API, 500k a month free on the Free API — and a document translates once per language. A characters-per-month cap, or the feature itself, is a natural Premium line; nobody has drawn it
- The assistant's web access (SPEC.md §7): each answer with Web on can run up to five searches at $0.005 each on top of the tokens
- Figure and table analysis (SPEC.md §4): runs at the model's highest reasoning effort, the most expensive call per use in the app
- Voice notes (SPEC.md §6): transcription minutes, like video
- Compare two documents and Ask about a range: tokens like every derivation
- What an expired account keeps: today only offline work and large images close. Whether AI, documents, or sharing close too when the trial ends is undecided

## Open questions

- **The expired account.** The trial ends and nothing is granted: today the account keeps everything but offline work and large images. Say what else closes, if anything.
- **The image cap after the trial.** 5 MB per image, 25 MB the ceiling for every tier. Confirm or move either.
- **Video inside a note or a paragraph.** Nothing plays inside a note today, so there is nothing to gate: a dropped video is added as a video document. Say whether video documents themselves should become Premium, or whether this was only about video inside a note.

## Decisions, as they were made

- **2026-09-08** — The tier shows everywhere the account shows. Unitos
  Premium is the white crystal, Unitos Ultra is the black diamond, beside the
  person's badge; Ultra's surfaces feel premium (obsidian and gold), Premium's
  the same but toned down. The admin sets any account's tier from the
  accounts page. The tier is read through one path on every surface.

- **2026-09-07** — Two tiers: Unitos Premium and Unitos Ultra. The free tier
  is gone. A new account gets Unitos Premium free for two months.
- **2026-09-07** — Visualize is Unitos Ultra (SPEC.md §20).
- **2026-09-08** — Tool conversations are Unitos Ultra (SPEC.md §21):
  continuing an Explain, Simplify, Analyze, or Visualize card into a
  conversation. Gated like Visualize — offered to every account, a non-Ultra
  account sees the mention at the end of every tool's output and gets the
  plain Ultra message on a press, the route answers 403.
- **2026-09-04** — Three tiers: Unitos Free, Unitos Premium, Unitos Ultra.
  Differences to be decided over time; each one lands here when it is stated.
  (Superseded on 2026-09-07: Free is gone.)
- **2026-09-04** — Images drop into a note and into the reader's edit mode.
  Small images are Free; larger images and video of any kind are Premium.
  (Free is now the expired state: the trial and Premium drop up to 25 MB.)
- **before this file** — Offline work is Premium (SPEC.md §17).
