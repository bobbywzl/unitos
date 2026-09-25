// A flash in the page editor (SPEC.md §29): a jump to a mark or a paragraph
// flashes it, as in an article. The page editor redraws any class written
// on its text's DOM, so the flash is a decoration the editor paints
// (annotation-marks.tsx listens for this event on its text). No editor
// library here: the reader loads this for every document.

/** Raised on the element to flash, inside the page editor's text; it bubbles
    to the editor. */
export const PAGE_FLASH_EVENT = "docs:flash";

/** Flash an element of the page editor's text. False when the element is not
    in a page editor, so the caller flashes it the reader's way. */
export function flashInPage(el: Element): boolean {
  if (!el.closest("[data-docs-body]")) return false;
  el.dispatchEvent(new CustomEvent(PAGE_FLASH_EVENT, { bubbles: true }));
  return true;
}
