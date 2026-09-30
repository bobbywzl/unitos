"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useState, type ReactNode } from "react";
import { PersonBadge } from "@/components/collab/person-badge";
import { useLang, useT } from "@/components/lang-provider";
import { insertContext } from "@/components/docs/insert/context";
import { ToolbarDialog } from "@/components/docs/toolbar/dialog";
import type { Person } from "@/lib/person";
import "./details.css";

// File > Details (SPEC.md §29), Google Docs' Document details: Location
// (the project, then the folders the document sits in), Owner (the
// project's), Modified (when the text was last saved), Modified by, and
// Created. Read from /api/documents/[documentId]/details.

const LABELS = {
  location: "docsPage.detailsLocation",
  owner: "docsPage.detailsOwner",
  modified: "docsPage.detailsModified",
  modifiedBy: "docsPage.detailsModifiedBy",
  created: "docsPage.detailsCreated",
} as const;

type Details = {
  title: string;
  project: string;
  folders: string[];
  owner: Person | null;
  ownerIsYou: boolean;
  createdAt: string;
  modifiedAt: string;
  modifiedBy: Person | null;
  modifiedByYou: boolean;
};

export function DetailsDialog({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const ctx = insertContext(editor);
  const documentId = ctx?.documentId ?? null;
  const notebookId = ctx?.notebookId ?? null;
  const [details, setDetails] = useState<Details | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!documentId || !notebookId) return;
    let live = true;
    fetch(`/api/documents/${documentId}/details?notebookId=${encodeURIComponent(notebookId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as Details;
      })
      .then((d) => {
        if (live) setDetails(d);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [documentId, notebookId]);

  const locale = lang === "zh" ? "zh-CN" : undefined;
  const when = (iso: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });
  const who = (person: Person | null, you: boolean): ReactNode =>
    you ? (
      t("docsPage.me")
    ) : person ? (
      <span className="docs-details-person">
        <PersonBadge person={person} />
        {person.name}
      </span>
    ) : null;

  const rows: [keyof typeof LABELS, ReactNode][] = [];
  if (details) {
    rows.push(["location", [details.project, ...details.folders].join(" › ")]);
    rows.push(["owner", who(details.owner, details.ownerIsYou) ?? "—"]);
    rows.push(["modified", when(details.modifiedAt)]);
    const by = who(details.modifiedBy, details.modifiedByYou);
    if (by) rows.push(["modifiedBy", by]);
    rows.push(["created", when(details.createdAt)]);
  }

  return (
    <ToolbarDialog
      title={t("docsPage.documentDetails")}
      onClose={onClose}
      className="docs-small-dialog docs-details-dialog"
      closeButton={false}
      actions={
        // OK takes the focus, as in Google Docs: Enter or Space closes.
        <button type="button" className="docs-tb-button docs-tb-button-primary" data-autofocus data-track="docs:details:ok" onClick={onClose}>
          {t("docs.ok")}
        </button>
      }
    >
      {details ? (
        <dl className="docs-details">
          {rows.map(([key, value]) => (
            <div key={key} className="docs-details-row" data-details-row={key}>
              <dt>{t(LABELS[key])}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="docs-setup-note" role="status">
          {t(failed ? "common.requestFailed" : "common.loading")}
        </p>
      )}
    </ToolbarDialog>
  );
}
