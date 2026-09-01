// Google Drive upload (SPEC.md §14) is a new ingest source, not reader
// sign-in: the client picks files with the Google Picker, using an OAuth
// token requested entirely in the browser (Google Identity Services). The app
// never stores a Drive token or refresh token — see lib/drive/picker-client.ts.
//
// GOOGLE_CLIENT_ID is the same OAuth client Google sign-in uses (lib/auth.ts);
// the deployer additionally lists this app's origin under that client's
// "Authorized JavaScript origins" in the Google Cloud console — a different
// list from the redirect URI sign-in uses, and required for the browser token
// flow to work. GOOGLE_PICKER_API_KEY is optional: a separate API key
// restricted to the Picker API that improves file previews in the picker: the
// feature works without it. Neither set = the option stays hidden, the same
// DUAL MODE as sign-in (deploys never brick on missing credentials).
export type DriveConfig = { clientId: string; apiKey: string | null };

export function driveConfig(): DriveConfig | null {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return null;
  return { clientId, apiKey: process.env.GOOGLE_PICKER_API_KEY ?? null };
}
