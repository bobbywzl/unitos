import { NextResponse } from "next/server";
import { extractText } from "unpdf";
import { capFileText, FILE_MAX_BYTES } from "@/lib/assistant/attachments";
import { currentUser } from "@/lib/auth";
import { serverT } from "@/lib/i18n/server";

export const maxDuration = 60;

// A file attached to an assistant message becomes text here (SPEC.md §7): a
// PDF's text layer, or a text file decoded as UTF-8. The bytes are the whole
// body — no form, no base64. The text goes back to the browser, which sends
// it inside the message; nothing is stored.
export async function POST(req: Request) {
  const t = await serverT();
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: t("api.signInRequired") }, { status: 401 });

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0) return NextResponse.json({ error: t("api.emptyChunk") }, { status: 400 });
  if (bytes.length > FILE_MAX_BYTES) {
    return NextResponse.json({ error: t("api.attachmentTooLarge") }, { status: 413 });
  }

  // "%PDF-" opens every PDF; the format is read from the bytes, never from
  // the file name.
  const isPdf =
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d;
  let text: string;
  if (isPdf) {
    try {
      // pdf.js transfers (detaches) the buffer it receives — parse a copy.
      const result = await extractText(new Uint8Array(bytes), { mergePages: true });
      text = result.text;
    } catch (err) {
      console.error("[assistant] attach: PDF unreadable:", err);
      return NextResponse.json({ error: t("api.attachmentUnreadable") }, { status: 422 });
    }
  } else {
    // A NUL byte in the first kilobytes means binary, not text.
    if (bytes.subarray(0, 8192).includes(0)) {
      return NextResponse.json({ error: t("api.attachmentNotText") }, { status: 400 });
    }
    text = new TextDecoder("utf-8").decode(bytes);
  }
  if (!text.trim()) {
    return NextResponse.json({ error: t("api.attachmentEmpty") }, { status: 422 });
  }
  return NextResponse.json({ text: capFileText(text) });
}
