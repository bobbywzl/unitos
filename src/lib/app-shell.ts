// The app (SPEC.md §33): Unitos from the App Store, on iPhone, iPad, and Mac.
// The app is a window onto this site: a web view that loads the same pages.
// It says what it is in the user agent, which the web view cannot say itself
// (an iPad's web view reads as a Mac): `UnitosApp/<version> (<device>)`,
// added by apps/apple/Unitos/WebScreen.swift. The site reads the token here,
// on the server (a request's header) and in the browser.

export type AppDevice = "mac" | "ipad" | "iphone";

export type AppShell = { version: string; device: AppDevice };

const TOKEN = /\bUnitosApp\/(\d+(?:\.\d+){0,3}) \((mac|ipad|iphone)\)/;

/** The app a user agent names; null in a browser. */
export function appShellOf(userAgent: string | null | undefined): AppShell | null {
  const match = userAgent ? TOKEN.exec(userAgent) : null;
  if (!match) return null;
  return { version: match[1], device: match[2] as AppDevice };
}

/** The app this page runs in; null in a browser and on the server. */
export function clientAppShell(): AppShell | null {
  if (typeof navigator === "undefined") return null;
  return appShellOf(navigator.userAgent);
}

/** The scheme the app's sign-in sheet listens on: the server ends a sign-in
    the app started at `unitos://signed-in?token=…` (lib/app-handoff.ts). */
export const APP_SCHEME = "unitos";

/** The page the iPhone app opens on (SPEC.md §33). */
export const PHONE_PATH = "/phone";

// What the app tells the page, as window events the web view dispatches:
// the Apple Pencil's double tap and squeeze switch the pen and the eraser.
export const PENCIL_TAP_EVENT = "unitos:pencil-tap";
