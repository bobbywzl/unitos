"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NotesIcon, SparkleIcon } from "@/components/icons";
import { useT } from "@/components/lang-provider";
import { Logo } from "@/components/logo";
import { PhoneAssistant } from "@/components/phone/phone-assistant";
import { PhoneNotes } from "@/components/phone/phone-notes";
import { api } from "@/lib/api";
import { QUEUE_SYNCED_EVENT, rememberPremium } from "@/lib/offline/queue";

// The phone page (SPEC.md §33): the iPhone app's screen. A header with the
// project, one of two tabs — Notes, Assistant — and the tab bar. No side
// bar, no rail, no reader.

export type PhoneProject = { id: string; title: string; canEdit: boolean };
export type PhoneNote = { id: string; content: string; pending: boolean };
export type PhoneSection = { id: string; title: string; notes: PhoneNote[] };

type Tab = "notes" | "assistant";

export function PhoneApp({
  projects,
  project,
  sections,
  premium,
  signedIn,
}: {
  projects: PhoneProject[];
  /** The open project; null = the account has none yet. */
  project: PhoneProject | null;
  sections: PhoneSection[];
  premium: boolean;
  signedIn: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("notes");

  // Notes written with no network wait in the offline queue (SPEC.md §17),
  // which reads the account's tier from here.
  useEffect(() => rememberPremium(premium), [premium]);

  // The notes are read again when the queue has sent what waited, and when
  // the app comes back to the front: a note added on another device shows.
  useEffect(() => {
    const refresh = () => router.refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(QUEUE_SYNCED_EVENT, refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(QUEUE_SYNCED_EVENT, refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  // The page is as tall as what the keyboard leaves, so the box being typed
  // in and its button stay in view above the keyboard.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const fit = () => {
      document.documentElement.style.setProperty("--phone-height", `${viewport.height}px`);
      window.scrollTo(0, 0);
    };
    fit();
    viewport.addEventListener("resize", fit);
    return () => {
      viewport.removeEventListener("resize", fit);
      document.documentElement.style.removeProperty("--phone-height");
    };
  }, []);

  const tabButton = (id: Tab, label: string, icon: React.ReactNode) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      data-track={`phone-tab:${id}`}
      onClick={() => setTab(id)}
      className={`flex h-[54px] flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
        tab === id ? "text-clay-800" : "text-sand-600"
      }`}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <main
      data-phone-page
      className="mx-auto flex w-full max-w-[640px] flex-col overflow-hidden bg-paper"
      style={{ height: "var(--phone-height, 100dvh)" }}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 pt-[calc(10px+env(safe-area-inset-top))] pb-2.5">
        <Logo size={28} className="shrink-0 text-clay" />
        {project ? (
          <select
            aria-label={t("phone.project")}
            value={project.id}
            onChange={(e) => router.push(`/phone?p=${encodeURIComponent(e.target.value)}`)}
            className="min-w-0 flex-1 truncate rounded-full bg-card px-3.5 py-2 text-[15px] font-semibold shadow-soft"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        ) : (
          <span className="flex-1 font-display text-[19px]">{t("phone.title")}</span>
        )}
        {signedIn && (
          <Link
            href="/settings"
            className="shrink-0 rounded-full px-3 py-2 text-[13px] font-semibold text-sand-700"
          >
            {t("phone.settings")}
          </Link>
        )}
      </header>

      {project ? (
        <>
          {/* Both tabs stay mounted: a note half written and a conversation
              are still there after a look at the other tab. */}
          <div className={tab === "notes" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <PhoneNotes project={project} sections={sections} />
          </div>
          <div className={tab === "assistant" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
            <PhoneAssistant project={project} />
          </div>
          <nav
            role="tablist"
            className="flex shrink-0 border-t border-line bg-card pb-[env(safe-area-inset-bottom)]"
          >
            {tabButton("notes", t("phone.tabNotes"), <NotesIcon size={19} />)}
            {tabButton("assistant", t("phone.tabAssistant"), <SparkleIcon size={19} />)}
          </nav>
        </>
      ) : (
        <FirstProject />
      )}
    </main>
  );
}

/** An account with no project yet names its first one here. */
function FirstProject() {
  const t = useT();
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      const made = await api<{ id: string }>("/api/notebooks", "POST", { title: name });
      router.push(`/phone?p=${encodeURIComponent(made.id)}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={create} className="flex flex-1 flex-col justify-center gap-3 px-6 pb-[env(safe-area-inset-bottom)]">
      <h1 className="font-display text-[24px] leading-tight">{t("phone.firstProjectTitle")}</h1>
      <p className="text-[15px] text-sand-700">{t("phone.firstProjectHint")}</p>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t("phone.firstProjectPlaceholder")}
        maxLength={200}
        className="rounded-2xl bg-card px-4 py-3 text-[16px] shadow-soft"
      />
      {error && (
        <p role="alert" className="text-[13px] font-medium text-red-600">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={!title.trim() || busy}
        className="rounded-full bg-clay px-5 py-3 text-[15px] font-semibold text-white disabled:opacity-50"
      >
        {t("phone.createProject")}
      </button>
    </form>
  );
}
