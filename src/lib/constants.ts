// The local reader when sign-in is off (SPEC.md §2). Owner columns keep this
// id; the first account to sign in adopts its data.
export const USER_ID = "user-1";

// Cookie names live here so the edge middleware can import them without
// pulling node:crypto from lib/auth.
export const SESSION_COOKIE = "dissect-session";
export const STATE_COOKIE = "dissect-oauth-state";
// Apple posts the callback cross-site (response_mode form_post), so its state
// cookie needs SameSite=None and its own name.
export const APPLE_STATE_COOKIE = "dissect-apple-state";
// The Link Google Drive code flow (SPEC.md §14): its own state cookie so a
// concurrent sign-in cannot clobber it, plus the path to return to after the
// callback.
export const DRIVE_STATE_COOKIE = "dissect-drive-state";
export const DRIVE_RETURN_COOKIE = "dissect-drive-return";
// The signed-in account's id, readable by the client (not httpOnly; grants
// nothing — every request is authorized by the session cookie alone). Tabs
// compare it against the account they were rendered for, so signing out or
// switching accounts in one tab freezes the others with a notice instead of
// silently becoming the new account.
export const ACCOUNT_COOKIE = "dissect-account";
// A tab's rendered account rides on its API writes; the middleware rejects the
// write when the cookie says the browser has since switched accounts.
export const ACCOUNT_HEADER = "x-dissect-account";
