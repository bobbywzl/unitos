import { NextResponse } from "next/server";
import { z } from "zod";
import { documentAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { parseBody } from "@/lib/validate";

// A clock set ahead would win every later save: an `at` counts no later
// than this far past the server's clock.
const AHEAD_MS = 60_000;

const Body = z.object({
  blockId: z.string().min(1).max(100),
  // px from the reading line to the block's top; negative = the line cut into the block
  offset: z.number().min(-1e7).max(1e7),
  // the block's height in px when it was read
  height: z.number().min(0).max(1e7),
  // when the reader was there: ms since the epoch, by the reading browser's clock
  at: z.number().int().min(0),
});

// The account's copy of the reading position (SPEC.md §6,
// lib/reading-position.ts). PUT (viewer: everyone who reads the document
// keeps their own place) saves the block at the reading line, the offset,
// the block's height, and when the reader was there. The row changes only
// when the save is newer than it, so a tab that closes on an old position
// never overwrites a newer one from another tab or device. A document that
// is gone saves nothing. The position is the account's own, not the
// project's: no rev moves, nothing lands in the history.
export async function PUT(req: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await ctx.params;
  const access = await documentAccess(documentId, "viewer");
  if (access instanceof NextResponse) return access;
  const { data, error } = await parseBody(req, Body);
  if (error) return error;

  const at = new Date(Math.min(data.at, Date.now() + AHEAD_MS));
  await db.$executeRaw`
    INSERT INTO "ReadingPosition" ("userId", "documentId", "blockId", "offset", "height", "at")
    SELECT ${access.user.id}, "id", ${data.blockId}, ${data.offset}, ${data.height}, ${at}
    FROM "Document" WHERE "id" = ${documentId}
    ON CONFLICT ("userId", "documentId") DO UPDATE
    SET "blockId" = EXCLUDED."blockId", "offset" = EXCLUDED."offset",
        "height" = EXCLUDED."height", "at" = EXCLUDED."at"
    WHERE "ReadingPosition"."at" < EXCLUDED."at"
  `;
  return NextResponse.json({ ok: true });
}
