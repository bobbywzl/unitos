"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import { Logo } from "@/components/logo";

// The welcome flow for a new account: a screen fades in over the dashboard —
// the line and the mark covering the background — then fades out into it.
// After it, the first-steps card explains the functions: start a new project,
// add documents, the AI tools, and the ? at the top right of a project.
// localStorage keeps both to one showing; firstWork gates them to accounts
// with no project yet.

const WELCOMED_KEY = "unitos-welcomed";
const STEPS_KEY = "unitos-first-steps-done";

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return true; // storage unavailable: never loop the welcome
  }
}

function mark(key: string) {
  try {
    localStorage.setItem(key, "1");
  } catch {
    // storage unavailable: showing twice is the worst case
  }
}

export function WelcomeFlow({ firstWork }: { firstWork: boolean }) {
  const t = useT();
  const [splash, setSplash] = useState(false);
  const [steps, setSteps] = useState(false);

  // Revealed after the dashboard paints (one frame later — also what the
  // fade-in wants), so hydration renders nothing and matches the server.
  useEffect(() => {
    if (!firstWork) return;
    const id = requestAnimationFrame(() => {
      if (!read(WELCOMED_KEY)) {
        mark(WELCOMED_KEY);
        setSplash(true);
        return;
      }
      if (!read(STEPS_KEY)) setSteps(true);
    });
    return () => cancelAnimationFrame(id);
  }, [firstWork]);

  function endSplash() {
    setSplash(false);
    if (!read(STEPS_KEY)) setSteps(true);
  }

  function dismissSteps() {
    mark(STEPS_KEY);
    setSteps(false);
  }

  return (
    <>
      {splash && (
        <div
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) endSplash();
          }}
          className="welcome-fade fixed inset-0 z-[70] flex items-center justify-center bg-paper"
        >
          <div aria-hidden className="pointer-events-none absolute inset-0 text-clay opacity-[0.06]">
            <Logo size="100%" fit="cover" />
          </div>
          <h1 className="welcome-rise relative max-w-3xl px-8 text-center font-display text-[34px] leading-tight text-balance sm:text-[46px]">
            {t("works.welcomeTitle")}
          </h1>
        </div>
      )}

      {steps && !splash && (
        <div className="relative mb-10 overflow-hidden rounded-[24px] bg-card p-6 shadow-soft">
          <div aria-hidden className="pointer-events-none absolute inset-0 text-clay opacity-[0.05]">
            <Logo size="100%" fit="cover" />
          </div>
          <div className="relative flex flex-col gap-3">
            <span className="font-display text-[20px]">{t("works.firstStepsTitle")}</span>
            <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-relaxed text-sand-800">
              <li>{t("works.firstStepsProject")}</li>
              <li>{t("works.firstStepsAdd")}</li>
              <li>{t("works.firstStepsTools")}</li>
              <li>{t("works.firstStepsGuide")}</li>
            </ol>
            <button
              onClick={dismissSteps}
              className="self-start rounded-full bg-clay px-5 py-2 text-xs font-semibold text-clay-fg hover:bg-clay-600"
            >
              {t("works.firstStepsDone")}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
