import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { BALANCE_KEYS, setManualBalance, setWarnLevel, type BalanceKey } from "@/lib/balances";
import { parseBody } from "@/lib/validate";

// Admin: one provider's balance (lib/balances.ts) — the figure its billing
// page shows now, its warn level, or both. Spend from now on comes off the
// balance; a live reading replaces it the next time the usage page opens.
const balanceSchema = z
  .object({
    key: z.enum(BALANCE_KEYS as [BalanceKey, ...BalanceKey[]]),
    usd: z.number().finite().min(0).max(10_000_000).optional(),
    warnUsd: z.number().finite().min(0).max(1_000_000).optional(),
  })
  .refine((b) => b.usd !== undefined || b.warnUsd !== undefined, { message: "Set usd, warnUsd, or both." });

export async function POST(req: Request) {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, balanceSchema);
  if (error) return error;
  if (data.usd !== undefined) await setManualBalance(data.key, data.usd);
  if (data.warnUsd !== undefined) await setWarnLevel(data.key, data.warnUsd);
  return NextResponse.json({ ok: true });
}
