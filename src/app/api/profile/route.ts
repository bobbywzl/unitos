import { NextResponse } from "next/server";
import { z } from "zod";
import { USER_ID } from "@/lib/constants";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

export async function GET() {
  const profile = await db.readerProfile.findUnique({ where: { userId: USER_ID } });
  return NextResponse.json(profile);
}

const putSchema = z.object({
  background: z.string().min(1).max(2000),
  purpose: z.string().min(1).max(2000),
  application: z.string().min(1).max(2000),
});

// Reader profile conditions every prompt (SPEC.md §1).
export async function PUT(req: Request) {
  const { data, error } = await parseBody(req, putSchema);
  if (error) return error;
  const profile = await db.readerProfile.upsert({
    where: { userId: USER_ID },
    update: data,
    create: { userId: USER_ID, ...data },
  });
  return NextResponse.json(profile);
}
