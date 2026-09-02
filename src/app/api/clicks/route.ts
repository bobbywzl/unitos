import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { CLICK_BATCH_MAX, CLICK_CONTROL_PATTERN, CLICK_SURFACES } from "@/lib/clicks";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

const clicksSchema = z.object({
  clicks: z
    .array(
      z.object({
        surface: z.enum(CLICK_SURFACES),
        control: z.string().regex(CLICK_CONTROL_PATTERN),
        notebookId: z.string().min(1).max(64).optional(),
      }),
    )
    .min(1)
    .max(CLICK_BATCH_MAX),
});

// Click telemetry (SPEC.md §7): the client posts a batch of clicks; each lands
// as one ClickEvent row stamped with the signed-in account. The admin clicks
// page reads them. Best-effort: the client drops a batch this route refuses.
export async function POST(req: Request) {
  const { data, error } = await parseBody(req, clicksSchema);
  if (error) return error;
  const user = await currentUser();
  await db.clickEvent.createMany({
    data: data.clicks.map((click) => ({
      userId: user?.id ?? null,
      notebookId: click.notebookId ?? null,
      surface: click.surface,
      control: click.control,
    })),
  });
  return NextResponse.json({ ok: true, recorded: data.clicks.length }, { status: 201 });
}
