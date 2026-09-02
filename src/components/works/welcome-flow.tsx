"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { Logo } from "@/components/logo";
import { startNudges } from "@/components/nudges";

// The welcome flow for a new account: a screen fades in over the dashboard —
// the mark dimmed across the whole background — with "Welcome <first name>"
// and the tagline, then fades out into the dashboard. It starts the nudges
// (components/nudges.tsx): small floating captions, one at a time, that
// point at the next thing to try. localStorage keeps the splash to one
// showing per account: the stored value is welcomeKey — the account's id and
// createdAt — so a second account on this browser is welcomed too, and so is
// an account an admin reset (the reset stamps createdAt anew). firstWork gates
// the splash to accounts with no project yet.

const WELCOMED_KEY = "unitos-welcomed";

function welcomed(key: string): boolean {
  try {
    return localStorage.getItem(WELCOMED_KEY) === key;
  } catch {
    return true; // storage unavailable: never loop the welcome
  }
}

export function WelcomeFlow({
  firstWork,
  firstName,
  welcomeKey,
}: {
  firstWork: boolean;
  firstName: string;
  welcomeKey: string;
}) {
  const t = useT();
  const [splash, setSplash] = useState(false);

  // Revealed after the dashboard paints (one frame later — also what the
  // fade-in wants), so hydration renders nothing and matches the server.
  useEffect(() => {
    if (!firstWork) return;
    const id = requestAnimationFrame(() => {
      if (welcomed(welcomeKey)) return;
      try {
        localStorage.setItem(WELCOMED_KEY, welcomeKey);
      } catch {
        // storage unavailable: showing twice is the worst case
      }
      startNudges();
      setSplash(true);
    });
    return () => cancelAnimationFrame(id);
  }, [firstWork, welcomeKey]);

  if (!splash) return null;
  return (
    <div
      onAnimationEnd={(e) => {
        if (e.target === e.currentTarget) setSplash(false);
      }}
      className="welcome-fade fixed inset-0 z-[70] flex flex-col items-center justify-center bg-paper"
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 text-clay opacity-[0.06]">
        <Logo size="100%" fit="cover" />
      </div>
      <h1 className="welcome-rise relative max-w-3xl px-8 text-center font-display text-[38px] leading-tight text-balance sm:text-[54px]">
        {t("works.welcomeName", { name: firstName })}
      </h1>
      <p className="welcome-rise-late relative mt-4 max-w-2xl px-8 text-center font-display text-[18px] text-sand-700 text-balance sm:text-[23px]">
        {t("works.welcomeTagline")}
      </p>
    </div>
  );
}
