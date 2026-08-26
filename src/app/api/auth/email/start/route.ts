import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin, emailEnabled, startEmailConfirmation } from "@/lib/auth";
import { currentLang } from "@/lib/i18n/server";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: z.string().trim().max(80).default(""),
});

// Start the email sign-in flow: validate the form, store the pending
// confirmation, send the link. 303 turns the POST into a GET redirect —
// /signin?sent=<email> shows the check-your-email state.
export async function POST(req: Request) {
  const origin = appOrigin(req);
  if (!emailEnabled()) return NextResponse.redirect(new URL("/", origin), 303);

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/signin?error=${encodeURIComponent(reason)}`, origin), 303);

  const form = await req.formData().catch(() => null);
  const parsed = Body.safeParse({
    email: form?.get("email")?.toString() ?? "",
    name: form?.get("name")?.toString() ?? "",
  });
  if (!parsed.success) return fail("Enter a valid email");

  const { email, name } = parsed.data;
  const sent = await startEmailConfirmation(origin, email, name, await currentLang());
  if (!sent) return fail("Could not send the confirmation email — try again");
  return NextResponse.redirect(
    new URL(`/signin?sent=${encodeURIComponent(email)}`, origin),
    303,
  );
}
