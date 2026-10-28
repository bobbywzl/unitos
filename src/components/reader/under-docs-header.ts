import { useEffect, useState, type RefObject } from "react";

// Where the reader's toasts and errors sit in the page editor: 8 px under
// the Unitos row (Breakwork, Collapse, Extract), which hangs under the
// page editor's header. The header and the row change height (the title row
// hidden, no ruler on a narrow pane, the row wrapping on a phone), so the
// place is measured, never a fixed number: a toast at a fixed top went under
// the row, and the row hid its words.

const GAP = 8;

/** The top, in px from the pane's top, for what stands under the page
    editor's header and Unitos row; null while `on` is false or before the
    header is in the pane. */
export function useUnderDocsHeader(containerRef: RefObject<HTMLElement | null>, on: boolean): number | null {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!on || !container) {
      setTop(null);
      return;
    }
    let header: HTMLElement | null = null;
    const sizes = new ResizeObserver(() => measure());
    // The page editor mounts after the pane: wait for its header.
    const arrival = new MutationObserver(() => find());
    function measure() {
      if (!header?.isConnected) {
        find();
        return;
      }
      // The row hangs under the header (toolbar.css .docs-unitos-row: 8 px
      // under it, out of the header's own height).
      const row = header.querySelector<HTMLElement>(".docs-unitos-row");
      if (row) sizes.observe(row);
      const rowHeight = row?.offsetHeight ?? 0;
      const next = header.offsetHeight + (rowHeight > 0 ? GAP + rowHeight : 0) + GAP;
      setTop((t) => (t === next ? t : next));
    }
    function find() {
      const found = container!.querySelector<HTMLElement>(".docs-header");
      if (!found) {
        header = null;
        arrival.observe(container!, { childList: true, subtree: true });
        return;
      }
      arrival.disconnect();
      if (found !== header) {
        sizes.disconnect();
        header = found;
        sizes.observe(found);
      }
      measure();
    }
    find();
    return () => {
      sizes.disconnect();
      arrival.disconnect();
    };
  }, [containerRef, on]);
  return top;
}
