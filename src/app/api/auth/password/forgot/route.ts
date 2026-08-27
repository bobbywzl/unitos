import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin, emailEnabled, startPasswordReset } from "@/lib/auth";
import { currentLang } from "@/lib/i18n/server";

const Body = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
});

// Start the password reset: send the link when the account exists, answer the
// same either way (no account enumeration).
export async function POST(req: Request) {
  const origin = appOrigin(req);
  if (!emailEnabled()) return NextResponse.redirect(new URL("/", origin), 303);

  const form = await req.formData().catch(() => null);
  const parsed = Body.safeParse({ email: form?.get("email")?.toString() ?? "" });
  if (!parsed.success) {
    return NextResponse.redirect(
      new URL(`/signin?mode=forgot&error=${encodeURIComponent("Enter a valid email")}`, origin),
      303,
    );
  }

  await startPasswordReset(origin, parsed.data.email, await currentLang());
  return NextResponse.redirect(
    new URL(`/signin?mode=forgot&sent=${encodeURIComponent(parsed.data.email)}`, origin),
    303,
  );
}
