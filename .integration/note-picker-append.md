# note-picker-append

**Intent:** Give Add to notes in the reader the two pieces it needs to put a highlighted passage and the reader's comment into an existing note: `append` on `PATCH /api/notes/[noteId]`, and `NotePicker`, the searchable list of the project's accepted notes, extracted from the annotation menu so both draw one list.

**Files:**
- `src/app/api/notes/[noteId]/route.ts` — `append` in `patchSchema`: the note's text, one blank line, the words (an empty note becomes the words). The 50,000 cap on the result (400 `api.noteTooLong`), `content` and `append` together a 400 (`api.appendWithContent`). The write is the `content` path: same editor check, gist cleared, edit recorded, project bumped. The quote-to-source deletion runs only for a whole replacement.
- `src/lib/i18n/dict/api.ts` — `appendWithContent` and `noteTooLong`, English and Chinese.
- `src/components/reader/note-picker.tsx` — new: `NotePicker({ sections, onPick, disabled, track? })`, with `flatSections`, `noteLine`, and `menuRowClass` exported. The search field, the sections' labels, the rows, and the empty line are the annotation menu's; the list scrolls inside `max-h-44`.
- `src/components/panels/annotation-menu.tsx` — the notes mode draws `NotePicker`; `flatSections` and the row class come from the picker. The menu lost its own query state (the picker holds it and resets on unmount).

**Decisions:**
- Trailing newlines of the old text fold into the one blank line (`note.content.replace(/\n+$/, "")`), so an append never leaves two blank lines; no word is dropped. Trailing spaces are kept.
- The cap on `append` itself is 50,000 in the schema; the total is checked in the handler before any write, so a refused append adds no source either.
- `NotePicker` takes `track` (default `add-to-note-pick`) so the annotation menu keeps `annotation-add-to-note-pick` and the admin clicks page keeps its count under the old name. Dropping the prop and letting both share one name was the other option.
- The annotation menu's list went from `max-h-64` to the picker's `max-h-44`, to keep one component with one look rather than a height prop.
- The picker's rows keep `role="menuitem"`, since the annotation menu is a `role="menu"`; the reader toolbar can live with it or the role can move to a prop.
