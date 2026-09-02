import type { DigestRow } from "@/lib/digest/ensure";
import type { DigestDocument, DigestNote } from "@/lib/digest/types";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { serverT } from "@/lib/i18n/server";
import { DigestRebuild } from "@/components/admin/digest-rebuild";

// The digest store, per user: every corpus → every document → its annotations,
// distillations, extractions, summaries — plus the corpus's notes. Document
// text stays out of the page; the "Exact text" link serves it as the assistant
// reads it. Server-rendered; <details> does the folding. Each account is one
// scroller: its header stays pinned while its corpora scroll under it, and the
// page scrolls from account to account.

function fmtChars(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);
}

function fmtTime(d: Date): string {
  return `${d.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

function clamp(s: string, max = 600): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

function timeRange(start: number | null, end: number | null): string | null {
  if (start == null) return null;
  return end != null ? `${start.toFixed(1)}s–${end.toFixed(1)}s` : `${start.toFixed(1)}s`;
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-sand-100 px-2 py-0.5 text-[11px] text-sand-700">{children}</span>
  );
}

function NoteCard({ note, t }: { note: DigestNote; t: TFunc }) {
  return (
    <div className="rounded-xl bg-paper p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Chip>{note.kind}</Chip>
        {note.color && <Chip>{note.color}</Chip>}
        {!note.hidden && <Chip>{t("admin.noteSection", { section: note.section })}</Chip>}
        {note.status === "PENDING" && <Chip>{t("common.pending")}</Chip>}
        <span className="font-mono text-[10px] text-sand-500">
          {t("admin.noteId", { id: note.id })}
        </span>
      </div>
      {note.content && <p className="whitespace-pre-wrap text-sand-800">{clamp(note.content)}</p>}
      {note.sources.length > 0 && (
        <p className="mt-1 text-xs text-sand-600">
          {note.sources
            .map((s) => {
              const time = timeRange(s.startTime, s.endTime);
              const place = time ?? `"${clamp(s.quote, 120)}"`;
              return `${place} (${s.documentTitle})${s.orphaned ? ` ${t("admin.orphaned")}` : ""}`;
            })
            .join("; ")}
        </p>
      )}
    </div>
  );
}

function LayerList({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-xs font-semibold text-sand-700 hover:text-clay-800">
        {title} ({count})
      </summary>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

function DocumentCard({ doc, t }: { doc: DigestDocument; t: TFunc }) {
  const meta = doc.video
    ? doc.video.kind === "YOUTUBE"
      ? t("admin.videoMetaYoutube", {
          id: doc.video.youtubeId ?? "",
          status: doc.video.transcriptStatus.toLowerCase(),
        })
      : t("admin.videoMetaUpload", { status: doc.video.transcriptStatus.toLowerCase() })
    : (doc.sourceUrl ?? "PDF");
  return (
    <details className="rounded-xl bg-card p-3 shadow-soft">
      <summary className="cursor-pointer">
        <span className="text-sm font-semibold text-sand-800">{doc.title}</span>
        <span className="ml-2 text-xs text-sand-500">{meta}</span>
        <span className="mt-1 flex flex-wrap gap-1.5">
          <Chip>{t("admin.countChars", { n: fmtChars(doc.chars) })}</Chip>
          <Chip>{t("admin.countAnnotations", { n: doc.annotations.length })}</Chip>
          <Chip>{t("admin.countDistillations", { n: doc.distillations.length })}</Chip>
          <Chip>{t("admin.countExtractions", { n: doc.extractions.length })}</Chip>
          <Chip>{t("admin.countSummaries", { n: doc.summaries.length })}</Chip>
          {doc.salience.length > 0 && (
            <Chip>{t("admin.countSalient", { n: doc.salience.length })}</Chip>
          )}
          {doc.links.length > 0 && <Chip>{t("admin.countLinks", { n: doc.links.length })}</Chip>}
          {doc.edits.length > 0 && <Chip>{t("admin.countEdits", { n: doc.edits.length })}</Chip>}
        </span>
      </summary>
      <p className="mt-2 font-mono text-[10px] text-sand-500">
        {t("admin.documentId", { id: doc.id })}
      </p>
      <LayerList title={t("admin.layerAnnotations")} count={doc.annotations.length}>
        {doc.annotations.map((a) => (
          <NoteCard key={a.id} note={a} t={t} />
        ))}
      </LayerList>
      <LayerList title={t("admin.layerDistillations")} count={doc.distillations.length}>
        {doc.distillations.map((di) => (
          <div key={di.id} className="rounded-xl bg-paper p-3 text-sm">
            <p className="font-semibold text-sand-800">
              {t("admin.distillQuestion", { question: di.question })}
            </p>
            <ul className="mt-1 space-y-1">
              {di.quotes.map((q, i) => (
                <li key={i} className="text-xs text-sand-700">
                  &ldquo;{clamp(q.quote, 240)}&rdquo;
                  {q.orphaned ? ` ${t("admin.orphaned")}` : ""}
                  {q.caption && <span className="text-sand-600"> — {clamp(q.caption, 240)}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </LayerList>
      <LayerList title={t("admin.layerExtractions")} count={doc.extractions.length}>
        {doc.extractions.map((ex) => (
          <div key={ex.label} className="rounded-xl bg-paper p-3 text-sm">
            <p className="font-semibold text-sand-800">
              {t("admin.extractionOrigin", { label: ex.label, quote: clamp(ex.origin.quote, 160) })}
            </p>
            <ul className="mt-1 space-y-1">
              {ex.passages.map((p, i) => (
                <li key={i} className="text-xs text-sand-700">
                  &ldquo;{clamp(p.quote, 240)}&rdquo;
                  {p.orphaned ? ` ${t("admin.orphaned")}` : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </LayerList>
      <LayerList title={t("admin.layerSummaries")} count={doc.summaries.length}>
        {doc.summaries.map((s) => (
          <div key={s.depth} className="rounded-xl bg-paper p-3 text-sm">
            <p className="mb-1 text-xs font-semibold text-sand-600 uppercase">{s.depth}</p>
            <p className="whitespace-pre-wrap text-sand-800">{clamp(s.text, 1200)}</p>
          </div>
        ))}
      </LayerList>
      <LayerList title={t("admin.layerSalient")} count={doc.salience.length}>
        <p className="text-xs text-sand-700">
          {doc.salience.map((q) => `"${clamp(q.quote, 160)}"`).join("; ")}
        </p>
      </LayerList>
      <LayerList title={t("admin.layerLinks")} count={doc.links.length}>
        {doc.links.map((l, i) => (
          <p key={i} className="text-xs text-sand-700">
            &ldquo;{clamp(l.quote, 120)}&rdquo; →{" "}
            {l.toQuote ? `"${clamp(l.toQuote, 120)}"` : t("admin.linkToDocument")} ({l.toTitle})
          </p>
        ))}
      </LayerList>
      <LayerList title={t("admin.layerEdits")} count={doc.edits.length}>
        {doc.edits.map((e, i) => (
          <p key={i} className="text-xs text-sand-700">
            {e.kind}
            {e.before || e.after
              ? `: ${e.before ? `"${clamp(e.before, 100)}"` : t("admin.editNone")} → ${e.after ? `"${clamp(e.after, 100)}"` : t("admin.editNone")}`
              : ""}
          </p>
        ))}
      </LayerList>
    </details>
  );
}

function CorpusCard({ row, t }: { row: DigestRow; t: TFunc }) {
  const { parts, counts } = row;
  return (
    <details className="rounded-2xl bg-card p-4 shadow-soft" open>
      <summary className="cursor-pointer">
        <span className="text-base font-semibold text-sand-800">{parts.corpusTitle}</span>
        <span className="ml-2 text-xs text-sand-500">
          {t("admin.built", { time: fmtTime(row.builtAt) })}
          {row.rebuilt ? ` ${t("admin.rebuiltOnLoad")}` : ""}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          <Chip>{t("admin.countDocuments", { n: counts.documents })}</Chip>
          <Chip>{t("admin.countBlocks", { n: counts.blocks })}</Chip>
          <Chip>{t("admin.countNotes", { n: counts.notes })}</Chip>
          <Chip>{t("admin.countAnnotations", { n: counts.annotations })}</Chip>
          <Chip>{t("admin.countDistillations", { n: counts.distillations })}</Chip>
          <Chip>{t("admin.countExtractions", { n: counts.extractions })}</Chip>
          <Chip>{t("admin.countSummaries", { n: counts.summaries })}</Chip>
          <Chip>{t("admin.countChars", { n: fmtChars(row.chars) })}</Chip>
        </span>
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-sand-500">
          {t("admin.corpusId", { id: parts.corpusId })}
        </span>
        <a
          href={`/api/admin/digest?notebookId=${parts.corpusId}`}
          target="_blank"
          className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("admin.exactTextCorpus")}
        </a>
        <DigestRebuild notebookId={parts.corpusId} label={t("admin.rebuild")} />
      </div>
      <div className="mt-3 space-y-2">
        {parts.documents.map((doc) => (
          <DocumentCard key={doc.id} doc={doc} t={t} />
        ))}
        {parts.documents.length === 0 && (
          <p className="text-sm text-sand-600">{t("admin.noDocuments")}</p>
        )}
      </div>
      <LayerList title={t("admin.corpusNotes")} count={parts.notes.length}>
        {parts.notes.map((n) => (
          <NoteCard key={n.id} note={n} t={t} />
        ))}
      </LayerList>
      <LayerList title={t("admin.looseAnnotations")} count={parts.looseAnnotations.length}>
        {parts.looseAnnotations.map((n) => (
          <NoteCard key={n.id} note={n} t={t} />
        ))}
      </LayerList>
    </details>
  );
}

export type DigestAccount = { email: string; name: string; picture: string };

export async function DigestStore({
  rows,
  accounts,
}: {
  rows: DigestRow[];
  // userId → account identity, from the User table. The local reader has none.
  accounts: Record<string, DigestAccount>;
}) {
  const t = await serverT();
  const byUser = new Map<string, DigestRow[]>();
  for (const row of rows) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  // Accounts with no corpora still list, so every sign-up is visible here.
  for (const userId of Object.keys(accounts)) {
    if (!byUser.has(userId)) byUser.set(userId, []);
  }
  if (byUser.size === 0) {
    return <p className="text-sm text-sand-600">{t("admin.noCorpora")}</p>;
  }
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href="/api/admin/digest"
          target="_blank"
          className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          {t("admin.exactTextCorpora")}
        </a>
        <DigestRebuild label={t("admin.rebuildAll")} />
      </div>
      {[...byUser.entries()].map(([userId, userRows]) => {
        const totals = userRows.reduce(
          (a, r) => ({
            documents: a.documents + r.counts.documents,
            notes: a.notes + r.counts.notes,
            annotations: a.annotations + r.counts.annotations,
            distillations: a.distillations + r.counts.distillations,
            chars: a.chars + r.chars,
          }),
          { documents: 0, notes: 0, annotations: 0, distillations: 0, chars: 0 },
        );
        const account = accounts[userId];
        return (
          <section
            key={userId}
            className="max-h-[75vh] overflow-y-auto overscroll-y-contain rounded-2xl border border-line"
          >
            <div className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-paper px-4 py-3">
              {account?.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={account.picture} alt="" className="size-7 rounded-full" />
              ) : (
                <span className="flex size-7 items-center justify-center rounded-full bg-clay-100 text-xs font-semibold text-clay-800">
                  {(account?.name ?? t("admin.localReader"))[0]?.toUpperCase()}
                </span>
              )}
              <h2 className="text-sm font-bold text-sand-800">
                {account ? account.name : t("admin.localReader")}
              </h2>
              <span className="text-xs text-sand-500">{account ? account.email : userId}</span>
              <Chip>{t("admin.countCorpora", { n: userRows.length })}</Chip>
              <Chip>{t("admin.countDocuments", { n: totals.documents })}</Chip>
              <Chip>{t("admin.countNotes", { n: totals.notes })}</Chip>
              <Chip>{t("admin.countAnnotations", { n: totals.annotations })}</Chip>
              <Chip>{t("admin.countDistillations", { n: totals.distillations })}</Chip>
              <Chip>{t("admin.countCharsStored", { n: fmtChars(totals.chars) })}</Chip>
            </div>
            <div className="space-y-3 p-4">
              {userRows.map((row) => (
                <CorpusCard key={row.notebookId} row={row} t={t} />
              ))}
              {userRows.length === 0 && (
                <p className="text-sm text-sand-600">{t("admin.noCorpora")}</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
