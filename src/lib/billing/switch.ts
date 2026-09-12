import { notFound } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { authEnabled } from "@/lib/auth";
import { readSetting, writeSetting } from "@/lib/settings";

// The billing switch (SPEC.md §24): the operator turns billing on from the
// admin billing page. Off, the billing pages answer 404 and the app shows no
// link to them; the admin, signed in to /admin, sees the pages as a preview.
// The switch is the AppSetting row "billing": "on" or "off"; no row = off.

export const BILLING_KEY = "billing";

export async function billingOn(): Promise<boolean> {
  return (await readSetting(BILLING_KEY)) === "on";
}

export async function setBillingOn(on: boolean): Promise<void> {
  await writeSetting(BILLING_KEY, on ? "on" : "off");
}

/** How a request may see the billing pages. on: billing is on, everyone
    sees them. preview: billing is off and the admin cookie is set. Neither:
    404. */
export type BillingView = { on: boolean; preview: boolean };

export async function billingView(): Promise<BillingView> {
  const on = await billingOn();
  if (on) return { on, preview: false };
  const preview = await isAdmin();
  if (!preview) notFound();
  return { on, preview };
}

/** The same gate for an API route: true when the caller may use billing. */
export async function billingUsable(): Promise<boolean> {
  return (await billingOn()) || (await isAdmin());
}

/** The app shows its links to billing: the switch is on and there are
    accounts to bill (sign-in on). The local reader never sees them. */
export async function billingLinks(): Promise<boolean> {
  return authEnabled() && (await billingOn());
}
