// The reading position of one document pane, and the tray state, across a
// full page load. A note, an annotation, or an AI tool refreshes the page;
// when the refresh turns into a full load (a new deploy makes the next
// refresh one; a dropped response does too) the reader came back at the top
// and the tray reopened on notes (reader report).
//
// The position is the block at the top edge of the pane and its offset from
// the edge, saved per tab and per document. A block, not a pixel count: a
// figure above the position that loads after the restore moves a pixel count
// off by its height, and the reader lands paragraphs away. The inline script
// below restores before the first paint (the server render cannot read the
// browser's storage); after hydration reader-interactions.tsx re-applies the
// same position and holds it while the layout under it settles.

export const READING_POSITION_STORE = "unitos-reader-position";
// The tray's collapsed state and tab, per tab and per project (workspace.tsx).
export const TRAY_STATE_STORE = "unitos-tray-state";
// The inline script's style rules: the tray stays folded and the entrance
// fades stay still until React has taken over. workspace.tsx removes them.
export const RESTORE_STYLE_ID = "unitos-restore-style";
// How long reader-interactions.tsx holds the restored position against the
// layout settling under it (figures loading above it) before the reader
// scrolls on their own.
export const POSITION_HOLD_MS = 8000;
// How long workspace.tsx leaves the script's style rules in place after it
// mounts: past the entrance fade's length, so the fade cannot start late.
export const RESTORE_STYLE_MS = 600;

export type ReadingPosition = { blockId: string; offset: number } | { top: number };

export function readingPositionKey(documentId: string): string {
  return `${READING_POSITION_STORE}:${documentId}`;
}

export function trayStateKey(notebookId: string): string {
  return `${TRAY_STATE_STORE}:${notebookId}`;
}

const BLOCK_SELECTOR = "[data-block-id], [data-edit-block]";

function blockIdOf(el: HTMLElement): string {
  return el.dataset.blockId ?? el.dataset.editBlock ?? "";
}

function blockElement(container: HTMLElement, blockId: string): HTMLElement | null {
  const id = CSS.escape(blockId);
  return container.querySelector<HTMLElement>(`[data-block-id="${id}"], [data-edit-block="${id}"]`);
}

/** The block at the top edge of the pane and its offset from the edge. */
export function readReadingPosition(container: HTMLElement): ReadingPosition {
  const edge = container.getBoundingClientRect().top;
  const blocks = container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
  // Blocks run top to bottom: binary search for the first whose bottom edge
  // is under the pane's top edge.
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].getBoundingClientRect().bottom > edge + 1) hi = mid;
    else lo = mid + 1;
  }
  const block = blocks[lo];
  if (!block) return { top: container.scrollTop };
  return { blockId: blockIdOf(block), offset: block.getBoundingClientRect().top - edge };
}

/** Scroll the pane so the stored block sits at its stored offset. Returns the
    scrollTop it settled on; null when the block is gone (a re-parse). */
export function applyReadingPosition(container: HTMLElement, position: ReadingPosition): number | null {
  if ("top" in position) {
    container.scrollTop = position.top;
    return container.scrollTop;
  }
  const block = blockElement(container, position.blockId);
  if (!block) return null;
  const edge = container.getBoundingClientRect().top;
  container.scrollTop += block.getBoundingClientRect().top - edge - position.offset;
  return container.scrollTop;
}

/** True while the stored block sits at its stored offset (within a pixel). */
export function atReadingPosition(container: HTMLElement, position: ReadingPosition): boolean {
  if ("top" in position) return Math.abs(container.scrollTop - position.top) < 1;
  const block = blockElement(container, position.blockId);
  if (!block) return false;
  const edge = container.getBoundingClientRect().top;
  return Math.abs(block.getBoundingClientRect().top - edge - position.offset) < 1;
}

/** A stored value → a position. A bare number is the pixel count an earlier
    version stored. Anything else restores nothing. */
export function parseReadingPosition(raw: string | null): ReadingPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === "number") return value > 0 ? { top: value } : null;
    if (value && typeof value === "object") {
      const v = value as { blockId?: unknown; offset?: unknown; top?: unknown };
      if (typeof v.blockId === "string" && typeof v.offset === "number") {
        return { blockId: v.blockId, offset: v.offset };
      }
      if (typeof v.top === "number" && v.top > 0) return { top: v.top };
    }
  } catch {
    // not a stored position
  }
  return null;
}

// The inline script the workspace renders after its last child, so every
// pane and the tray are parsed when it runs. Same logic as the functions
// above, in plain script form: it runs before React loads. A ?src, ?block,
// or ?link jump wins over the restore, so with one in the URL the panes stay
// at the top. Storage errors (a private window) restore nothing.
export function restoreScript(notebookId: string): string {
  return `(function(){try{
var css="";
var q=new URLSearchParams(location.search);
var jump=q.get("src")||q.get("block")||q.get("link");
var roots=document.querySelectorAll("[data-reader-root][data-document-id]");
for(var i=0;!jump&&i<roots.length;i++){
var root=roots[i];
var raw=sessionStorage.getItem(${JSON.stringify(`${READING_POSITION_STORE}:`)}+root.getAttribute("data-document-id"));
if(!raw)continue;
var p=JSON.parse(raw);
if(typeof p==="number")p={top:p};
if(!p||typeof p!=="object")continue;
var el=typeof p.blockId==="string"?root.querySelector('[data-block-id="'+CSS.escape(p.blockId)+'"],[data-edit-block="'+CSS.escape(p.blockId)+'"]'):null;
if(el&&typeof p.offset==="number")root.scrollTop+=el.getBoundingClientRect().top-root.getBoundingClientRect().top-p.offset;
else if(typeof p.top==="number")root.scrollTop=p.top;
else continue;
css+=".content-in,.panel-in{animation-duration:0s!important}";
}
var tray=sessionStorage.getItem(${JSON.stringify(trayStateKey(notebookId))});
if(tray&&JSON.parse(tray).collapsed===true)css+=".tray-column{width:0!important;transition:none!important}";
if(css){var s=document.createElement("style");s.id=${JSON.stringify(RESTORE_STYLE_ID)};s.textContent=css;document.head.appendChild(s);}
}catch(e){}})();`;
}
