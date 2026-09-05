// Long media transcription (SPEC.md §11), against the running app: a file far
// past the Whisper cap must reach the Gemini rung instead of being refused
// before the ladder runs, and must still be refused plainly when there is no
// Gemini key to reach it with.
//
// The ladder's own calls need real provider keys, so what is checked here is
// which rungs the job attempts and what it reports — not the transcript.
// Run it twice against the app: once started with GEMINI_API_KEY set
// (EXPECT_GEMINI=1), once with only GROQ_API_KEY — with no provider key at all
// the job stops at "transcription needs a key", before any of this.
// Env: PORT (default 3311), EXPECT_GEMINI.
import { PrismaClient } from "@prisma/client";

const PORT = process.env.PORT ?? "3311";
const db = new PrismaClient();
const results = [];
const check = (name, ok, detail = "") =>
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);

// Bigger than the 14 MB inline cap, so the run has to use Gemini's file store.
const CHUNK_BYTES = 15 * 1024 * 1024;
// What an hour of video weighs, as the asset reports it.
const HOUR_BYTES = 120 * 1024 * 1024;

async function fixture(mimeType) {
  const document = await db.document.create({
    data: { title: `QA long media (${mimeType})` },
  });
  const asset = await db.videoAsset.create({
    data: {
      documentId: document.id,
      kind: "UPLOAD",
      mimeType,
      size: HOUR_BYTES,
      chunkSize: CHUNK_BYTES,
      duration: 3600,
    },
  });
  await db.videoChunk.create({
    data: { videoId: asset.id, index: 0, data: Buffer.alloc(CHUNK_BYTES) },
  });
  return document.id;
}

async function transcribeNow(documentId) {
  const res = await fetch(`http://localhost:${PORT}/api/documents/${documentId}/transcribe`, {
    method: "POST",
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, error: String(body.error ?? "") };
}

const withKey = process.env.EXPECT_GEMINI === "1";
const mp4 = await fixture("video/mp4");
const run = await transcribeNow(mp4);
console.log(`  ${run.status}: ${run.error.slice(0, 220)}`);

if (withKey) {
  check(
    "a 120 MB upload is not refused before the ladder runs",
    !/larger than 25 MB/i.test(run.error),
    run.error.slice(0, 90),
  );
  check("the ladder reaches the Gemini rung", /Gemini/i.test(run.error), run.error.slice(0, 90));
  check(
    "the Whisper rungs report their missing keys",
    /GROQ_API_KEY is not set/.test(run.error) && /OPENAI_API_KEY is not set/.test(run.error),
  );
  check(
    "the run got past the 14 MB inline cap into the file store",
    !/14 MB inline cap/i.test(run.error),
    run.error.slice(0, 90),
  );
} else {
  check(
    "without a Gemini key the cap is reported plainly",
    /larger than 25 MB/i.test(run.error) && /GEMINI_API_KEY/.test(run.error),
    run.error.slice(0, 120),
  );
}

// An MP3 that big has always had the chunked Whisper path; it must still not
// be refused up front.
const mp3 = await fixture("audio/mpeg");
const mp3Run = await transcribeNow(mp3);
check(
  "a long MP3 is not refused before the ladder runs",
  !/larger than 25 MB/i.test(mp3Run.error),
  mp3Run.error.slice(0, 90),
);

// Past the app's own upload ceiling nothing can be done, and the reason says so.
const huge = await db.document.create({ data: { title: "QA past the ceiling" } });
await db.videoAsset.create({
  data: { documentId: huge.id, kind: "UPLOAD", mimeType: "video/mp4", size: 300 * 1024 * 1024 },
});
const hugeRun = await transcribeNow(huge.id);
check(
  "past the upload ceiling the reason says so",
  /200 MB upload cap/i.test(hugeRun.error),
  hugeRun.error.slice(0, 90),
);

for (const id of [mp4, mp3, huge.id]) {
  await db.document.delete({ where: { id } }).catch(() => {});
}
await db.$disconnect();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
