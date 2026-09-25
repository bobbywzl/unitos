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
  "ai-toolbar", // the selection popover: define, assistant, explain, simplify, visualize, comment, link, highlight, add to notes, read aloud
  "article-menu", // the floating menu at the top left: the contents
  "reader", // the article itself: distill button, edit toolbar, tool cards, distilled page, pages, video pane
  "tray", // the notes tray: notes, assistant, distill, annotations, and edits tabs
] as const;

export type ClickSurface = (typeof CLICK_SURFACES)[number];

export function isClickSurface(value: unknown): value is ClickSurface {
  return typeof value === "string" && (CLICK_SURFACES as readonly string[]).includes(value);
}

// One row is not a click: `lead-predicted:<tool>` on the ai-toolbar surface
// is the lead tool Jev predicted for a selection (/api/jev/lead-tool), written
// by the server beside the click it tried to predict, so the hit rate reads
// from this log. The admin page's groups leave it out; the Jev routes skip
// it when they read a reader's history.
//
// A control id: lowercase letters, digits, "-" and ":" ("format:h1"), at most
// 64 characters. The client drops anything else before it is sent. The part
// after ":" is the control's type or source where it has one: a highlight's
// color (highlight:clay), an ask's scope (assistant-ask:notebook), a task
// (assistant-task:gaps), a summary depth (assistant-recommended:layman), a
// note format (note-format:h1).
export const CLICK_CONTROL_PATTERN = /^[a-z0-9][a-z0-9:-]{0,63}$/;

// The functions the admin clicks page reports (SPEC.md §7): what readers do
// with the AI tools, with notes, and with annotations. Every other control —
// navigation, dialogs, video playback, the article edit toolbar, closes and
// cancels — still records, but the page leaves it out.
export const CLICK_GROUPS = ["ai", "notes", "annotations"] as const;
export type ClickGroup = (typeof CLICK_GROUPS)[number];

// The control ids of each group. An id ending in ":" is a prefix: "highlight:"
// covers highlight:clay, highlight:sage, and every other color.
const CLICK_FUNCTIONS: Record<ClickGroup, readonly string[]> = {
  ai: [
    // the AI toolbar
    "define",
    "explain",
    "simplify",
    "assistant-run", // a question or a command about the selection
    "assistant-command:", // a command chip: assistant-command:shorten, assistant-command:formal
    "read-aloud",
    // the article menu's asks: ask:summarize, ask:key-takeaways, ask:explain-simply
    "ask:",
    // the assistant panel: the scope asked, the task run, the summary depth
    "assistant-ask:",
    "assistant-web:",
    "assistant-thinking:",
    // highlighting an assistant answer: the side chat, the quoted question,
    // the comment
    "assistant-side-chat-start",
    "assistant-side-chat-open",
    "assistant-quote-ask",
    "assistant-answer-comment",
    "assistant-comment-send",
    "assistant-task:",
    "assistant-recommended:",
    "assistant-regenerate",
    // the row under a command's suggestions (SPEC.md §29)
    "assistant-suggestions:review",
    "assistant-suggestions:accept-all",
    "assistant-suggestions:reject-all",
    // the rating of a tool's output: rate:<tool>:up, rate:<tool>:down, rate:<tool>:comment
    "rate:",
    // extract (distill) runs
    "distill-page-run",
    "distill-corpus-run",
    // collapse (SPEC.md §28): the button, and a block read whole or folded again
    "collapse",
    "collapse-off",
    "collapse-expand",
    "collapse-fold",
    // handwritten pages
    "page-ask",
    "page-explain",
    "convert-to-text",
    "convert-again",
    "convert-retry",
    // analyze a figure or table; visualize a selection; compare two documents; translate
    "analyze",
    "visualize",
    "visualize-open",
    "document-compare",
    "translate",
    // video
    "video-explain",
    "video-line-explain",
    "video-ask",
    "video-ask-add-note",
    "video-assistant-send",
    "video-skill-article",
    "video-skill-notes",
    "video-article-regenerate",
    // recommended links
    "document-recommend-links",
  ],
  notes: [
    "voice-note",
    "voice-note-stop",
    "notes", // the notes tab opened
    "notes-full-page",
    "more-notes-full-page",
    "section-add-note",
    "note-compose-save",
    "note-edit",
    "note-save",
    "note-wrap",
    "note-dock",
    "note-accept",
    "note-reject",
    "undo-reject",
    "note-delete",
    "note-copy",
    "note-source",
    "note-jump",
    "notes-pin",
    "note-unpin",
    "notes-merge",
    "notes-delete",
    "note-collapse",
    "notes-view:", // the notes view switched: notes-view:expanded, notes-view:collapsed
    "note-id-copy",
    "notes-compare",
    "note-format:",
    "note-style:",
    "note-text-color",
    "note-indent",
    "note-outdent",
    // notes made from elsewhere
    "add-to-notes",
    "add-to-notes-section",
    "distill-page-add-to-notes",
    "distill-corpus-add-to-notes",
    "video-find-add-note",
    "assistant-note-chip",
  ],
  annotations: [
    "highlight:", // a highlight in a color, a comment riding on it or not
    "comment-save", // a comment with no highlight
    "comment-card-save",
    "annotation-recolor:",
    "annotation-save",
    "annotation-delete",
    "annotation-collapse",
    "annotations-view:", // the annotations view switched: annotations-view:expanded, annotations-view:collapsed
    "close-link", // the second end of a link: the link is made
    "link-accept", // a recommended link accepted
    "page-highlight:",
    "page-comment",
    "video-save-annotation",
  ],
};

const GROUP_OF = new Map<string, ClickGroup>(
  CLICK_GROUPS.flatMap((group) => CLICK_FUNCTIONS[group].map((id) => [id, group] as const)),
);

// The group a control reports under; null for a general control.
export function clickGroupOf(control: string): ClickGroup | null {
  const exact = GROUP_OF.get(control);
  if (exact) return exact;
  const colon = control.indexOf(":");
  return colon > 0 ? (GROUP_OF.get(control.slice(0, colon + 1)) ?? null) : null;
}

export type ClickRecord = {
  surface: ClickSurface;
  control: string;
  notebookId?: string;
};

// One POST carries at most this many clicks.
export const CLICK_BATCH_MAX = 200;

// The daily cron deletes rows older than this.
export const CLICK_RETENTION_DAYS = 180;
