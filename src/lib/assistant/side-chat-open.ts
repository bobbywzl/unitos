// Version history open over a blank document (§29). The workspace folds the
// right tray while it is on screen, so it has the room, and unfolds it when it
// is gone — the fold a floating note makes, for the same reason. A side chat
// stays in its card and folds nothing (SPEC.md §7): the article never moves
// under the reader. A module store, not a context: version history sits deep
// inside the pane and the tray is the workspace's.

type Opener = "versions";

const open = new Set<Opener>();
const listeners = new Set<() => void>();

function setOpen(opener: Opener, next: boolean) {
  if (open.has(opener) === next) return;
  if (next) open.add(opener);
  else open.delete(opener);
  for (const listener of listeners) listener();
}

export const setVersionsOpen = (next: boolean) => setOpen("versions", next);

/** The tray folds: version history is open. */
export function readTrayFold(): boolean {
  return open.size > 0;
}

export function subscribeTrayFold(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}
