import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin, emailEnabled, resetPassword, sessionRedirect } from "@/lib/auth";

const Body = z.object({
  token: z.string().regex(/^[0-9a-f]{64}$/),
  password: z.string().min(8).max(200),
  confirm: z.string().min(1).max(200),
});

// The /reset form lands here: redeem the token, set the new password, sign in.
export async function POST(req: Request) {
  const origin = appOrigin(req);
  if (!emailEnabled()) return NextResponse.redirect(new URL("/", origin), 303);

  const form = await req.formData().catch(() => null);
  const token = form?.get("token")?.toString() ?? "";
  const fail = (reason: string) =>
    NextResponse.redirect(
      new URL(`/reset?token=${encodeURIComponent(token)}&error=${encodeURIComponent(reason)}`, origin),
      303,
    );

  const parsed = Body.safeParse({
    token,
    password: form?.get("password")?.toString() ?? "",
    confirm: form?.get("confirm")?.toString() ?? "",
  });
  if (!parsed.success) return fail("Password must be at least 8 characters");
  if (parsed.data.password !== parsed.data.confirm) return fail("Passwords do not match");

  const session = await resetPassword(parsed.data.token, parsed.data.password);
  if (!session) {
    return NextResponse.redirect(
      new URL(
        `/signin?error=${encodeURIComponent("Confirmation link expired or already used — request a new one")}`,
        origin,
      ),
      303,
    );
  }
  return sessionRedirect(origin, session);
}
