// The admin gate's checks (SPEC.md §2), against a running app. Run it with
// the app's ADMIN_PASSWORD, and the app's SESSION_SECRET when it has one:
//   1. a value signed here with the app's key opens the gate (the control:
//      the refusals that follow test the expiry and the password, not a
//      different key);
//   2. no cookie, a forged admin-auth=true, a made-up signed value, a value
//      signed with another password (an old cookie after a password change),
//      and an expired value each get a redirect to /admin/login on /admin and
//      401 on /api/admin/feedback;
//   3. a wrong password gets 401 and no cookie;
//   4. the right password gets 200 and a signed cookie with its flags
//      (HttpOnly, SameSite=Lax, Max-Age=86400, Path=/), which opens /admin and
//      /api/admin/feedback; the same value with its MAC or its expiry changed
//      is refused;
//   5. sign-out clears the cookie.
// Usage:
//   ADMIN_PASSWORD=... npx tsx --tsconfig tsconfig.json scripts/qa/admin-gate.ts [base URL]
// The base URL defaults to http://localhost:3311.
import { ADMIN_COOKIE, signAdminCookie } from "@/lib/admin-cookie";

const base = process.argv[2] ?? "http://localhost:3311";

const results: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
};

// One page and one API route behind the gate.
const PAGE = "/admin";
const API = "/api/admin/feedback";
const HOUR = 60 * 60 * 1000;

const get = (path: string, value?: string) =>
  fetch(`${base}${path}`, {
    redirect: "manual",
    headers: value === undefined ? {} : { cookie: `${ADMIN_COOKIE}=${value}` },
  });

const login = (given: string) =>
  fetch(`${base}/api/admin/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: given }),
  });

async function refused(name: string, value?: string) {
  const page = await get(PAGE, value);
  const location = page.headers.get("location") ?? "";
  check(
    `${name}: ${PAGE} redirects to /admin/login`,
    page.status === 307 && new URL(location, base).pathname === "/admin/login",
    `${page.status} ${location}`,
  );
  const api = await get(API, value);
  check(`${name}: ${API} answers 401`, api.status === 401, String(api.status));
}

async function opened(name: string, value: string) {
  const page = await get(PAGE, value);
  check(`${name}: ${PAGE} answers 200`, page.status === 200, String(page.status));
  const api = await get(API, value);
  check(`${name}: ${API} answers 200`, api.status === 200, String(api.status));
}

async function main() {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error("usage: ADMIN_PASSWORD=... npx tsx --tsconfig tsconfig.json scripts/qa/admin-gate.ts [base URL]");
    process.exit(2);
  }

  // 1. The control.
  await opened("signed here with the app's key", await signAdminCookie(password));

  // 2. Forged and stale values.
  await refused("no cookie");
  await refused("forged admin-auth=true", "true");
  await refused("made-up signed value", `${Date.now() + HOUR}.${"0".repeat(64)}`);
  await refused("signed with another password", await signAdminCookie(`${password}-old`));
  await refused("expired", await signAdminCookie(password, Date.now() - 25 * HOUR));

  // 3. A wrong password.
  const wrong = await login(`${password}-wrong`);
  check("wrong password answers 401", wrong.status === 401, String(wrong.status));
  check("wrong password sets no cookie", wrong.headers.get("set-cookie") === null);

  // 4. The right password.
  const right = await login(password);
  check("sign-in answers 200", right.status === 200, String(right.status));
  const setCookie = right.headers.get("set-cookie") ?? "";
  const value = new RegExp(`${ADMIN_COOKIE}=([^;]*)`).exec(setCookie)?.[1] ?? "";
  check("sign-in sets a signed value", /^\d+\.[0-9a-f]{64}$/.test(value));
  check(
    "cookie flags: HttpOnly, SameSite=Lax, Max-Age=86400, Path=/",
    /HttpOnly/i.test(setCookie) &&
      /SameSite=Lax/i.test(setCookie) &&
      /Max-Age=86400/.test(setCookie) &&
      /Path=\//.test(setCookie),
    setCookie.replace(value, "<value>"),
  );
  await opened("signed in", value);
  const [expires = "", mac = ""] = value.split(".");
  await refused("MAC changed", `${expires}.${mac.slice(0, -1)}${mac.endsWith("0") ? "1" : "0"}`);
  await refused("expiry changed", `${Number(expires) + HOUR}.${mac}`);

  // 5. Sign-out.
  const out = await fetch(`${base}/api/admin/auth`, {
    method: "DELETE",
    headers: { cookie: `${ADMIN_COOKIE}=${value}` },
  });
  const cleared = out.headers.get("set-cookie") ?? "";
  check(
    "sign-out clears the cookie",
    out.status === 200 && cleared.startsWith(`${ADMIN_COOKIE}=;`) && /Max-Age=0/.test(cleared),
    cleared,
  );

  console.log(results.join("\n"));
  process.exit(results.some((line) => line.startsWith("FAIL")) ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
