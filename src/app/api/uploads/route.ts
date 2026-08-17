import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export const maxDuration = 60;

// One chunk of a large PDF upload. Vercel caps a request body at about 4.5 MB,
// so the client splits big files and sends each piece here; /api/uploads/complete
// assembles them and runs normal ingest. Chunks are staging rows only.
const MAX_CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNKS = 16; // 50 MB total at 3.5 MB per chunk

const paramsSchema = z.object({
  uploadId: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),
  index: z.coerce.number().int().min(0).max(MAX_CHUNKS - 1),
});

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const params = paramsSchema.safeParse({
    uploadId: searchParams.get("uploadId"),
    index: searchParams.get("index"),
  });
  if (!params.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: params.error.issues },
      { status: 400 },
    );
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: "Empty chunk" }, { status: 400 });
  }
  if (bytes.length > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: "Chunk is larger than 4 MB" }, { status: 413 });
  }

  const { uploadId, index } = params.data;
  if (index === 0) {
    // Abandoned uploads (complete never ran) sweep out after a day.
    await db.uploadChunk.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
  }
  await db.uploadChunk.upsert({
    where: { uploadId_index: { uploadId, index } },
    update: { data: bytes },
    create: { uploadId, index, data: bytes },
  });
  return NextResponse.json({ ok: true });
}
