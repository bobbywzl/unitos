import { NextResponse } from "next/server";
import { z } from "zod";
import { authEnabled, currentUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { serverT } from "@/lib/i18n/server";
import { personOf } from "@/lib/person";
import { parseBody } from "@/lib/validate";

// The account's own profile: name, symbol, color, picture. The picture is a
// small data URL the settings page resizes client-side; Postgres holds it like
// it holds PDF bytes — zero-config deploys.

const MAX_PICTURE_CHARS = 400_000; // ≈ 300 KB of base64

const putSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  symbol: z.string().trim().max(8).optional(),
  color: z.union([z.literal(""), z.string().regex(/^#[0-9a-fA-F]{6}$/)]).optional(),
  picture: z.string().max(MAX_PICTURE_CHARS).optional(), // data URL; "" clears
});

export async function PUT(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  if (!authEnabled()) {
    return NextResponse.json({ error: t("api.profileNeedsSignIn") }, { status: 400 });
  }
  const { data, error } = await parseBody(req, putSchema);
  if (error) return error;

  if (
    data.picture !== undefined &&
    data.picture !== "" &&
    !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data.picture)
  ) {
    return NextResponse.json({ error: t("api.pictureInvalid") }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.symbol !== undefined ? { symbol: data.symbol } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
      ...(data.picture !== undefined ? { picture: data.picture } : {}),
    },
  });
  return NextResponse.json({ ...personOf(updated), email: updated.email });
}
