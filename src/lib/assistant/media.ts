import { capFileText } from "@/lib/assistant/attachments";
import { groupSegments, transcribe } from "@/lib/video/transcribe";
import { formatTime } from "@/lib/video/types";

// A video or audio attachment (SPEC.md §7) becomes text here: the same
// transcription ladder a media document takes (SPEC.md §11), grouped into
// transcript lines, each stamped with its time. The text rides in the
// message like any file's; nothing is stored.
export async function mediaAttachmentText(
  bytes: Uint8Array<ArrayBuffer>,
  mimeType: string | null,
  name: string,
  deadline: number,
): Promise<string> {
  const { segments } = await transcribe({ kind: "upload", bytes, mimeType }, { deadline });
  const kind = (mimeType ?? "").startsWith("audio/") ? "audio" : "video";
  const lines = groupSegments(segments).map((s) => `[${formatTime(s.start)}] ${s.text}`);
  return capFileText(
    [`Transcript of the attached ${kind} "${name}", one line per stretch of speech, each stamped with its time:`, "", ...lines].join("\n"),
  );
}
