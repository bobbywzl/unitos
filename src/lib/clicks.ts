// Click telemetry (SPEC.md §7): the vocabulary shared by the client tracker
// (components/click-tracker.tsx), the API route (/api/clicks), and the admin
// clicks page (/admin/clicks). A surface is where a control lives; a control
// is one button or link, named by its data-track attribute. Regions carry
// data-track-surface; a control outside a marked region records nothing.
//
// Keep this file dependency-free — the server pages and the client both
// import it.

export const CLICK_SURFACES = [
  "topbar", // the workspace header: documents, share, history, context, guide
  "sidebar", // the rail: assistant, notes, distill, graph, annotations, edits, more
  "ai-toolbar", // the selection popover: explain, simplify, extract, comment, link, highlight, add to notes, read aloud
  "article-menu", // the floating menu at the top left: frequent asks, search, distill
  "reader", // the article itself: distill button, edit toolbar, tool cards, distilled page, pages, video pane
  "tray", // the notes tray: notes, assistant, distill, annotations, and edits tabs
] as const;

export type ClickSurface = (typeof CLICK_SURFACES)[number];

export function isClickSurface(value: unknown): value is ClickSurface {
  return typeof value === "string" && (CLICK_SURFACES as readonly string[]).includes(value);
}

// A control id: lowercase letters, digits, "-" and ":" ("format:h1"), at most
// 64 characters. The client drops anything else before it is sent.
export const CLICK_CONTROL_PATTERN = /^[a-z0-9][a-z0-9:-]{0,63}$/;

export type ClickRecord = {
  surface: ClickSurface;
  control: string;
  notebookId?: string;
};

// One POST carries at most this many clicks.
export const CLICK_BATCH_MAX = 200;

// The daily cron deletes rows older than this.
export const CLICK_RETENTION_DAYS = 180;
