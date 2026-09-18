// A side chat open in the reader (SPEC.md §7). The workspace folds the right
// tray while one is on screen, so the card has the room, and unfolds it when
// the side chat closes — the fold a floating note makes, for the same reason.
// A module store, not a context: the reader's card sits deep inside the pane
// and the tray is the workspace's.

let open = false;
const listeners = new Set<() => void>();

export function setSideChatOpen(next: boolean) {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function readSideChatOpen(): boolean {
  return open;
}

export function subscribeSideChatOpen(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
