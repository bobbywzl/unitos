import { NextResponse, type NextRequest } from "next/server";

// Edge gate for the admin area. /admin/login and /api/admin/auth stay open —
// they are the gate (release-edu pattern).
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/admin/login" || pathname.startsWith("/api/admin/auth")) {
    return NextResponse.next();
  }
  const adminAuth = request.cookies.get("admin-auth")?.value;
  if (adminAuth !== "true") {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
