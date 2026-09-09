// A section's actions — "+ note" and Speak — as pills that stay visible
// (SPEC.md §6), the same in the notes tray and on the notes full page.
export const SECTION_ACTION =
  "inline-flex shrink-0 items-center gap-1 rounded-full bg-clay-100 px-2.5 py-1 text-[11px] font-semibold text-clay-800 hover:bg-clay-200";

// Writing a note is the section's main action, so it is the biggest control in
// the row: a filled pill with a plus, never a hairline chip (SPEC.md §6).
export const SECTION_ADD_NOTE =
  "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-clay px-3.5 py-1.5 text-[12.5px] font-semibold text-clay-fg shadow-soft hover:bg-clay-600";
