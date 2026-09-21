"use client";

import { useSyncExternalStore } from "react";
import { useT } from "@/components/lang-provider";

// Web access (SPEC.md §7): the assistant can search the web. On by default,
// one choice for the whole app, remembered in this browser and shown on
// every assistant surface — the panel, the reader's selection box, the
// media pane's assistant. The choice is read as an external store, so the
// server's render (on) and the first client render agree.
const WEB_KEY = "unitos-assistant-web";
const WEB_EVENT = "unitos:assistant-web";

function readWeb(): boolean {
  try {
    return localStorage.getItem(WEB_KEY) !== "off";
  } catch {
    return true;
  }
}

function writeWeb(on: boolean) {
  try {
    if (on) localStorage.removeItem(WEB_KEY);
    else localStorage.setItem(WEB_KEY, "off");
  } catch {
    // A blocked store only loses the memory of the choice.
  }
  window.dispatchEvent(new Event(WEB_EVENT));
}

function subscribeWeb(onChange: () => void) {
  window.addEventListener(WEB_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(WEB_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** The Web toggle's state, live across every surface. */
export function useWeb(): boolean {
  return useSyncExternalStore(subscribeWeb, readWeb, () => true);
}

/** The Web toggle. `small` is the reader's size, beside the thinking chips. */
export function WebChip({ small = false, className = "" }: { small?: boolean; className?: string }) {
  const t = useT();
  const web = useWeb();
  return (
    <button
      onClick={() => writeWeb(!web)}
      data-track={`assistant-web:${web ? "off" : "on"}`}
      aria-pressed={web}
      data-tip={t(web ? "assistant.webOnTitle" : "assistant.webOffTitle")}
      className={`rounded-full font-semibold ${small ? "px-2 py-0.5 text-[10.5px]" : "px-3 py-1 text-xs"} ${
        web ? "bg-sage-600 text-sage-fg" : "bg-card text-sand-600 shadow-soft hover:text-clay-800"
      } ${className}`}
    >
      {t("assistant.web")}
    </button>
  );
}
