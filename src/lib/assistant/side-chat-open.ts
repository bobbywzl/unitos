// A side chat open in the reader (SPEC.md §7), or version history open over a
// blank document (§29). The workspace folds the right tray while one is on
// screen, so it has the room, and unfolds it when both are gone — the fold a
// floating note makes, for the same reason. A module store, not a context:
// both sit deep inside the pane and the tray is the workspace's.

type Opener = "side chat" | "versions";

const open = new Set<Opener>();
const listeners = new Set<() => void>();

function setOpen(opener: Opener, next: boolean) {
  if (open.has(opener) === next) return;
  if (next) open.add(opener);
  else open.delete(opener);
  for (const listener of listeners) listener();
}

export const setSideChatOpen = (next: boolean) => setOpen("side chat", next);
export const setVersionsOpen = (next: boolean) => setOpen("versions", next);

/** The tray folds: a side chat or version history is open. */
export function readTrayFold(): boolean {
  return open.size > 0;
}

export function subscribeTrayFold(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
