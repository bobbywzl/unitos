// The onboarding funnel: the vocabulary shared by the client step component
// (components/funnel-step.tsx), the API route (/api/funnel), the server
// recorder (lib/funnel-record.ts), and the admin funnel page (/admin/funnel).
// A step is one point a visitor reaches on the way from the sign-in page to
// a subscription, in this order:
//
//   signin      landed on the sign-in page, signed out
//   account     made an account (the first sign-in of an email)
//   dashboard   opened the dashboard
//   reader      opened a project in the reader
//   plans       opened the plans page or the plan page
//   order       opened an order page
//   checkout    clicked Pay: a Stripe Checkout session was opened
//   subscribed  a subscription landed on the account (paid, or started free
//               on the trial)
//
// The page steps record from the browser once per page open; account,
// checkout, and subscribed record on the server where they happen. The
// admin page counts each visitor once per step, whatever the row count.
//
// Keep this file dependency-free — the server pages and the client both
// import it.

export const FUNNEL_STEPS = [
  "signin",
  "account",
  "dashboard",
  "reader",
  "plans",
  "order",
  "checkout",
  "subscribed",
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export function isFunnelStep(value: unknown): value is FunnelStep {
  return typeof value === "string" && (FUNNEL_STEPS as readonly string[]).includes(value);
}

// The steps a page records from the browser (components/funnel-step.tsx,
// POST /api/funnel). The other three record on the server where they
// happen, and the route refuses them from a browser.
export const FUNNEL_PAGE_STEPS = ["signin", "dashboard", "reader", "plans", "order"] as const;

export type FunnelPageStep = (typeof FUNNEL_PAGE_STEPS)[number];

// The step's place in the order; the admin page reads "how far" from it.
export function funnelStepIndex(step: FunnelStep): number {
  return FUNNEL_STEPS.indexOf(step);
}

// The daily cron deletes rows older than this. A year: the funnel is read
// across releases, and the rows are few (one per step per page open).
export const FUNNEL_RETENTION_DAYS = 365;
