// The typing area's symbols (SPEC.md §29): Google's Material icons (Apache
// 2.0) on a 24-unit grid, drawn like components/docs/icons.tsx.

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

export const ArrowUpIcon = icon("M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z", "ArrowUpIcon");
export const ArrowDownIcon = icon("M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z", "ArrowDownIcon");
export const MicIcon = icon(
  "M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z",
  "MicIcon",
);
export const DragIndicatorIcon = icon(
  "M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  "DragIndicatorIcon",
);
