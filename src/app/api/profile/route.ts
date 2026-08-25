import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { parseBody } from "@/lib/validate";

export async function GET() {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  const profile = await db.readerProfile.findUnique({ where: { userId: user.id } });
  return NextResponse.json(profile);
}

// Every field is optional: the Context tab saves whatever is filled.
const putSchema = z.object({
  background: z.string().max(2000),
  purpose: z.string().max(2000),
  application: z.string().max(2000),
});

// Context conditions every prompt (SPEC.md §1). Stored as ReaderProfile, one
// per account.
export async function PUT(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  const { data, error } = await parseBody(req, putSchema);
  if (error) return error;
  const profile = await db.readerProfile.upsert({
    where: { userId: user.id },
    update: data,
    create: { userId: user.id, ...data },
  });
  return NextResponse.json(profile);
}
