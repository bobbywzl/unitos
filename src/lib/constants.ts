// The local reader when sign-in is off (SPEC.md §2). Owner columns keep this
// id; the first account to sign in adopts its data.
export const USER_ID = "user-1";

// Cookie names live here so the edge middleware can import them without
// pulling node:crypto from lib/auth.
export const SESSION_COOKIE = "dissect-session";
export const STATE_COOKIE = "dissect-oauth-state";
