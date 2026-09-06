import { authEnabled } from "@/lib/auth";
import { type DriveAccess, driveGrant } from "@/lib/drive/types";

// Google Drive upload (SPEC.md §14) is a new ingest source, not reader
// sign-in: the client picks files with the Google Picker, using an OAuth
// token requested entirely in the browser (Google Identity Services), or —
// once the account linked Google Drive — minted server-side from the stored
// refresh token (lib/drive/link.ts).
//
// GOOGLE_CLIENT_ID is the same OAuth client Google sign-in uses (lib/auth.ts);
// the deployer additionally lists this app's origin under that client's
// "Authorized JavaScript origins" in the Google Cloud console — a different
// list from the redirect URI sign-in uses, and required for the browser token
// flow to work. GOOGLE_PICKER_API_KEY is optional: a separate API key
// restricted to the Picker API that improves file previews in the picker: the
// feature works without it. Neither set = the option stays hidden, the same
// DUAL MODE as sign-in (deploys never brick on missing credentials).
// GOOGLE_DRIVE_ACCESS picks the scope every grant asks for (lib/drive/types.ts):
// "all" (default) reads every file the account can read; "picked" reads the
// files the reader picks only.
// access: what a link or a per-visit grant asks for.
// grant: what the linked account's stored grant reaches; null = not linked.
// linked: this account stored a Drive refresh token (Link Google Drive);
// the picker then gets its token from /api/drive/token, no consent popup.
// canLink: the link flow is available — Google sign-in configured and on.
export type DriveConfig = {
  clientId: string;
  apiKey: string | null;
  access: DriveAccess;
  grant: DriveAccess | null;
  linked: boolean;
  canLink: boolean;
};

export function driveAccess(): DriveAccess {
  return process.env.GOOGLE_DRIVE_ACCESS === "picked" ? "picked" : "all";
}

export function driveConfig(
  account?: { driveRefreshToken: string; driveScope: string } | null,
): DriveConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return null;
  const linked = Boolean(account?.driveRefreshToken);
  return {
    clientId,
    apiKey: process.env.GOOGLE_PICKER_API_KEY ?? null,
    access: driveAccess(),
    grant: linked && account ? driveGrant(account.driveScope) : null,
    linked,
    // Linking needs the sign-in OAuth client's secret for the code flow and an
    // account row to store the grant on (lib/drive/link.ts; the local reader
    // has none).
    canLink: authEnabled() && Boolean(process.env.GOOGLE_CLIENT_SECRET && process.env.SESSION_SECRET),
  };
}
