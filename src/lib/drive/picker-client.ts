"use client";

import {
  DRIVE_FOLDER_MIME_TYPE,
  DRIVE_PICKER_MIME_TYPES,
  DRIVE_SCOPES,
  type DriveAccess,
  type DrivePickedFile,
  driveAppId,
} from "@/lib/drive/types";

// Google Drive upload (SPEC.md §14), the browser half: load Google Identity
// Services and the Picker on demand, get a short-lived OAuth token with no
// server round trip, let the reader pick files, hand back the token plus what
// was picked. Nothing here is stored — the token lives only for this tab, and
// only for as long as it takes to import what was picked.

type GoogleTokenResponse = { access_token?: string; error?: string; error_description?: string };
type GoogleTokenClient = { requestAccessToken: (opts?: { prompt?: string }) => void };
type GoogleAccountsOAuth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type: string }) => void;
  }) => GoogleTokenClient;
};

type PickerDoc = { id: string; name: string; mimeType: string; sizeBytes?: string | number };
type PickerResponse = { action: string; docs?: PickerDoc[] };
type PickerDocsView = {
  setIncludeFolders: (v: boolean) => PickerDocsView;
  setSelectFolderEnabled: (v: boolean) => PickerDocsView;
  setEnableDrives: (v: boolean) => PickerDocsView;
  setOwnedByMe: (v: boolean) => PickerDocsView;
  setStarred: (v: boolean) => PickerDocsView;
  setParent: (parentId: string) => PickerDocsView;
  setMimeTypes: (types: string) => PickerDocsView;
};
type PickerBuilder = {
  addView: (view: PickerDocsView) => PickerBuilder;
  setOAuthToken: (token: string) => PickerBuilder;
  setDeveloperKey: (key: string) => PickerBuilder;
  setAppId: (appId: string) => PickerBuilder;
  enableFeature: (feature: string) => PickerBuilder;
  setCallback: (cb: (response: PickerResponse) => void) => PickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
};
type GooglePickerNamespace = {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => PickerDocsView;
  ViewId: { DOCS: string };
  Action: { PICKED: string; CANCEL: string };
  Feature: { MULTISELECT_ENABLED: string; SUPPORT_DRIVES: string };
};

declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleAccountsOAuth2 }; picker?: GooglePickerNamespace };
    gapi?: { load: (api: string, callback: () => void) => void };
  }
}

let gsiReady: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gsiReady) {
    gsiReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://accounts.google.com/gsi/client";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("gsi-load-failed"));
      document.head.appendChild(script);
    });
  }
  return gsiReady;
}

let pickerReady: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  if (!pickerReady) {
    pickerReady = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://apis.google.com/js/api.js";
      script.async = true;
      script.onload = () => window.gapi!.load("picker", () => resolve());
      script.onerror = () => reject(new Error("gapi-load-failed"));
      document.head.appendChild(script);
    });
  }
  return pickerReady;
}

// Cached in memory only, for this tab: once granted, re-picking more files in
// the same visit does not re-prompt. A fresh page load always asks again.
let cachedToken: { token: string; expiresAt: number } | null = null;

// A linked account gets its token from the server, minted from the stored
// refresh token (SPEC.md §14) — no popup. null = not linked after all (grant
// revoked, sign-in off); the caller falls back to the per-visit grant.
async function requestLinkedToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/drive/token", { method: "POST" });
    if (!res.ok) return null;
    const data = (await res.json()) as { token?: string };
    if (!data.token) return null;
    cachedToken = { token: data.token, expiresAt: Date.now() + 55 * 60_000 };
    return data.token;
  } catch {
    return null;
  }
}

async function requestAccessToken(clientId: string, access: DriveAccess): Promise<string> {
  await loadGsi();
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;
  return new Promise((resolve, reject) => {
    const client = window.google!.accounts!.oauth2!.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPES[access],
      callback: (response) => {
        if (!response.access_token) {
          reject(new Error(response.error_description ?? response.error ?? "drive-auth-failed"));
          return;
        }
        // Google Drive tokens last an hour; refresh a little early.
        cachedToken = { token: response.access_token, expiresAt: Date.now() + 55 * 60_000 };
        resolve(response.access_token);
      },
      error_callback: (error) => reject(new Error(error.type)),
    });
    // "" = silent when the grant is already live, prompt only when needed.
    client.requestAccessToken({ prompt: "" });
  });
}

// The picker's tabs, the same five Google Drive itself shows in its sidebar:
// My Drive, Shared with me, Recent, Starred, Shared drives. Each is one
// DocsView; the picker names the tab from how the view is set. Folders show
// so the reader can walk into them, and stay unselectable — a folder is not
// a document to import. Recent lists files only: one DocsView with no parent
// and folders on lists every folder of the Drive flat, newest first, which
// read as a wall of stale folders with the reader's own Drive nowhere.
type DriveTab = "my-drive" | "shared-with-me" | "recent" | "starred" | "shared-drives";
const DRIVE_TABS: DriveTab[] = ["my-drive", "shared-with-me", "recent", "starred", "shared-drives"];

function docsView(picker: GooglePickerNamespace, tab: DriveTab, mimeTypes: string): PickerDocsView {
  const view = new picker.DocsView(picker.ViewId.DOCS).setSelectFolderEnabled(false);
  switch (tab) {
    case "my-drive":
      // "root" is Drive's alias for the account's My Drive folder.
      return view.setIncludeFolders(true).setParent("root").setMimeTypes(mimeTypes);
    case "shared-with-me":
      return view.setIncludeFolders(true).setOwnedByMe(false).setMimeTypes(mimeTypes);
    case "recent":
      // The mime filter is a whitelist over every item the view lists, so
      // the folder type leaves it here — with it, folders would list too.
      return view.setIncludeFolders(false).setMimeTypes(withoutFolders(mimeTypes));
    case "starred":
      return view.setIncludeFolders(true).setStarred(true).setMimeTypes(mimeTypes);
    case "shared-drives":
      return view.setIncludeFolders(true).setEnableDrives(true).setMimeTypes(mimeTypes);
  }
}

function withoutFolders(mimeTypes: string): string {
  return mimeTypes
    .split(",")
    .filter((type) => type !== DRIVE_FOLDER_MIME_TYPE)
    .join(",");
}

// Get a Drive token, open the picker, resolve with whatever the reader picked
// (empty = closed the picker without picking — not an error) plus the token
// to import with. A linked account's token comes from the server; otherwise
// the per-visit grant runs, asking the configured access, which must start
// from a click handler: the token request opens a popup, which browsers block
// outside a user gesture.
export async function pickDriveFiles(opts: {
  clientId: string;
  apiKey: string | null;
  linked: boolean;
  access: DriveAccess;
  // The picker's mime filter; the document filter by default. The assistant
  // passes its own (DRIVE_ASSISTANT_MIME_TYPES).
  mimeTypes?: string;
}): Promise<{ token: string; files: DrivePickedFile[] }> {
  const [token] = await Promise.all([
    (async () =>
      (opts.linked ? await requestLinkedToken() : null) ??
      (await requestAccessToken(opts.clientId, opts.access)))(),
    loadPicker(),
  ]);
  const picker = window.google!.picker!;
  const files = await new Promise<DrivePickedFile[]>((resolve) => {
    // One tab per Drive view, My Drive first, so the picker opens on the
    // reader's own Drive at its root. One view cannot be every tab: with
    // setEnableDrives(true) Google puts only shared drives in the view, and
    // with no parent it lists the whole Drive flat.
    const mimeTypes = opts.mimeTypes ?? DRIVE_PICKER_MIME_TYPES;
    const builder = new picker.PickerBuilder();
    for (const tab of DRIVE_TABS) builder.addView(docsView(picker, tab, mimeTypes));
    builder
      .setOAuthToken(token)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .enableFeature(picker.Feature.SUPPORT_DRIVES);
    if (opts.apiKey) builder.setDeveloperKey(opts.apiKey);
    // The Cloud project number: with it, a pick extends a picked-files grant
    // (drive.file) to the picked file. Without it Drive answers 404 for
    // every picked file — the import then fails as "did not load".
    const appId = driveAppId(opts.clientId);
    if (appId) builder.setAppId(appId);
    builder
      .setCallback((response) => {
        if (response.action === picker.Action.PICKED) {
          resolve(
            (response.docs ?? [])
              // Folders are in the view to walk into, never to import.
              .filter((d) => d.mimeType !== DRIVE_FOLDER_MIME_TYPE)
              .map((d) => ({
                id: d.id,
                name: d.name,
                mimeType: d.mimeType,
                sizeBytes: d.sizeBytes != null ? Number(d.sizeBytes) : null,
              })),
          );
        } else if (response.action === picker.Action.CANCEL) {
          resolve([]);
        }
      })
      .build()
      .setVisible(true);
  });
  return { token, files };
}
