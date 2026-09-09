import { z } from "zod";
import { isImageFile } from "@/lib/handwritten/image";
import { imageMarkdown } from "@/lib/images";

// Attachments in the assistant conversation (SPEC.md §7): the reader adds
// images and files to a message. This file is imported by both the client
// (the composer's picker, paste, and drop) and the server (the attach route
// and the assistant route) — one definition of what is accepted and how much.
//
// An image stores through POST /api/images and rides as its id; the assistant
// route attaches its bytes to the message, so the model sees the picture. A
// file becomes text before it is sent: a text file in the browser, a PDF
// through POST /api/assistant/attach; the text rides in the message.

// A file's text past this is cut, with a marker at the cut.
export const FILE_MAX_CHARS = 120_000;
// The largest file the attach route reads.
export const FILE_MAX_BYTES = 20 * 1024 * 1024;
// Per message.
export const MAX_FILES_PER_MESSAGE = 5;
export const MAX_IMAGES_PER_MESSAGE = 4;
// Images across the whole conversation reach the model; older ones past this
// count are named, not shown.
export const MAX_IMAGES_PER_CONVERSATION = 8;
// A file name shown in a chip and in the prompt is cut here.
export const FILE_NAME_MAX = 120;
// The turns the assistant route reads: the newest ones.
export const MAX_HISTORY_TURNS = 40;
// A turn's text past this is cut before it is sent again as history.
export const TURN_MAX_CHARS = 20_000;

// Text files the browser reads itself.
export const TEXT_EXTENSIONS =
  /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|yaml|yml|tex|bib|log|rst|org|py|js|jsx|ts|tsx|java|c|h|cpp|hpp|cs|go|rs|rb|php|swift|kt|sql|sh|bash|zsh|toml|ini|cfg|conf)$/i;
export const PDF_EXTENSION = /\.pdf$/i;

// The file input's accept list: images, PDF, and the text files above.
export const FILE_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  "application/pdf",
  ".pdf",
  "text/*",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".xml",
  ".html",
  ".htm",
  ".yaml",
  ".yml",
  ".tex",
  ".bib",
  ".log",
  ".rst",
  ".org",
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cs",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".swift",
  ".kt",
  ".sql",
  ".sh",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
].join(",");

export type AttachmentKind = "image" | "pdf" | "text";

/** What a picked file is to the composer; null for a file it does not take. */
export function attachmentKind(file: { type: string; name: string }): AttachmentKind | null {
  if (isImageFile(file)) return "image";
  if (file.type === "application/pdf" || PDF_EXTENSION.test(file.name)) return "pdf";
  if (file.type.startsWith("text/") || TEXT_EXTENSIONS.test(file.name)) return "text";
  return null;
}

/** The file's text as the message carries it: cut at FILE_MAX_CHARS with a
    marker, never silently. */
export function capFileText(text: string): string {
  const clean = text.replace(/\r\n?/g, "\n").replace(/\f/g, "\n");
  if (clean.length <= FILE_MAX_CHARS) return clean;
  return `${clean.slice(0, FILE_MAX_CHARS)}\n[cut: the file goes on past ${FILE_MAX_CHARS} characters]`;
}

export function capFileName(name: string): string {
  return name.trim().slice(0, FILE_NAME_MAX) || "file";
}

// A file as one message carries it: the current message sends its text; an
// earlier message sends its name alone — its answer already read the text.
export const attachedFileSchema = z.object({
  name: z.string().min(1).max(FILE_NAME_MAX),
  text: z.string().max(FILE_MAX_CHARS + 200).optional(),
});
export type AttachedFile = z.infer<typeof attachedFileSchema>;

// An image as a message carries it: the stored image's id (POST /api/images).
export const attachedImageSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(FILE_NAME_MAX).optional(),
});
export type AttachedImage = z.infer<typeof attachedImageSchema>;

// One turn of the conversation as the client sends it (SPEC.md §7): the
// reader's message with its attachments, or the assistant's answer.
export const conversationTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(TURN_MAX_CHARS),
  images: z.array(attachedImageSchema).max(MAX_IMAGES_PER_MESSAGE).optional(),
  files: z.array(attachedFileSchema).max(MAX_FILES_PER_MESSAGE).optional(),
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

// Saving the conversation (SPEC.md §7, §21): a reader's turn persists as one
// line of the note's markdown per attachment, after the question text — an
// image as the same markdown a note carries an image in (lib/images.ts),
// a file as one bracket line. Both read back naturally as plain language
// when the digest hands the note to the model (lib/digest/build.ts), and
// both parse back out exactly on restore (parseTurnContent below).
const FILE_MARKER = /^\[attached file: (.+)\]$/;
const IMAGE_MARKDOWN = /^!\[([^\]]*)\]\(\/api\/images\/([A-Za-z0-9_-]+)\)$/;

export function embedAttachments(
  content: string,
  images: { id: string; name: string }[],
  files: { name: string }[],
): string {
  const blocks = [content.trim()];
  if (images.length > 0) blocks.push(images.map((img) => imageMarkdown(img.id, img.name)).join("\n"));
  if (files.length > 0) blocks.push(files.map((f) => `[attached file: ${f.name}]`).join("\n"));
  return blocks.filter((b) => b !== "").join("\n\n");
}

/** The reverse of embedAttachments: a stored turn's text, split back into its
    typed content and the attachments trailing it — so a restored turn renders
    exactly like the turn that was sent (SPEC.md §7). A turn with no embedded
    attachments (an assistant's answer; an older note stored before
    attachments existed) comes back unchanged, images and files empty. */
export function parseTurnContent(raw: string): {
  content: string;
  images: { id: string; name: string }[];
  files: { name: string }[];
} {
  const lines = raw.split("\n");
  const files: { name: string }[] = [];
  const images: { id: string; name: string }[] = [];
  const popTrailingBlock = (test: (line: string) => boolean, onMatch: (line: string) => void) => {
    while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
    const block: string[] = [];
    while (lines.length > 0 && test(lines[lines.length - 1]!.trim())) block.unshift(lines.pop()!.trim());
    block.forEach(onMatch);
  };
  popTrailingBlock(
    (line) => FILE_MARKER.test(line),
    (line) => {
      const m = FILE_MARKER.exec(line);
      if (m) files.unshift({ name: m[1]! });
    },
  );
  popTrailingBlock(
    (line) => IMAGE_MARKDOWN.test(line),
    (line) => {
      const m = IMAGE_MARKDOWN.exec(line);
      if (m) images.unshift({ id: m[2]!, name: m[1]! });
    },
  );
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === "") lines.pop();
  return { content: lines.join("\n"), images, files };
}
