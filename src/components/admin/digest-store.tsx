import type { DigestRow } from "@/lib/digest/ensure";
import type { DigestDocument, DigestNote } from "@/lib/digest/types";
import { DigestRebuild } from "@/components/admin/digest-rebuild";

// The digest store, per user: every corpus → every document → its annotations,
// distillations, extractions, summaries — plus the corpus's notes. Document
// text stays out of the page; the "Exact text" link serves it as the assistant
// reads it. Server-rendered; <details> does the folding.

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

function NoteCard({ note }: { note: DigestNote }) {
  return (
    <div className="rounded-xl bg-paper p-3 text-sm">
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        <Chip>{note.kind}</Chip>
        {note.color && <Chip>{note.color}</Chip>}
        {!note.hidden && <Chip>section: {note.section}</Chip>}
        {note.status === "PENDING" && <Chip>pending</Chip>}
        <span className="font-mono text-[10px] text-sand-500">note {note.id}</span>
      </div>
      {note.content && <p className="whitespace-pre-wrap text-sand-800">{clamp(note.content)}</p>}
      {note.sources.length > 0 && (
        <p className="mt-1 text-xs text-sand-600">
          {note.sources
            .map((s) => {
              const time = timeRange(s.startTime, s.endTime);
              const place = time ?? `"${clamp(s.quote, 120)}"`;
              return `${place} (${s.documentTitle})${s.orphaned ? " (orphaned)" : ""}`;
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

function DocumentCard({ doc }: { doc: DigestDocument }) {
  const meta = doc.video
    ? `video: ${doc.video.kind === "YOUTUBE" ? `YouTube ${doc.video.youtubeId ?? ""}` : "upload"}, transcript ${doc.video.transcriptStatus.toLowerCase()}`
    : (doc.sourceUrl ?? "PDF");
  return (
    <details className="rounded-xl bg-card p-3 shadow-soft">
      <summary className="cursor-pointer">
        <span className="text-sm font-semibold text-sand-800">{doc.title}</span>
        <span className="ml-2 text-xs text-sand-500">{meta}</span>
        <span className="mt-1 flex flex-wrap gap-1.5">
          <Chip>{fmtChars(doc.chars)} chars</Chip>
          <Chip>{doc.annotations.length} annotations</Chip>
          <Chip>{doc.distillations.length} distillations</Chip>
          <Chip>{doc.extractions.length} extractions</Chip>
          <Chip>{doc.summaries.length} summaries</Chip>
          {doc.salience.length > 0 && <Chip>{doc.salience.length} salient spans</Chip>}
          {doc.links.length > 0 && <Chip>{doc.links.length} links</Chip>}
          {doc.edits.length > 0 && <Chip>{doc.edits.length} edits</Chip>}
        </span>
      </summary>
      <p className="mt-2 font-mono text-[10px] text-sand-500">document {doc.id}</p>
      <LayerList title="Annotations" count={doc.annotations.length}>
        {doc.annotations.map((a) => (
          <NoteCard key={a.id} note={a} />
        ))}
      </LayerList>
      <LayerList title="Distillations" count={doc.distillations.length}>
        {doc.distillations.map((di) => (
          <div key={di.id} className="rounded-xl bg-paper p-3 text-sm">
            <p className="font-semibold text-sand-800">Q: {di.question}</p>
            <ul className="mt-1 space-y-1">
              {di.quotes.map((q, i) => (
                <li key={i} className="text-xs text-sand-700">
                  &ldquo;{clamp(q.quote, 240)}&rdquo;{q.orphaned ? " (orphaned)" : ""}
                  {q.caption && <span className="text-sand-600"> — {clamp(q.caption, 240)}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </LayerList>
      <LayerList title="Extractions" count={doc.extractions.length}>
        {doc.extractions.map((ex) => (
          <div key={ex.label} className="rounded-xl bg-paper p-3 text-sm">
            <p className="font-semibold text-sand-800">
              {ex.label} — origin &ldquo;{clamp(ex.origin.quote, 160)}&rdquo;
            </p>
            <ul className="mt-1 space-y-1">
              {ex.passages.map((p, i) => (
                <li key={i} className="text-xs text-sand-700">
                  &ldquo;{clamp(p.quote, 240)}&rdquo;{p.orphaned ? " (orphaned)" : ""}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </LayerList>
      <LayerList title="Summaries" count={doc.summaries.length}>
        {doc.summaries.map((s) => (
          <div key={s.depth} className="rounded-xl bg-paper p-3 text-sm">
            <p className="mb-1 text-xs font-semibold text-sand-600 uppercase">{s.depth}</p>
            <p className="whitespace-pre-wrap text-sand-800">{clamp(s.text, 1200)}</p>
          </div>
        ))}
      </LayerList>
      <LayerList title="Salient passages" count={doc.salience.length}>
        <p className="text-xs text-sand-700">
          {doc.salience.map((q) => `"${clamp(q.quote, 160)}"`).join("; ")}
        </p>
      </LayerList>
      <LayerList title="Links" count={doc.links.length}>
        {doc.links.map((l, i) => (
          <p key={i} className="text-xs text-sand-700">
            &ldquo;{clamp(l.quote, 120)}&rdquo; → {l.toQuote ? `"${clamp(l.toQuote, 120)}"` : "the document"} ({l.toTitle})
          </p>
        ))}
      </LayerList>
      <LayerList title="Edits" count={doc.edits.length}>
        {doc.edits.map((e, i) => (
          <p key={i} className="text-xs text-sand-700">
            {e.kind}
            {e.before || e.after ? `: ${e.before ? `"${clamp(e.before, 100)}"` : "(none)"} → ${e.after ? `"${clamp(e.after, 100)}"` : "(none)"}` : ""}
          </p>
        ))}
      </LayerList>
    </details>
  );
}

function CorpusCard({ row }: { row: DigestRow }) {
  const { parts, counts } = row;
  return (
    <details className="rounded-2xl bg-card p-4 shadow-soft" open>
      <summary className="cursor-pointer">
        <span className="text-base font-semibold text-sand-800">{parts.corpusTitle}</span>
        <span className="ml-2 text-xs text-sand-500">
          built {fmtTime(row.builtAt)}
          {row.rebuilt ? " (rebuilt on this load)" : ""}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1.5">
          <Chip>{counts.documents} documents</Chip>
          <Chip>{counts.blocks} blocks</Chip>
          <Chip>{counts.notes} notes</Chip>
          <Chip>{counts.annotations} annotations</Chip>
          <Chip>{counts.distillations} distillations</Chip>
          <Chip>{counts.extractions} extractions</Chip>
          <Chip>{counts.summaries} summaries</Chip>
          <Chip>{fmtChars(row.chars)} chars</Chip>
        </span>
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-sand-500">corpus {parts.corpusId}</span>
        <a
          href={`/api/admin/digest?notebookId=${parts.corpusId}`}
          target="_blank"
          className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          Exact text (Corpus scope)
        </a>
        <DigestRebuild notebookId={parts.corpusId} label="Rebuild" />
      </div>
      <div className="mt-3 space-y-2">
        {parts.documents.map((doc) => (
          <DocumentCard key={doc.id} doc={doc} />
        ))}
        {parts.documents.length === 0 && (
          <p className="text-sm text-sand-600">No documents attached.</p>
        )}
      </div>
      <LayerList title="Notes in this corpus" count={parts.notes.length}>
        {parts.notes.map((n) => (
          <NoteCard key={n.id} note={n} />
        ))}
      </LayerList>
      <LayerList title="Annotations not anchored in an attached document" count={parts.looseAnnotations.length}>
        {parts.looseAnnotations.map((n) => (
          <NoteCard key={n.id} note={n} />
        ))}
      </LayerList>
    </details>
  );
}

export type DigestAccount = { email: string; name: string; picture: string };

export function DigestStore({
  rows,
  accounts,
}: {
  rows: DigestRow[];
  // userId → account identity, from the User table. The local reader has none.
  accounts: Record<string, DigestAccount>;
}) {
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
    return <p className="text-sm text-sand-600">No corpora yet. The digest builds when one exists.</p>;
  }
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href="/api/admin/digest"
          target="_blank"
          className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800"
        >
          Exact text (Corpora scope)
        </a>
        <DigestRebuild label="Rebuild all" />
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
          <section key={userId}>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {account?.picture ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={account.picture} alt="" className="size-7 rounded-full" />
              ) : (
                <span className="flex size-7 items-center justify-center rounded-full bg-clay-100 text-xs font-semibold text-clay-800">
                  {(account?.name ?? "L")[0]?.toUpperCase()}
                </span>
              )}
              <h2 className="text-sm font-bold text-sand-800">
                {account ? account.name : "Local reader"}
              </h2>
              <span className="text-xs text-sand-500">{account ? account.email : userId}</span>
              <Chip>{userRows.length} corpora</Chip>
              <Chip>{totals.documents} documents</Chip>
              <Chip>{totals.notes} notes</Chip>
              <Chip>{totals.annotations} annotations</Chip>
              <Chip>{totals.distillations} distillations</Chip>
              <Chip>{fmtChars(totals.chars)} chars stored</Chip>
            </div>
            <div className="space-y-3">
              {userRows.map((row) => (
                <CorpusCard key={row.notebookId} row={row} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
