import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { gatewayErrorMessage, gatewayGenerateKey, gatewayUpdateKey } from "@/lib/gateway-admin";
import { parseBody } from "@/lib/validate";

// The app key on the gateway (lib/gateway-admin.ts): POST issues one, PATCH
// changes the limits of the one set as LITELLM_API_KEY.

const limitsSchema = z.object({
  rpm: z.number().int().positive().nullable(),
  tpm: z.number().int().positive().nullable(),
  maxBudget: z.number().nonnegative().nullable(),
  budgetDuration: z
    .string()
    .regex(/^\d+[smhd]$/)
    .nullable(),
});

export async function POST(req: Request) {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, limitsSchema);
  if (error) return error;
  try {
    const key = await gatewayGenerateKey(data);
    return NextResponse.json({ ok: true, key });
  } catch (err) {
    return NextResponse.json({ error: gatewayErrorMessage(err) }, { status: 502 });
  }
}

export async function PATCH(req: Request) {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, limitsSchema);
  if (error) return error;
  try {
    await gatewayUpdateKey(data);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: gatewayErrorMessage(err) }, { status: 502 });
  }
}
