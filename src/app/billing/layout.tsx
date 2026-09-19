import { billingView } from "@/lib/billing/switch";

export const dynamic = "force-dynamic";

// Billing (SPEC.md §24) lives under /billing, outside the app's own pages.
// The gate is here: while the switch is off the whole tree answers 404,
// except to the admin, who sees it as a preview. Each page draws its own
// frame (components/billing/frame.tsx): light for the plan page and the
// Unitos Premium pages, night for the Unitos Ultra pages.
export default async function BillingLayout({ children }: { children: React.ReactNode }) {
  await billingView();
  return <>{children}</>;
}
