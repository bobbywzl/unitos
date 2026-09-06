// The finishing step of an add (SPEC.md §15). The plan comes from
// GET /api/documents/{id}/finish: scans says who runs the glossary and
// recommended-links scans after the save — "client", the upload assistant,
// now, or "server", a job the server owns after its own work (conversion,
// transcription); images lists every visual the reader will request on open.
export type FinishPlan = { scans: "client" | "server"; images: string[] };

// The browser half: load every visual the reader will request on open — a PDF's figure and page renders,
// a page's remote figures — once, now, so the document opens with all of them
// painted instead of filling in one by one. The figure and page routes answer
// with immutable cache headers, so the reader's own <img> requests are served
// from the cache; a remote image follows its own headers. A URL that fails or
// stalls is skipped after its timeout; the budget caps the whole pass, so a
// long scan never holds the open for good.

const CONCURRENCY = 6;
const TIMEOUT_MS = 30_000;
const BUDGET_MS = 180_000;

function loadOne(url: string, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => done(true);
    img.onerror = () => done(false);
    img.src = url;
  });
}

export async function warmImages(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<{ loaded: number; total: number }> {
  const queue = [...urls];
  const total = queue.length;
  const started = Date.now();
  let done = 0;
  let loaded = 0;
  async function worker() {
    while (queue.length > 0 && Date.now() - started < BUDGET_MS) {
      const url = queue.shift()!;
      if (await loadOne(url, TIMEOUT_MS)) loaded++;
      done++;
      onProgress?.(done, total);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, worker));
  return { loaded, total };
}
