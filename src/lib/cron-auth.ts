import { timingSafeEqual } from "node:crypto";

// The credential of server-only calls: the cron routes (vercel.json), and
// the transcription job's next leg (lib/video/transcription-job.ts). Vercel
// sends `Authorization: Bearer <CRON_SECRET>` on a cron call from the
// project's env; the leg sends the same header itself. A value pasted into
// the env with a trailing newline or space would never match, so both
// sides are trimmed. A refused call logs why — whether a header came at all
// and the two lengths, never the values — so the function log says what
// is wrong.

/** The secret as the env holds it, trimmed; null when unset or blank. */
export function cronSecret(): string | null {
  const value = process.env.CRON_SECRET?.trim();
  return value ? value : null;
}

/** Whether the request carries the secret. False with a reason logged. */
export function cronAuthorized(req: Request, label: string): boolean {
  const secret = cronSecret();
  if (!secret) return false;
  const header = req.headers.get("authorization")?.trim() ?? "";
  const sent = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(sent);
  const b = Buffer.from(secret);
  const ok = a.length === b.length && timingSafeEqual(a, b);
  if (!ok) {
    console.warn(
      `[${label}] unauthorized: ${header ? `bearer of ${sent.length} chars` : "no authorization header"}; CRON_SECRET has ${secret.length} chars`,
    );
  }
  return ok;
}
