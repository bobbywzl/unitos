import { NextResponse } from "next/server";
import { z } from "zod";
import { adminApiGuard } from "@/lib/admin-auth";
import { isFeature, setFeatureModel } from "@/lib/feature-models";
import { parseBody } from "@/lib/validate";

// The admin sets one feature's model (lib/feature-models.ts). The id is
// probed with one call before the row is written, so the request waits on
// a model answer.
export const maxDuration = 120;

const bodySchema = z.object({
  feature: z.string().min(1).max(40),
  modelId: z.string().max(80),
});

export async function POST(req: Request) {
  const denied = await adminApiGuard();
  if (denied) return denied;
  const { data, error } = await parseBody(req, bodySchema);
  if (error) return error;
  if (!isFeature(data.feature)) {
    return NextResponse.json({ error: `${data.feature} is not a feature.` }, { status: 400 });
  }
  const result = await setFeatureModel(data.feature, data.modelId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 422 });
  return NextResponse.json({ ok: true, modelId: result.modelId });
}
