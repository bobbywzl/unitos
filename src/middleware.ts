import { NextResponse, type NextRequest } from "next/server";
import { ACCOUNT_COOKIE, ACCOUNT_HEADER, SESSION_COOKIE } from "@/lib/constants";
import { isLang, LANG_COOKIE, type Lang } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/dictionaries";

// The dictionaries are plain data, safe at the edge. The request cookie picks
// the language for the two error bodies this gate can send.
function requestLang(request: NextRequest): Lang {
  const value = request.cookies.get(LANG_COOKIE)?.value;
  return isLang(value) ? value : "en";
}

// Edge gate, two doors (Scalae pattern):
// 1. /admin has its own password cookie gate (lib/admin-auth), deliberately
//    decoupled from reader sign-in — an admin need not be a signed-in reader.
// 2. Everything else requires a session cookie when Google sign-in is
//    configured. A fast presence check only — real validation happens in
//    lib/auth (currentUser); this shapes the redirect UX. With sign-in off
//    (single-reader mode) everything passes through.
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (pathname === "/admin/login" || pathname.startsWith("/api/admin/auth")) {
      return NextResponse.next();
    }
    const adminAuth = request.cookies.get("admin-auth")?.value;
    if (adminAuth !== "true") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: translate(requestLang(request), "common.unauthorized") },
          { status: 401 },
        );
      }
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
    return NextResponse.next();
  }

  // Same switch as lib/auth authEnabled() — not imported, that module needs
  // node:crypto and this runs at the edge.
  const authOn = Boolean(
    process.env.SESSION_SECRET &&
      ((process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) ||
        (process.env.APPLE_CLIENT_ID &&
          process.env.APPLE_TEAM_ID &&
          process.env.APPLE_KEY_ID &&
          process.env.APPLE_PRIVATE_KEY) ||
        (process.env.RESEND_API_KEY && process.env.EMAIL_FROM)),
  );
  if (!authOn) return NextResponse.next();

  // Public doors: the sign-in page, the password reset page, the auth
  // callbacks, the cron endpoint, and the two legal documents — those are
  // linked from Google's consent screen, so a signed-out reader must reach
  // them without hitting the gate.
  if (
    pathname === "/signin" ||
    pathname === "/reset" ||
    pathname === "/privacy" ||
    pathname === "/terms" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/api/cron/")
  ) {
    return NextResponse.next();
  }
  // A stale tab's API call: the page was rendered for one account (the header
  // api() sends) but the browser has since signed into another (the account
  // cookie). Refuse instead of writing as the wrong account; the tab's account
  // guard shows the notice.
  if (pathname.startsWith("/api/")) {
    const rendered = request.headers.get(ACCOUNT_HEADER);
    const account = request.cookies.get(ACCOUNT_COOKIE)?.value;
    if (rendered && account && rendered !== account) {
      return NextResponse.json(
        { error: translate(requestLang(request), "common.accountChanged") },
        { status: 409 },
      );
    }
  }
  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { error: translate(requestLang(request), "common.signInToContinue") },
      { status: 401 },
    );
  }
  return NextResponse.redirect(new URL("/signin", request.url));
}

export const config = {
  // Everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|ico)$).*)"],
};
