"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { isImeKey } from "@/lib/ime";
import type { NotebookRole, Person } from "@/lib/person";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import type { SyncPresence } from "@/components/collab/use-sync";
import { useT } from "@/components/lang-provider";

type CollaboratorRow = {
  email: string;
  role: "editor" | "viewer";
  person: Person | null;
};

type ShareList = {
  owner: (Person & { email: string }) | null;
  collaborators: CollaboratorRow[];
  myRole: NotebookRole | null;
};

// The workspace header's collaboration corner: who else is here now, and the
// Share dialog (Google Docs pattern) — the owner adds collaborators by email
// with a role; a collaborator can leave.
export function ShareControl({
  notebookId,
  presence,
}: {
  notebookId: string;
  presence: SyncPresence[];
}) {
  const router = useRouter();
  const t = useT();
  const { authOn, role, shared, myId } = useCollab();
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<ShareList | null>(null);
  const [email, setEmail] = useState("");
  const [newRole, setNewRole] = useState<"editor" | "viewer">("editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKey(e)) setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!authOn) return null;

  async function toggle() {
    if (!open) {
      setError(null);
      setOpen(true);
      try {
        const res = await fetch(`/api/notebooks/${notebookId}/collaborators`);
        if (res.ok) setList((await res.json()) as ShareList);
      } catch {
        // The dialog shows a loading row until a retry succeeds.
      }
    } else {
      setOpen(false);
    }
  }

  async function run(fn: () => Promise<ShareList>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setList(await fn());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    } finally {
      setBusy(false);
    }
  }

  const add = () =>
    run(async () => {
      const next = await api<ShareList>(`/api/notebooks/${notebookId}/collaborators`, "POST", {
        email: email.trim(),
        role: newRole,
      });
      setEmail("");
      return next;
    });

  const setRole = (target: string, targetRole: "editor" | "viewer") =>
    run(() =>
      api<ShareList>(`/api/notebooks/${notebookId}/collaborators`, "POST", {
        email: target,
        role: targetRole,
      }),
    );

  const remove = (target: string) =>
    run(() => api<ShareList>(`/api/notebooks/${notebookId}/collaborators`, "DELETE", { email: target }));

  async function leave() {
    if (!confirm(t("panes.leaveConfirm"))) return;
    const mine = list?.collaborators.find((c) => c.person?.id === myId);
    if (!mine) return;
    setBusy(true);
    try {
      await api(`/api/notebooks/${notebookId}/collaborators`, "DELETE", { email: mine.email });
      router.push("/");
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
    }
  }

  const roleLabel = (r: "editor" | "viewer") =>
    r === "editor" ? t("panes.roleEditor") : t("panes.roleViewer");

  return (
    <div ref={panelRef} className="relative flex shrink-0 items-center gap-2">
      {presence.length > 0 && (
        <span aria-label={t("panes.alsoHere")} className="flex items-center -space-x-1.5">
          {presence.slice(0, 5).map((p) => (
            <span key={p.id} className="rounded-full ring-2 ring-paper">
              <PersonBadge person={p} size={24} />
            </span>
          ))}
        </span>
      )}
      <button
        onClick={() => void toggle()}
        aria-expanded={open}
        data-tooltip={t("panes.shareTitle")}
        className={`rounded-full px-3.5 py-1.5 text-[13px] hover:bg-clay-100 hover:text-clay-800 ${
          shared ? "border border-line text-sand-700" : "border border-dashed border-sand-400 text-sand-600"
        }`}
      >
        {t("panes.share")}
      </button>
      {role === "viewer" && (
        <span className="rounded-full bg-sand-200 px-3 py-1 text-[11px] font-semibold text-sand-600">
          {t("panes.viewingOnly")}
        </span>
      )}

      {open && (
        <div className="absolute top-full right-0 z-30 mt-2 w-[380px] rounded-2xl bg-card p-4 shadow-float">
          <p className="text-xs text-sand-600">{t("panes.shareDesc")}</p>

          {role === "owner" && (
            <form
              className="mt-3 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("panes.shareEmailPh")}
                type="email"
                className="min-w-0 flex-1 rounded-full bg-sand-100 px-3.5 py-1.5 text-[13px] outline-none placeholder:text-sand-500"
              />
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as "editor" | "viewer")}
                aria-label={t("panes.role")}
                className="rounded-full bg-sand-100 px-2 py-1.5 text-[13px] outline-none"
              >
                <option value="editor">{t("panes.roleEditor")}</option>
                <option value="viewer">{t("panes.roleViewer")}</option>
              </select>
              <button
                type="submit"
                disabled={!email.trim() || busy}
                className="rounded-full bg-clay px-3.5 py-1.5 text-[13px] font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {t("common.add")}
              </button>
            </form>
          )}
          {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

          <div className="mt-3 flex flex-col gap-2">
            {!list ? (
              <p className="text-xs text-sand-500">{t("common.loading")}</p>
            ) : (
              <>
                {list.owner && (
                  <div className="flex items-center gap-2.5">
                    <PersonBadge person={list.owner} size={26} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">{list.owner.name}</div>
                      <div className="truncate text-[11px] text-sand-500">{list.owner.email}</div>
                    </div>
                    <span className="text-[11px] text-sand-500">{t("panes.roleOwner")}</span>
                  </div>
                )}
                {list.collaborators.map((c) => (
                  <div key={c.email} className="flex items-center gap-2.5">
                    {c.person ? (
                      <PersonBadge person={c.person} size={26} />
                    ) : (
                      <span className="flex size-[26px] shrink-0 items-center justify-center rounded-full border border-dashed border-sand-400 text-[11px] text-sand-500">
                        ?
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">
                        {c.person?.name ?? c.email}
                      </div>
                      <div className="truncate text-[11px] text-sand-500">
                        {c.person ? c.email : t("panes.invitedHint")}
                      </div>
                    </div>
                    {role === "owner" ? (
                      <>
                        <select
                          value={c.role}
                          onChange={(e) => void setRole(c.email, e.target.value as "editor" | "viewer")}
                          disabled={busy}
                          aria-label={t("panes.role")}
                          className="rounded-full bg-sand-100 px-2 py-1 text-[12px] outline-none"
                        >
                          <option value="editor">{t("panes.roleEditor")}</option>
                          <option value="viewer">{t("panes.roleViewer")}</option>
                        </select>
                        <button
                          onClick={() => void remove(c.email)}
                          disabled={busy}
                          aria-label={t("common.remove")}
                          data-tooltip={t("common.remove")}
                          className="text-sand-500 hover:text-red-600"
                        >
                          ×
                        </button>
                      </>
                    ) : (
                      <span className="text-[11px] text-sand-500">{roleLabel(c.role)}</span>
                    )}
                  </div>
                ))}
                {role !== "owner" && (
                  <button
                    onClick={() => void leave()}
                    disabled={busy}
                    className="self-start text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    {t("panes.leave")}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
