// The page area's symbols (SPEC.md §29): Google's Material icons (Apache
// 2.0) on a 24-unit grid, drawn the way components/docs/icons.tsx draws the
// toolbar's.

type Props = { size?: number; className?: string };

function icon(path: string, name: string) {
  function Icon({ size = 20, className }: Props) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" className={className}>
        <path d={path} />
      </svg>
    );
  }
  Icon.displayName = name;
  return Icon;
}

/** Show tabs & outlines: a list. */
export const ListIcon = icon(
  "M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z",
  "ListIcon",
);
/** Hide tabs & outlines. */
export const ArrowBackIcon = icon("M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z", "ArrowBackIcon");
/** Page setup: a sheet of paper. */
export const PageIcon = icon(
  "M17 3H7c-1.1 0-1.99.9-1.99 2L5 19c0 1.1.89 2 1.99 2H17c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7V5h10v14z",
  "PageIcon",
);
/** A document tab. */
export const TabDocIcon = icon(
  "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zM6 20V4h7v5h5v11H6z",
  "TabDocIcon",
);
