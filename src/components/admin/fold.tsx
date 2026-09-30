"use client";

import { useState, type ReactNode } from "react";

/** A closed <details> whose contents are drawn the first time it opens, and
    kept after. The digest store folds every document of every project: drawn
    up front, the folded contents were three in five of the page's 55,000
    elements, and the page took a second to show. */
export function Fold({ summary, className, children }: { summary: ReactNode; className?: string; children: ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className={className} onToggle={(e) => e.currentTarget.open && setOpened(true)}>
      {summary}
      {opened && children}
    </details>
  );
}
