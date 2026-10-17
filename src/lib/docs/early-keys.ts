// Keys typed while Blank document is being made (SPEC.md §15). The POST and
// the page editor's mount take a second or two, and until the editor takes
// the caret a key goes to the page body or presses the dialog's button
// again. From the press until the editor takes the caret, the printable keys
// are kept here, in order (Backspace takes the last one back), and the new
// page puts them at its start, saved like any typing.

const HOLD_MS = 20_000;

let kept = "";
let documentId: string | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, select");
}

function onKey(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (editable(e.target)) return;
  if (e.key === "Backspace") {
    if (!kept) return;
    kept = kept.slice(0, -1);
  } else if (e.key.length === 1) {
    kept += e.key;
  } else {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
}

function stop(): void {
  if (listening) window.removeEventListener("keydown", onKey, true);
  listening = false;
  if (stopTimer) clearTimeout(stopTimer);
  stopTimer = null;
}

/** Blank document pressed: keep the printable keys from now on. */
export function keepEarlyKeys(): void {
  stop();
  kept = "";
  documentId = null;
  listening = true;
  window.addEventListener("keydown", onKey, true);
  stopTimer = setTimeout(stop, HOLD_MS);
}

/** The new document exists: its page takes the kept keys. */
export function earlyKeysFor(id: string): void {
  if (listening) documentId = id;
}

/** The making failed: stop keeping keys, and let them through again. */
export function dropEarlyKeys(): void {
  stop();
  kept = "";
  documentId = null;
}

/** The page of `id` takes the caret: stop keeping keys and hand over the
    ones kept for it ("" when there are none, or they are another page's). */
export function takeEarlyKeys(id: string): string {
  if (documentId !== id) return "";
  stop();
  const text = kept;
  kept = "";
  documentId = null;
  return text;
}

/** Whether keys are kept for the page of `id`: it takes the caret even
    when the focus is not on the page body. */
export function keepingKeysFor(id: string): boolean {
  return documentId === id;
}
