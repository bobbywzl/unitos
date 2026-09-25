// Events between the page editor and the reader pane (SPEC.md §29). No editor
// library here: the reader loads this for every document.

/** Raised on an element of the page's text to flash it; the editor paints the
    flash as a decoration (annotation-marks.tsx), since a class on its DOM
    would be redrawn away. */
export const PAGE_FLASH_EVENT = "docs:flash";

/** Raised on window with {documentId} when the page's words change: the
    toolbar over the old words closes. */
export const PAGE_EDITED_EVENT = "docs:edited";

/** Flash an element of the page's text; false when it is not in a page. */
export function flashInPage(el: Element): boolean {
  if (!el.closest("[data-docs-body]")) return false;
  el.dispatchEvent(new CustomEvent(PAGE_FLASH_EVENT, { bubbles: true }));
  return true;
}
