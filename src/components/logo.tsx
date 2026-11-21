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
  // The mark is drawn at 140px at most; the 256px mask is a sixth of the
  // 512px one's bytes and every page loads it. The full-page watermark
  // (fit "cover") stretches the mask over the page, so it keeps the 512px one.
  const file = fit === "cover" ? "/logo-mask.png" : "/logo-mask-256.png";
  const mask = {
    maskImage: `url(${file})`,
    maskSize: fit,
    maskRepeat: "no-repeat",
    maskPosition: "center",
    WebkitMaskImage: `url(${file})`,
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
