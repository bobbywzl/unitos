import type { ReactNode } from "react";

// [lists7] WALK7-01: a side list names itself at the start of its head row,
// on every width, so a phone reader who tapped a pill's mark reads what
// opened. The row's other controls stay where they were.
// [lists8] tip: what the list holds, on hover (the Documents counts, WALK8-02).
export function ListName({ children, grow = false, tip }: { children: ReactNode; grow?: boolean; tip?: string }) {
  return (
    <h2 data-graph-list-name data-tip={tip} className={`text-[13px] leading-snug font-semibold whitespace-nowrap text-ink ${grow ? "min-w-0 flex-1 truncate" : "shrink-0"}`}>
      {children}
    </h2>
  );
}
