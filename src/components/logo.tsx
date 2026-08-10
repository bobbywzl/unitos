// The Dissect mark: transparent line art, colored by currentColor via a CSS mask.
// Dark strokes in light mode, light strokes in dark mode; follows hover color.
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  const mask = {
    maskImage: "url(/logo-mask.png)",
    maskSize: "contain",
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskImage: "url(/logo-mask.png)",
    WebkitMaskSize: "contain",
    WebkitMaskRepeat: "no-repeat",
    WebkitMaskPosition: "center",
  } as const;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{ width: size, height: size, ...mask }}
    />
  );
}
