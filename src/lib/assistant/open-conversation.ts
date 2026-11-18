// A conversation of the sidebar assistant opened from outside the panel
// (SPEC.md §7): its card in the Annotations tab leads back to it. The panel
// is drawn only while the tray shows the assistant, so the request waits
// here: the workspace opens the tray on the assistant, and the panel takes
// the request when it is drawn, or at once when it already is.

export const OPEN_CONVERSATION_EVENT = "dissect:open-conversation";

let requested: string | null = null;

/** Ask for the conversation saved on this note to open in the assistant. */
export function requestConversation(noteId: string): void {
  requested = noteId;
  window.dispatchEvent(new Event(OPEN_CONVERSATION_EVENT));
}

/** The conversation asked for, once: the panel that takes it opens it. */
export function takeRequestedConversation(): string | null {
  const noteId = requested;
  requested = null;
  return noteId;
}
