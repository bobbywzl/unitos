// The Unitos mark: transparent line art, colored by currentColor via a CSS mask.
// Dark strokes in light mode, light strokes in dark mode; follows hover color.
// size takes a CSS length too ("100%"); fit "cover" fills the box, cropping
// edges — the full-page watermark on /signin and the welcome screen use it.
export function Logo({
  size = 28,
  className = "",
  fit = "contain",
}: {
  size?: number | string;
  className?: string;
  fit?: "contain" | "cover";
}) {
  const mask = {
    maskImage: "url(/logo-mask.png)",
    maskSize: fit,
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskImage: "url(/logo-mask.png)",
    WebkitMaskSize: fit,
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
