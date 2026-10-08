// [style7] One look per role across the graph's panels: the node card, the
// link panel, the side lists, Find, and the key. A control that does the same
// job looks the same everywhere (VIEW7-01..04). Sizes: 24 px under a mouse;
// under a finger a row action is 44 px (WALK6-09), ✕ and a lead button 40, a
// document chip 32.

/** An h3 takes Caprasimo from globals.css (unlayered, so a utility class cannot
    override it): a panel head that is an h3 adds this style. */
export const HEAD_PLAIN = { fontFamily: "inherit", fontWeight: 700, letterSpacing: "0.06em", lineHeight: "inherit" } as const;

/** A section head inside a panel: LINKS, NOTES, WHY THIS LINK, 1 NOTE ON THIS LINK. */
export const SECTION_HEAD = "text-[11px] font-bold tracking-[0.06em] text-sand-600 uppercase";

const ACTION_BASE =
  "inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap disabled:opacity-40 pointer-coarse:min-h-11 pointer-coarse:px-3.5";

/** A row action: Reply, Note on this link, Add to note, Open in reader, Dismiss, Gaps only, Waiting on you, Scan for links. */
export const ACTION = `${ACTION_BASE} border-line text-sand-700 hover:bg-clay-100 hover:text-clay-800`;
/** A note action (Add to note, Note on this link): note actions light sage, the notes' colour. */
export const ACTION_NOTE = `${ACTION_BASE} border-line text-sand-700 hover:bg-sage-100 hover:text-sage-800`;
/** A note action that is on: the quote is in the new note. */
export const ACTION_NOTE_IN = `${ACTION_BASE} border-sage-400 bg-sage-100 text-sage-800`;
/** The same action, pressed (a filter that is on). */
export const ACTION_ON = `${ACTION_BASE} border-clay-400 bg-clay-100 text-clay-800`;
/** Remove: the same shape, in red, as the reader's Remove. */
export const ACTION_DANGER = `${ACTION_BASE} border-line text-red-600 hover:bg-red-50 hover:text-red-700`;
/** Accept: the same shape, filled sage. Its border keeps it as tall as Dismiss beside it. */
export const ACTION_ACCEPT = `${ACTION_BASE} border-sage-600 bg-sage-600 text-sage-fg hover:border-sage-700 hover:bg-sage-700`;

/** A panel's lead actions: Open in reader and Pick for Stitch on the node card, Ask Stitch in Find. */
export const LEAD = "inline-flex min-h-8 items-center rounded-full border px-3.5 text-[12px] font-semibold pointer-coarse:min-h-10";
export const LEAD_PRIMARY = `${LEAD} border-clay bg-clay text-clay-fg hover:bg-clay-600`;

/** A document's name as a chip that opens or shows it. */
export const DOC_CHIP =
  "inline-block min-w-0 truncate rounded-full bg-sand-200 px-2.5 text-[11px] leading-6 font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 pointer-coarse:leading-8";

/** ✕ on a panel or a list. */
export const CLOSE =
  "flex size-7 shrink-0 items-center justify-center rounded-full text-[16px] text-sand-500 hover:bg-clay-100 hover:text-clay-700 pointer-coarse:size-10";

/** A text link inside a line (Show them, Notes full page, Turn it on, N more):
    its hit area grows to 24 px (40 under a finger) and the line keeps its height. */
export const TEXT_HIT = "-my-1 inline-block py-1 pointer-coarse:-my-3 pointer-coarse:py-3";
