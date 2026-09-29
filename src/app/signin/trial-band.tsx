// The trial band (signin/page.tsx): under the sign-in card and the reader
// deck, above the plans. A lead line, then the offer, bigger and bolder, in
// the hero face: a clay-to-gold fill with a glint that sweeps across it, and
// four-point stars that twinkle around it (.si-trial-* in globals.css).
// Reduced motion keeps the fill and the stars, still. The bottom padding keeps
// the lower stars and the glow clear of the plans divider, which overlaps the
// bottom of the page's main by 80px.

// Each star: where it sits around the offer (percent of the offer's box),
// its size in px, and its delay in the twinkle cycle, so no two flash at once.
const STARS = [
  { left: "-4%", top: "8%", size: 22, delay: "0s" },
  { left: "10%", top: "-28%", size: 12, delay: "1.1s" },
  { left: "64%", top: "112%", size: 16, delay: "0.5s" },
  { left: "83%", top: "-24%", size: 13, delay: "1.6s" },
  { left: "101%", top: "18%", size: 20, delay: "0.8s" },
  { left: "92%", top: "96%", size: 12, delay: "2s" },
  { left: "30%", top: "104%", size: 14, delay: "1.4s" },
  { left: "2%", top: "88%", size: 10, delay: "0.3s" },
];

function Star({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 0c.6 6.4 5.6 11.4 12 12-6.4.6-11.4 5.6-12 12-.6-6.4-5.6-11.4-12-12C6.4 11.4 11.4 6.4 12 0Z" />
    </svg>
  );
}

export function TrialBand({ lead, offer }: { lead: string; offer: string }) {
  return (
    <section className="mt-[clamp(56px,8vw,112px)] flex flex-col items-center gap-4 pb-10 text-center">
      <p className="text-[length:clamp(1.15rem,2.2vw,1.75rem)] leading-snug font-bold text-balance text-ink">{lead}</p>
      <p className="relative inline-block px-2">
        {STARS.map((s, i) => (
          <span
            key={i}
            aria-hidden
            className="si-trial-star pointer-events-none absolute"
            style={{ left: s.left, top: s.top, animationDelay: s.delay }}
          >
            <Star size={s.size} />
          </span>
        ))}
        <span className="si-trial-offer block font-hero text-[length:clamp(2rem,5vw,3.75rem)] leading-[1.05] text-balance uppercase">
          {offer}
        </span>
      </p>
    </section>
  );
}
