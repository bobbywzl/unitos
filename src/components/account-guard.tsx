"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { Logo } from "@/components/logo";
import { latchTabAccount, readAccountCookie, tabAccount } from "@/lib/tab-account";

type Notice =
  | { kind: "switched"; name: string } // the browser signed into another account
  | { kind: "signedOut" };

// Cookies are per browser, not per tab: signing out or switching accounts in
// one tab changes every tab's cookies. Without this guard a stale tab silently
// becomes the new account on its next refresh. Account-scoped pages mount the
// guard; it latches the account the page was rendered for, watches the account
// cookie (on focus, on visibility, every 5 seconds), confirms a mismatch with
// the server, and freezes the tab with a notice instead of morphing.
export function AccountGuard({ userId, enabled }: { userId: string; enabled: boolean }) {
  const t = useT();
  const [notice, setNotice] = useState<Notice | null>(null);
  const checking = useRef(false);
  // Once frozen, stay frozen: the notice resolves only by the full page load
  // its button triggers.
  const frozen = useRef(false);

  useEffect(() => {
    if (!enabled || !userId) return;
    latchTabAccount(userId);

    async function check() {
      if (checking.current || frozen.current) return;
      const expected = tabAccount();
      if (!expected) return;
      // The cheap trigger: the readable cookie. Equal = nothing changed.
      if (readAccountCookie() === expected) return;
      // Confirm with the server before freezing the tab — a missing cookie can
      // be a session from before the cookie existed; the endpoint re-stamps it.
      checking.current = true;
      try {
        const res = await fetch("/api/auth/account");
        const data = (await res.json().catch(() => null)) as {
          id: string | null;
          name: string | null;
        } | null;
        if (!data) return; // network hiccup: the next trigger retries
        if (data.id === expected) return; // healed; still the same account
        frozen.current = true;
        setNotice(data.id ? { kind: "switched", name: data.name ?? "" } : { kind: "signedOut" });
      } catch {
        // Offline: the next trigger retries.
      } finally {
        checking.current = false;
      }
    }

    void check();
    const timer = setInterval(() => void check(), 5_000);
    const onFocus = () => void check();
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    const onPageShow = () => void check(); // back/forward cache restores
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [enabled, userId]);

  if (!notice) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-paper/95 p-6 backdrop-blur-sm">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-card p-8 text-center shadow-float">
        <Logo size={44} className="text-clay" />
        <h1 className="font-display text-[22px]">{t("common.accountChangedTitle")}</h1>
        <p className="text-sm text-sand-700">
          {notice.kind === "switched"
            ? t("common.accountSwitchedBody", { name: notice.name })
            : t("common.accountSignedOutBody")}
        </p>
        <a
          // A full load, so the whole tab restarts as the browser's account.
          href={notice.kind === "switched" ? "/" : "/signin"}
          className="rounded-full bg-clay px-6 py-2.5 text-sm font-semibold text-clay-fg hover:bg-clay-600"
        >
          {notice.kind === "switched" ? t("common.accountContinue") : t("common.accountSignIn")}
        </a>
      </div>
    </div>
  );
}
