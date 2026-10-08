// One shape for the assistant's Send, Accept, and Reject on every surface
// (SPEC.md §7): the plan, the note's assistant, the bar's suggestions row,
// every assistant box. Accept is filled and Reject outlined, one height;
// on a touch screen each grows to a finger's size.
export const SEND_CLASS =
  "rounded-full bg-clay px-3 py-1.5 text-[11px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40 pointer-coarse:py-2";
export const ACCEPT_CLASS =
  "rounded-full border border-transparent bg-clay px-3 py-1 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40 pointer-coarse:py-1.5";
export const REJECT_CLASS =
  "rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800 pointer-coarse:py-1.5";
