import { NextResponse } from "next/server";

// Universal links for the app (SPEC.md §33). iOS reads this file from the
// site and, for the addresses it lists, opens the app instead of Safari. The
// two listed are the links the site emails: the sign-in link and the
// password reset link. Opened in Safari they would sign Safari in, not the
// app; opened in the app, its web view loads them and is signed in.
//
// IOS_APP_ID is the app's id as Apple writes it, "<Team ID>.<bundle id>"
// (several, separated by commas). Unset, the file does not exist and every
// link opens in the browser as before.
export const dynamic = "force-dynamic";

export function GET() {
  const appIDs = (process.env.IOS_APP_ID ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(id));
  if (appIDs.length === 0) return new NextResponse(null, { status: 404 });
  return NextResponse.json({
    applinks: {
      details: [
        {
          appIDs,
          components: [{ "/": "/api/auth/email/confirm" }, { "/": "/reset" }],
        },
      ],
    },
  });
}
