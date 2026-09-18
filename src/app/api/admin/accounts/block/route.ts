import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { blockEmail, normalizeEmail, unblockEmail } from "@/lib/block";
import { parseBody } from "@/lib/validate";

// Admin: block or unblock one email (lib/block.ts, SPEC.md §2). Block puts
// the email on the block list, signs its account out everywhere, and drops
// its pending email links; every sign-in door refuses it from then on.
// Unblock takes it off the list. The email need not have an account.
const blockSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  blocked: z.boolean(),
});

export async function POST(req: Request) {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, blockSchema);
  if (error) return error;

  const email = normalizeEmail(data.email);
  if (data.blocked) await blockEmail(email);
  else await unblockEmail(email);
  return NextResponse.json({ ok: true, email, blocked: data.blocked });
}
