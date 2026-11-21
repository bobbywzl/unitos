import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";
import { storeImage } from "@/lib/image-store";

export const maxDuration = 60;

// One image dropped into a note or into the reader's edit mode (SPEC.md §16).
// The bytes are the whole body — no form, no base64. Vercel caps a request
// body at about 4.5 MB: a larger image comes in chunks (POST /api/uploads)
// and /api/images/complete stores it (lib/images.ts uploadImage).
export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });
  return storeImage(new Uint8Array(await req.arrayBuffer()), user, t);
}
