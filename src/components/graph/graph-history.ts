// The graph as a step in the browser's history (SPEC.md §13): it fills the
// screen like a page, so Back closes it and leaves the document open. Opening
// the graph pushes one entry at the same address; Back, the close button,
// and Escape take that entry off; a document opened from the graph replaces
// it, so Back from that document returns to the one read before.

type Router = { push: (href: string) => void; replace: (href: string) => void };

// Whether the graph's entry is the browser's current entry, and how many
// graphs are mounted (a development re-run mounts one twice).
let graphEntry = false;
let mounted = 0;

/** The graph opened: push its entry (once, though a development re-run
    mounts it twice). Calls `onBack` when Back takes the entry off. Returns
    the cleanup. */
export function enterGraphHistory(onBack: () => void): () => void {
  if (!graphEntry) {
    window.history.pushState(window.history.state, "");
    graphEntry = true;
  }
  const onPop = () => {
    if (!graphEntry) return;
    graphEntry = false;
    onBack();
  };
  window.addEventListener("popstate", onPop);
  mounted++;
  return () => {
    window.removeEventListener("popstate", onPop);
    mounted--;
    // Closed some other way, its entry still on top: take it off, so Back
    // does not land on the same document twice.
    setTimeout(() => {
      if (mounted === 0 && graphEntry) {
        graphEntry = false;
        window.history.back();
      }
    }, 0);
  };
}

/** Close the graph from inside it: take its entry off (Back's popstate then
    closes it), or close it at once when there is no entry. */
export function leaveGraphHistory(close: () => void): void {
  if (graphEntry) window.history.back();
  else close();
}

/** Open an address from the graph: it takes the graph's entry's place. */
export function graphNavigate(router: Router, href: string): void {
  if (graphEntry) {
    graphEntry = false;
    router.replace(href);
  } else router.push(href);
}
