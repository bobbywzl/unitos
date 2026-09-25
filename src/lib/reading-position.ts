// The reading position of one document pane, and the tray state, across a
// full page load, a new tab, and another device. A note, an annotation, or an
// AI tool refreshes the page; when the refresh turns into a full load (a new
// deploy makes the next refresh one; a dropped response does too) the reader
// came back at the top and the tray reopened on notes (reader report). And a
// reader who comes back to a document another day starts where they left off.
//
// The position is the block at the reading line (READING_LINE_PX under the
// pane's top edge, below the controls that float there) and the offset from
// the line to the block's top. A block, not a pixel count: a figure above the
// position that loads after the restore moves a pixel count off by its
// height, and the reader lands paragraphs away. Two copies are kept:
// - the tab's copy, per tab and per document in sessionStorage, saved as the
//   reader scrolls;
// - the account's copy, one row per account per document (ReadingPosition,
//   PUT /api/documents/[documentId]/position), saved a little later.
// On open the newer copy wins. The tab's copy restores exactly: the reader is
// where it was. The account's copy resumes: the block starts at the reading
// line, so the left-off mark above it shows (reader.tsx LeftOffMark). The
// inline script below restores before the first paint (the server render
// cannot read the browser's storage); after hydration reader-interactions.tsx
// re-applies the same position and holds it while the layout under it
// settles.

export const READING_POSITION_STORE = "unitos-reader-position";
// The reader's own open or fold of the tray, and its tab, per tab and per
// project (workspace.tsx).
export const TRAY_STATE_STORE = "unitos-tray-state";
// Until the reader opens or folds the tray, a blank document opens with it
// folded in a window narrower than this: the whole toolbar beside the open
// tray at its default width (SPEC.md §29). Normal view only: a split view
// keeps the tray past the panes, so folding it gives the page no room. An
// import keeps the tray open, as the block reader shows it.
const TRAY_FOLD_BELOW = 1860;
const PAGE_EDITOR_PANE = "[data-reader-root][data-page-editor]:not([data-import])";
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
// The reading line: this far under the pane's top edge, below the Contents
// button and the controls at the top right.
export const READING_LINE_PX = 80;
// A resume puts the block's top on the reading line unless the reader was so
// deep into a long block that the line they were on would land below this
// share of the pane; then it restores exactly.
export const RESUME_DEPTH_SHARE = 0.6;
// The left-off mark shows when the position is at least this share of the
// pane below the top of the document: a reader still on the first screen
// has no place to come back to.
export const LEFT_OFF_MIN_SHARE = 1 / 3;
// The account's copy saves once the reader stops scrolling for this long,
// and at least this often while they keep scrolling; hiding the tab,
// leaving the page, or closing the document saves at once. A save sent as
// the page goes can be lost (a reload drops it), so the copy is kept
// current before then.
export const ACCOUNT_SAVE_SETTLE_MS = 3_000;
export const ACCOUNT_SAVE_MAX_MS = 15_000;

// A block position, or a pixel count an earlier version stored. line: where
// the offset is measured from, px under the pane's top edge (0 before the
// reading line). height: the block's height when it was read, 0 = unknown.
// at: when the reader was there, ms by the browser's clock, 0 = unknown.
export type BlockPosition = { blockId: string; offset: number; line: number; height: number; at: number };
export type ReadingPosition = BlockPosition | { top: number; at: number };

export function readingPositionKey(documentId: string): string {
  return `${READING_POSITION_STORE}:${documentId}`;
}

export function trayStateKey(notebookId: string): string {
  return `${TRAY_STATE_STORE}:${notebookId}`;
}

/** The tray's default: folded for a blank document in a narrower window. */
export function trayFoldsByDefault(split: boolean): boolean {
  return !split && window.innerWidth < TRAY_FOLD_BELOW && document.querySelector(PAGE_EDITOR_PANE) !== null;
}

const BLOCK_SELECTOR = "[data-block-id], [data-edit-block]";

function blockIdOf(el: HTMLElement): string {
  return el.dataset.blockId ?? el.dataset.editBlock ?? "";
}

function blockElement(container: HTMLElement, blockId: string): HTMLElement | null {
  const id = CSS.escape(blockId);
  return container.querySelector<HTMLElement>(`[data-block-id="${id}"], [data-edit-block="${id}"]`);
}

/** The block at the reading line and the offset from the line to its top. */
export function readReadingPosition(container: HTMLElement, at: number): ReadingPosition {
  const line = container.getBoundingClientRect().top + READING_LINE_PX;
  const blocks = container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR);
  // Blocks run top to bottom: binary search for the first whose bottom edge
  // is under the reading line.
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (blocks[mid].getBoundingClientRect().bottom > line + 1) hi = mid;
    else lo = mid + 1;
  }
  const block = blocks[lo];
  if (!block) return { top: container.scrollTop, at };
  const rect = block.getBoundingClientRect();
  return { blockId: blockIdOf(block), offset: rect.top - line, line: READING_LINE_PX, height: rect.height, at };
}

// Where the block's top goes, px under the pane's top edge. A block of
// another height (another screen, another column width) scales the offset,
// so the line cuts the block at the same share. A resume puts the block's
// top on the line, unless the reader was deep into a long block.
function blockTarget(container: HTMLElement, block: HTMLElement, p: BlockPosition, resume: boolean): number {
  const height = block.getBoundingClientRect().height;
  const offset = p.offset < 0 && p.height > 0 && height > 0 ? (p.offset * height) / p.height : p.offset;
  if (resume && offset < 0 && p.line - offset <= container.clientHeight * RESUME_DEPTH_SHARE) return p.line;
  return p.line + offset;
}

/** The scrollTop that shows the position; null when its block is gone (a
    re-parse). Unclamped: the pane clamps it when it is set. */
export function readingPositionScroll(
  container: HTMLElement,
  position: ReadingPosition,
  resume: boolean,
): number | null {
  if ("top" in position) return position.top;
  const block = blockElement(container, position.blockId);
  if (!block) return null;
  const edge = container.getBoundingClientRect().top;
  return container.scrollTop + block.getBoundingClientRect().top - edge - blockTarget(container, block, position, resume);
}

/** Scroll the pane to the position. Returns the scrollTop it settled on;
    null when the block is gone (a re-parse). */
export function applyReadingPosition(container: HTMLElement, position: ReadingPosition, resume: boolean): number | null {
  const top = readingPositionScroll(container, position, resume);
  if (top === null) return null;
  container.scrollTop = top;
  return container.scrollTop;
}

/** True while the pane shows the position (within a pixel). */
export function atReadingPosition(container: HTMLElement, position: ReadingPosition, resume: boolean): boolean {
  const top = readingPositionScroll(container, position, resume);
  return top !== null && Math.abs(container.scrollTop - top) < 1;
}

/** A stored value → a position. A bare number is the pixel count an earlier
    version stored; a block position without a line was read at the pane's
    top edge. Anything else restores nothing. */
export function parseReadingPosition(raw: string | null): ReadingPosition | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value === "number") return value > 0 ? { top: value, at: 0 } : null;
    if (value && typeof value === "object") {
      const v = value as { blockId?: unknown; offset?: unknown; top?: unknown; line?: unknown; height?: unknown; at?: unknown };
      const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
      if (typeof v.blockId === "string" && typeof v.offset === "number") {
        return { blockId: v.blockId, offset: v.offset, line: num(v.line), height: num(v.height), at: num(v.at) };
      }
      if (typeof v.top === "number" && v.top > 0) return { top: v.top, at: num(v.at) };
    }
  } catch {
    // not a stored position
  }
  return null;
}

/** The copy the reader opens at: the newer one, the tab's on a tie. resume:
    the account's copy won — the reader comes back from another tab, another
    device, or another day. */
export function chooseReadingPosition(
  tab: ReadingPosition | null,
  account: BlockPosition | null,
): { position: ReadingPosition; resume: boolean } | null {
  if (account && (!tab || account.at > tab.at)) return { position: account, resume: true };
  return tab ? { position: tab, resume: false } : null;
}

// The inline script the workspace renders after its last child, so every
// pane and the tray are parsed when it runs. Same logic as the functions
// above, in plain script form: it runs before React loads. The account's
// copy rides on the pane (data-account-position). A ?src, ?block, or ?link
// jump wins over the restore, so with one in the URL the panes stay at the
// top. A storage error (a private window) leaves the account's copy.
export function restoreScript(notebookId: string, split: boolean): string {
  return `(function(){try{
var css="";
var q=new URLSearchParams(location.search);
var jump=q.get("src")||q.get("block")||q.get("link");
var roots=document.querySelectorAll("[data-reader-root][data-document-id]");
var num=function(x){return typeof x==="number"&&isFinite(x)?x:0;};
var parse=function(raw){if(!raw)return null;try{var v=JSON.parse(raw);}catch(e){return null;}
if(typeof v==="number")return v>0?{top:v,at:0}:null;
if(!v||typeof v!=="object")return null;
if(typeof v.blockId==="string"&&typeof v.offset==="number")return{blockId:v.blockId,offset:v.offset,line:num(v.line),height:num(v.height),at:num(v.at)};
if(typeof v.top==="number"&&v.top>0)return{top:v.top,at:num(v.at)};
return null;};
for(var i=0;!jump&&i<roots.length;i++){
var root=roots[i];
var tab=null;
try{tab=parse(sessionStorage.getItem(${JSON.stringify(`${READING_POSITION_STORE}:`)}+root.getAttribute("data-document-id")));}catch(e){}
var acc=parse(root.getAttribute("data-account-position"));
var resume=Boolean(acc&&acc.blockId&&(!tab||acc.at>tab.at));
var p=resume?acc:tab;
if(!p)continue;
if(typeof p.blockId==="string"){
var el=root.querySelector('[data-block-id="'+CSS.escape(p.blockId)+'"],[data-edit-block="'+CSS.escape(p.blockId)+'"]');
if(!el)continue;
var r=el.getBoundingClientRect();
var o=p.offset<0&&p.height>0&&r.height>0?p.offset*r.height/p.height:p.offset;
var y=resume&&o<0&&p.line-o<=root.clientHeight*${RESUME_DEPTH_SHARE}?p.line:p.line+o;
root.scrollTop+=r.top-root.getBoundingClientRect().top-y;
}else root.scrollTop=p.top;
css+=".content-in,.panel-in{animation-duration:0s!important}";
}
var tray=null;
try{tray=sessionStorage.getItem(${JSON.stringify(trayStateKey(notebookId))});}catch(e){}
try{if(tray?JSON.parse(tray).collapsed===true:${!split}&&innerWidth<${TRAY_FOLD_BELOW}&&document.querySelector(${JSON.stringify(PAGE_EDITOR_PANE)}))css+=".tray-column{width:0!important;transition:none!important}";}catch(e){}
if(css){var s=document.createElement("style");s.id=${JSON.stringify(RESTORE_STYLE_ID)};s.textContent=css;document.head.appendChild(s);}
}catch(e){}})();`;
}
