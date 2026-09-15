import { Fragment } from "react";
import { splitHits } from "@/lib/search-hits";

/** Text with every match of the needle lit up (SPEC.md §6): the title row
    and the collapsed line paint the same runs the rendered body does. */
export function Highlight({ text, needle }: { text: string; needle: string }) {
  if (!needle) return <>{text}</>;
  return (
    <>
      {splitHits(text, needle).map((run, i) =>
        run.hit ? (
          <mark key={i} className="search-hit">
            {run.text}
          </mark>
        ) : (
          <Fragment key={i}>{run.text}</Fragment>
        ),
      )}
    </>
  );
}
