// The upload limits and the media file test, in a module without zod: the
// offline queue (lib/offline/queue.ts) reads them on every page, and
// lib/video/types.ts, which re-exports them, carries the schemas.
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const UPLOAD_CHUNK_BYTES = 3_500_000;

// Video and audio file extensions — one list for file names and URL paths:
// the video file picker, the drop filter, and direct media links.
export const MEDIA_EXTENSIONS = /\.(mp4|m4v|webm|ogv|ogg|mov|mp3|m4a|m4b|aac|wav|flac|oga|opus)$/i;

/** A direct video or audio file URL: the path ends in a media extension. */
export function isMediaUrl(raw: string): boolean {
  try {
    return MEDIA_EXTENSIONS.test(new URL(raw.trim()).pathname);
  } catch {
    return false;
  }
}

// A drawn region on the video frame, in percent coordinates (0–100) of the
// frame — never pixels — so it stays glued to the same spot at any player size.
// The draw tool makes a freehand closed loop (kind "path"); kind "ellipse"
// stays valid for annotations drawn before the loop tool.
