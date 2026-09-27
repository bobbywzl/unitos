// The admin cookie (SPEC.md §2): the /admin gate, apart from reader sign-in.
// Its value is its expiry and an HMAC of the expiry, keyed by SESSION_SECRET
// (when set) and ADMIN_PASSWORD. Nobody without the key can make one; a new
// ADMIN_PASSWORD makes every old one fail; with ADMIN_PASSWORD unset, none
// passes. Web Crypto only, so the edge middleware and the server run this one
// check.

export const ADMIN_COOKIE = "admin-auth";
// 24 hours, in seconds: the cookie's Max-Age and the value's own expiry.
export const ADMIN_COOKIE_MAX_AGE = 60 * 60 * 24;

const encoder = new TextEncoder();

// SESSION_SECRET, when set, keeps a cookie value from being used to guess a
// weak ADMIN_PASSWORD offline.
function adminKey(password: string): string {
  return `${process.env.SESSION_SECRET ?? ""}\n${password}`;
}

async function hmac(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Constant time: the loop reads every character, wherever the first
// difference is. The length is public (64 hex characters).
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The admin cookie's value after a sign-in with this password. */
export async function signAdminCookie(password: string, now = Date.now()): Promise<string> {
  const expires = String(now + ADMIN_COOKIE_MAX_AGE * 1000);
  return `${expires}.${await hmac(adminKey(password), `admin.${expires}`)}`;
}

/** True when the value is an admin cookie signed with the current
    ADMIN_PASSWORD and not yet expired. False when ADMIN_PASSWORD is unset. */
export async function verifyAdminCookie(value: string | undefined, now = Date.now()): Promise<boolean> {
  const password = process.env.ADMIN_PASSWORD;
  if (!password || !value) return false;
  const match = /^(\d{1,16})\.([0-9a-f]{64})$/.exec(value);
  if (!match || Number(match[1]) <= now) return false;
  return sameText(await hmac(adminKey(password), `admin.${match[1]}`), match[2]);
}
