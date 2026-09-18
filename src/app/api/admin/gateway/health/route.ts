import { NextResponse } from "next/server";
import { adminApiGuard } from "@/lib/admin-auth";
import { gatewayErrorMessage, gatewayHealth } from "@/lib/gateway-admin";

// Check models: one probe call per model on the gateway (lib/gateway-admin.ts).
export const maxDuration = 120;

export async function POST() {
  const denied = await adminApiGuard();
  if (denied) return denied;
  try {
    return NextResponse.json({ ok: true, ...(await gatewayHealth()) });
  } catch (err) {
    return NextResponse.json({ error: gatewayErrorMessage(err) }, { status: 502 });
  }
}
