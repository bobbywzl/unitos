// The events between the page editor and the reader pane around it (SPEC.md
// §29). No editor library here: the reader loads this for every document.

/** Raised on an element of the page editor's text to flash it — a mark or a
    paragraph the reader jumped to; it bubbles to the editor, which paints the
    flash as a decoration (annotation-marks.tsx): a class written on its
    text's DOM would be redrawn away. */
export const PAGE_FLASH_EVENT = "docs:flash";

/** Raised on window when the page editor's words change — typing, a paste,
    an undo — with {documentId}: the reader's toolbar over the old words
    closes. A stored copy put on screen raises none. */
export const PAGE_EDITED_EVENT = "docs:edited";

/** Flash an element of the page editor's text. False when the element is not
    in a page editor, so the caller flashes it the reader's way. */
export function flashInPage(el: Element): boolean {
  if (!el.closest("[data-docs-body]")) return false;
  el.dispatchEvent(new CustomEvent(PAGE_FLASH_EVENT, { bubbles: true }));
  return true;
}
