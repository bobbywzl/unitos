import { db } from "@/lib/db";
import { outboundFetch } from "@/lib/outbound-fetch";
import { youtubeWatchUrl } from "@/lib/video/youtube";
import type { OnIngestProgress } from "@/lib/parse/ingest";

// A YouTube link becomes a video document (SPEC.md §11): Document + VIDEO
// block + VideoAsset kind YOUTUBE. No bytes are stored — the video plays
// through the IFrame player. Dedupe by youtubeId: re-adding attaches the
// existing document. oEmbed supplies the title and proves the video exists.
export async function ingestYouTube(youtubeId: string, onProgress?: OnIngestProgress) {
  const existing = await db.videoAsset.findUnique({
    where: { youtubeId },
    select: { documentId: true },
  });
  if (existing) {
    const document = await db.document.findUniqueOrThrow({ where: { id: existing.documentId } });
    return { document, deduped: true };
  }

  onProgress?.("fetch");
  const title = await fetchYouTubeTitle(youtubeId);
  onProgress?.("save");
  const document = await db.$transaction(async (tx) => {
    const doc = await tx.document.create({
      data: { title, sourceUrl: youtubeWatchUrl(youtubeId) },
    });
    await tx.block.create({
      data: { documentId: doc.id, order: 0, type: "VIDEO", text: title },
    });
    await tx.videoAsset.create({
      data: { documentId: doc.id, kind: "YOUTUBE", youtubeId },
    });
    return doc;
  });
  return { document, deduped: false };
}

async function fetchYouTubeTitle(youtubeId: string): Promise<string> {
  const res = await outboundFetch(
    `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeWatchUrl(youtubeId))}&format=json`,
    {},
  );
  if (!res.ok) {
    throw new Error("This YouTube video is not available. It may be private or removed.");
  }
  const body = (await res.json().catch(() => null)) as { title?: string } | null;
  return body?.title?.trim() || youtubeWatchUrl(youtubeId);
}
