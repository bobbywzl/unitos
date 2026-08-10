// The instrument fan: five surgical tools tucked behind a work's cover that spring
// out when the work is hovered (design 2a). Decorative — the fan says "ready to
// dissect" and carries no state of its own; positions and stagger live in CSS
// (--fan and transition-delay, see globals.css .instrument).
type Instrument = {
  fan: string;
  delay: string;
  className: string;
  path: React.ReactNode;
};

const INSTRUMENTS: Instrument[] = [
  {
    fan: "translate(-52px, -4px) rotate(-26deg)",
    delay: "0s",
    className: "text-sand-800",
    path: (
      <>
        <line x1="8" y1="50" x2="16.5" y2="14" />
        <line x1="16" y1="50" x2="7.5" y2="14" />
        <circle cx="7" cy="55" r="4" />
        <circle cx="17" cy="55" r="4" />
      </>
    ),
  },
  {
    fan: "translate(-27px, -15px) rotate(-13deg)",
    delay: "0.045s",
    className: "text-sage-600",
    path: (
      <>
        <path d="M9 6 C9 22 10.6 38 12 50" />
        <path d="M15 6 C15 22 13.4 38 12 50" />
      </>
    ),
  },
  {
    fan: "translate(0px, -22px) rotate(0deg)",
    delay: "0.09s",
    className: "text-clay",
    path: (
      <>
        <line x1="12" y1="58" x2="12" y2="31" />
        <line x1="9.5" y1="31" x2="14.5" y2="31" />
        <path
          d="M12 28 C12 19 12 10.5 13.2 5.5 C16.2 9 18.8 13.5 18.8 17.5 C18.8 22.5 15.2 25 12 28 Z"
          fill="currentColor"
          stroke="none"
        />
      </>
    ),
  },
  {
    fan: "translate(27px, -15px) rotate(13deg)",
    delay: "0.135s",
    className: "text-sand-800",
    path: (
      <>
        <line x1="12" y1="6" x2="12" y2="14" />
        <rect x="8.5" y="14" width="7" height="18" rx="2.5" />
        <line x1="8.5" y1="21" x2="15.5" y2="21" />
        <line x1="12" y1="32" x2="12" y2="42" />
        <line x1="9" y1="43" x2="15" y2="43" />
      </>
    ),
  },
  {
    fan: "translate(52px, -4px) rotate(26deg)",
    delay: "0.18s",
    className: "text-sage-600",
    path: (
      <>
        <circle cx="12" cy="9" r="5" />
        <line x1="12" y1="14" x2="12" y2="52" />
      </>
    ),
  },
];

export function Instruments() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-[46px] z-0 h-[68px]">
      {INSTRUMENTS.map((instrument, i) => (
        <svg
          key={i}
          width="26"
          height="68"
          viewBox="0 0 24 64"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`instrument absolute left-1/2 -ml-[13px] origin-bottom ${instrument.className}`}
          style={
            { "--fan": instrument.fan, transitionDelay: instrument.delay } as React.CSSProperties
          }
        >
          {instrument.path}
        </svg>
      ))}
    </div>
  );
}
