"use client";

import { useEffect } from "react";

// The reader's scripts, fetched while the dashboard is idle: a project
// opens on scripts the browser already holds, instead of downloading them
// after the press. The imports name the reader page's client components,
// so the chunks are the ones the reader page itself loads; nothing is
// rendered, and the modules evaluate at most once per page.
export function ReaderWarmup() {
  useEffect(() => {
    const warm = () => {
      void Promise.all([
        import("@/components/reader/workspace"),
        import("@/components/reader/reader-panes"),
        import("@/components/reader/reader-interactions"),
        import("@/components/assistant/assistant-panel"),
        import("@/components/panels/annotations-panel"),
        import("@/components/panels/distill-panel"),
      ]).catch(() => {});
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number })
      .requestIdleCallback;
    if (idle) idle(warm, { timeout: 2000 });
    else setTimeout(warm, 500);
  }, []);
  return null;
}
