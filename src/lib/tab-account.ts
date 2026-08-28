import { ACCOUNT_COOKIE } from "@/lib/constants";

// The account this tab belongs to. Cookies are per browser, not per tab, so
// when another tab signs out or switches accounts, this tab's cookies change
// under it. The tab latches the account its page was rendered for (module
// state — it survives client navigation and resets only on a full page load,
// which is exactly the legitimate account-switch boundary). The account guard
// compares the latch against the readable account cookie; api() sends it as a
// header so the middleware can reject writes from a tab the browser has since
// switched out from under.

let latched: string | null = null;

export function latchTabAccount(id: string): void {
  if (!latched && id) latched = id;
}

export function tabAccount(): string | null {
  return latched;
}

export function readAccountCookie(): string | null {
  if (typeof document === "undefined") return null;
  const value = document.cookie.match(new RegExp(`(?:^|; )${ACCOUNT_COOKIE}=([^;]+)`))?.[1];
  return value ? decodeURIComponent(value) : null;
}
