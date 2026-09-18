"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import {
  listSaved,
  offlineSupported,
  refreshSaved,
  removeSaved,
  saveProject,
  subscribeSaved,
  type SaveProgress,
} from "@/lib/offline/saved";
import { useT } from "@/components/lang-provider";
import { ProgressBar } from "@/components/progress-bar";
import { WorkCard, type WorkItem } from "@/components/works/work-card";

export type { WorkItem };

// The works shelf: the front door (design 2a). Shared with you renders as its
// own shelf under the reader's corpora.
export function WorksShelf({
  works,
  sharedWorks,
  myEmail,
  ultra,
  billing,
}: {
  works: WorkItem[];
  sharedWorks: WorkItem[];
  myEmail: string;
  // Unitos Ultra (TIERS.md): Save for offline. Offered to every account; a
  // non-Ultra press answers with the plain Ultra message, and the route
  // answers 403.
  ultra: boolean;
  // Billing on (SPEC.md §24): the Ultra message offers the plan page.
  billing: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [busy, setBusy] = useState(false);

  // Offline copies (SPEC.md §17): which projects this browser holds, which one
  // is saving now, and the one-line toast a press answers with.
  const [supported, setSupported] = useState(false);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null);
  const [toast, setToast] = useState<{ text: string; plans: boolean } | null>(null);

  useEffect(() => {
    if (!offlineSupported()) return;
    const update = () =>
      void listSaved().then((rows) => {
        setSaved(new Set(rows.map((r) => r.id)));
        setSupported(true);
      });
    update();
    // Copies older than an hour refresh in the background while online.
    void refreshSaved();
    return subscribeSaved(update);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function toggleOffline(id: string) {
    if (savingId) return;
    if (saved.has(id)) {
      await removeSaved(id);
      return;
    }
    if (!ultra) {
      setToast({ text: t("works.offlineNeedsUltra"), plans: billing });
      return;
    }
    setSavingId(id);
    setSaveProgress({ stage: "pages", done: 0, total: 0 });
    try {
      await saveProject(id, setSaveProgress);
      setToast({ text: t("works.offlineSaved"), plans: false });
    } catch (err) {
      const status = (err as { status?: number }).status;
      setToast({
        text: status === 403 ? t("works.offlineNeedsUltra") : t("works.offlineSaveFailed"),
        plans: status === 403 && billing,
      });
    } finally {
      setSavingId(null);
      setSaveProgress(null);
    }
  }
  const savingTitle = [...works, ...sharedWorks].find((w) => w.id === savingId)?.title ?? "";

  const offlineOf = (id: string) =>
    supported
      ? { saved: saved.has(id), saving: savingId === id, ultra, onToggle: (i: string) => void toggleOffline(i) }
      : undefined;

  // New project: one press. The project gets the default title (renamed in
  // the reader's title) and opens on the add-document dialog (?add=1), so the
  // first thing a new project asks for is a document.
  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const work = await api<{ id: string }>("/api/notebooks", "POST", {
        title: t("works.untitledProject"),
      });
      router.push(`/n/${work.id}?add=1`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm(t("works.deleteCorpusConfirm"))) return;
    await api(`/api/notebooks/${id}`, "DELETE");
    router.refresh();
  }

  async function rename(id: string, current: string) {
    const next = prompt(t("works.corpusTitle"), current)?.trim();
    if (!next || next === current) return;
    await api(`/api/notebooks/${id}`, "PATCH", { title: next });
    router.refresh();
  }

  async function leave(id: string) {
    if (!confirm(t("panes.leaveConfirm"))) return;
    await api(`/api/notebooks/${id}/collaborators`, "DELETE", { email: myEmail });
    router.refresh();
  }

  return (
    <>
      <h1 className="mb-7 text-[34px] sm:text-[46px]">{t("works.corpora")}</h1>

      <button
        onClick={() => void create()}
        disabled={busy}
        data-track="new-project"
        data-nudge="project"
        className="mb-11 flex items-center gap-2.5 rounded-full bg-clay px-7 py-3.5 text-[15px] font-semibold text-clay-fg shadow-soft hover:bg-clay-600 disabled:opacity-40"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </svg>
        {busy ? t("common.working") : t("works.newWork")}
      </button>

      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {works.map((work) => (
          <WorkCard
            key={work.id}
            work={work}
            onRename={rename}
            onDelete={remove}
            offline={offlineOf(work.id)}
          />
        ))}
      </ul>

      {sharedWorks.length > 0 && (
        <>
          <h2 className="mt-16 mb-7 text-[28px]">{t("works.sharedWithYou")}</h2>
          <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {sharedWorks.map((work) => (
              <WorkCard
                key={work.id}
                work={work}
                onRename={rename}
                onDelete={remove}
                onLeave={leave}
                offline={offlineOf(work.id)}
              />
            ))}
          </ul>
        </>
      )}

      {savingId && saveProgress && (
        <ProgressBar
          label={t(saveProgress.stage === "pages" ? "works.savingOfflinePages" : "works.savingOfflineFiles")}
          title={savingTitle}
          done={saveProgress.done}
          total={saveProgress.total}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-6">
          <span
            role="status"
            className="pointer-events-auto flex items-center gap-2 rounded-full bg-ink/90 px-3 py-1.5 text-xs text-paper"
          >
            {toast.text}
            {toast.plans && (
              <button
                onClick={() => window.open("/billing", "_blank", "noopener")}
                className="rounded-full bg-paper/20 px-2.5 py-0.5 font-semibold hover:bg-paper/30"
              >
                {t("billing.plans")}
              </button>
            )}
          </span>
        </div>
      )}
    </>
  );
}
