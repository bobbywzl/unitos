import { db } from "@/lib/db";
import { formatTimeRange } from "@/lib/video/types";

// The anchor block and quoted text for a time range (SPEC.md §11): the first
// transcript block overlapping the range when one exists, else the VIDEO block.
// quotedText is the transcript excerpt for the range — clipped — else the
// formatted time range, so source chips read well either way.
export async function videoAnchorFor(
  documentId: string,
  startTime: number,
  endTime: number,
): Promise<{ blockId: string; quotedText: string } | null> {
  const blocks = await db.block.findMany({
    where: { documentId, type: { in: ["VIDEO", "TRANSCRIPT"] } },
    orderBy: { order: "asc" },
    select: { id: true, type: true, text: true, startTime: true, endTime: true },
  });
  const videoBlock = blocks.find((b) => b.type === "VIDEO") ?? null;
  const overlapping = blocks.filter(
    (b) =>
      b.type === "TRANSCRIPT" &&
      b.startTime !== null &&
      b.endTime !== null &&
      b.startTime < endTime &&
      b.endTime > startTime,
  );
  const anchorBlock = overlapping[0] ?? videoBlock;
  if (!anchorBlock) return null;
  const excerpt = overlapping.map((b) => b.text).join(" ").trim();
  const quotedText =
    excerpt.length > 240
      ? `${excerpt.slice(0, 239)}…`
      : excerpt || formatTimeRange(startTime, endTime);
  return { blockId: anchorBlock.id, quotedText };
}
