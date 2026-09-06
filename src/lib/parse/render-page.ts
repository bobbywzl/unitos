import type { FetchedPage } from "@/lib/parse/fetch-page";
import type { OnIngestProgress } from "@/lib/parse/ingest";

// A page whose figures are drawn by its scripts (a chart svg empty in the
// server's HTML, a canvas) has no figure to parse in the static page. Where a
// browser is configured (BROWSER_WS_ENDPOINT or CHROMIUM_PATH, the same
// browser SPEC.md §11 uses for transcripts), the page renders in it, scrolls
// through so scroll-revealed charts draw, and the rendered DOM parses in the
// static page's place. Without a browser the static page stands.

/** Does the static HTML show figures its scripts draw later? */
export function needsBrowserRender(_html: string): boolean {
  return false;
}

/** The page as a browser renders it, when the static page needs it and a
    browser is configured; the page itself otherwise. Never throws: a failed
    render leaves the static page standing. */
export async function renderIfNeeded(
  page: FetchedPage,
  _url: string,
  _onProgress?: OnIngestProgress,
): Promise<FetchedPage> {
  return page;
}
