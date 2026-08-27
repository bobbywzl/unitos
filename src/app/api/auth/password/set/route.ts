import { NextResponse } from "next/server";
import { z } from "zod";
import { appOrigin, authEnabled, currentUser, setPassword } from "@/lib/auth";

const Body = z.object({
  password: z.string().min(8).max(200),
  confirm: z.string().min(1).max(200),
});

// Set the signed-in account's password — the /welcome form.
export async function POST(req: Request) {
  const origin = appOrigin(req);
  if (!authEnabled()) return NextResponse.redirect(new URL("/", origin), 303);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(new URL("/signin", origin), 303);

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/welcome?error=${encodeURIComponent(reason)}`, origin), 303);

  const form = await req.formData().catch(() => null);
  const parsed = Body.safeParse({
    password: form?.get("password")?.toString() ?? "",
    confirm: form?.get("confirm")?.toString() ?? "",
  });
  if (!parsed.success) return fail("Password must be at least 8 characters");
  if (parsed.data.password !== parsed.data.confirm) return fail("Passwords do not match");

  await setPassword(user.id, parsed.data.password);
  return NextResponse.redirect(new URL("/", origin), 303);
}
