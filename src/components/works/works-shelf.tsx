"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
import { BOTTOM_STATUS, ProgressBar } from "@/components/progress-bar";
import { WorkCard, type WorkItem } from "@/components/works/work-card";
import { useEscapeLayer } from "@/lib/escape-layers";

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
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);

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

  // Delete project opens an in-app confirm that names the documents only
  // this project holds: they stay in the library (lib/documents/orphans.ts).
  function remove(id: string) {
    const work = works.find((w) => w.id === id);
    if (work) setDeleting({ id, title: work.title });
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
      {/* Projects, and New project at the right of the heading: one row. */}
      <div className="mb-6 flex items-center justify-between gap-4 sm:mb-8">
        <h1 className="min-w-0 text-[34px] sm:text-[46px]">{t("works.corpora")}</h1>

        <button
          onClick={() => void create()}
          disabled={busy}
          data-track="new-project"
          data-nudge="project"
          className="flex shrink-0 items-center gap-2 rounded-full bg-clay px-5 py-2.5 text-[14px] font-semibold text-clay-fg shadow-soft hover:bg-clay-600 disabled:opacity-40 sm:gap-2.5 sm:px-7 sm:py-3.5 sm:text-[15px]"
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
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
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
          <ul className="grid grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">
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

      {deleting && (
        <DeleteProjectConfirm
          project={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div className={`${BOTTOM_STATUS} z-50 flex w-max max-w-[calc(100vw-32px)] justify-center`}>
          <span
            role="status"
            className="flex items-center gap-2 rounded-full bg-ink/90 px-3 py-1.5 text-xs text-paper"
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

/** The confirm Delete project opens over the dashboard: what goes (the
    project, its sections, its notes), and by name the documents only this
    project holds, which stay in the library. Delete project and Cancel. */
function DeleteProjectConfirm({
  project,
  onClose,
  onDeleted,
}: {
  project: { id: string; title: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const t = useT();
  const [onlyHere, setOnlyHere] = useState<{ id: string; title: string }[] | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEscapeLayer(true, onClose);

  useEffect(() => {
    cancelRef.current?.focus();
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/notebooks/${project.id}`);
        const body = (await res.json()) as { onlyHere?: { id: string; title: string }[]; error?: string };
        if (cancelled) return;
        if (!res.ok || !body.onlyHere) setError(body.error ?? t("common.requestFailed"));
        else setOnlyHere(body.onlyHere);
      } catch {
        if (!cancelled) setError(t("common.requestFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [project.id, t]);

  async function confirmDelete() {
    if (working) return;
    setWorking(true);
    setError(null);
    try {
      await api(`/api/notebooks/${project.id}`, "DELETE");
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
      setWorking(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 px-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("works.deleteProject")}
        className="pop-in flex max-h-[calc(100dvh-4rem)] w-full max-w-md flex-col gap-3 overflow-y-auto rounded-[28px] bg-card p-6 shadow-float"
      >
        <p className="text-[17px] font-semibold text-sand-800">{t("works.deleteProjectTitle", { title: project.title })}</p>
        <p className="text-sm text-sand-700">{t("works.deleteProjectNotes")}</p>
        {onlyHere === null && !error && <p className="text-sm text-sand-500">{t("common.loading")}</p>}
        {onlyHere !== null &&
          (onlyHere.length > 0 ? (
            <>
              <p className="text-sm text-sand-700">{t("works.deleteProjectKeeps")}</p>
              <ul className="flex flex-col gap-1 rounded-2xl bg-sand-100 px-4 py-3 text-sm text-sand-800">
                {onlyHere.map((d) => (
                  <li key={d.id} className="truncate">
                    {d.title}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-sand-700">{t("works.deleteProjectKeepsNone")}</p>
          ))}
        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm text-sand-700 hover:bg-clay-100 hover:text-clay-800"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={() => void confirmDelete()}
            disabled={working || onlyHere === null}
            data-track="project-delete-confirm"
            className="rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {working ? t("common.working") : t("works.deleteProject")}
          </button>
        </div>
      </div>
    </div>
  );
}
