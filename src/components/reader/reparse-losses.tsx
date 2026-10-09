"use client";

import { useEffect, useState } from "react";
import { useT } from "@/components/lang-provider";
import type { ReparseLoss } from "@/lib/docs/reparse-losses";

// Re-parse on an edited import asks before Replace the edits (SPEC.md §29),
// and names the notes and annotations whose quotes stand on words added
// since the import: after the replace those quotes lose their place.

/** The losses of one import, read when `documentId` is set (the ask opens)
    and again for each new id. `losing` is null while it loads, when the read
    failed (offline), or when there is nothing to say. */
export function useReparseLosses(documentId: string | null): { losing: ReparseLoss[] | null; loading: boolean } {
  const [state, setState] = useState<{ id: string | null; losing: ReparseLoss[] | null; loading: boolean }>({
    id: null,
    losing: null,
    loading: false,
  });
  // A new id starts a new read: adjust during render, then fetch.
  if (state.id !== documentId) setState({ id: documentId, losing: null, loading: documentId !== null });
  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;
    void (async () => {
      let losing: ReparseLoss[] | null = null;
      try {
        const res = await fetch(`/api/documents/${documentId}/reparse`);
        if (res.ok) losing = ((await res.json()) as { losing: ReparseLoss[] | null }).losing;
      } catch {
        // Offline: the plain ask stands.
      }
      if (!cancelled) setState((s) => (s.id === documentId ? { ...s, losing, loading: false } : s));
    })();
    return () => {
      cancelled = true;
    };
  }, [documentId]);
  return { losing: state.losing, loading: state.loading };
}

const SHOWN = 5;

/** The notes, then the annotations, that lose their place: a count line and
    their names, five of each at most. */
export function ReparseLossList({ losing }: { losing: ReparseLoss[] }) {
  const t = useT();
  const notes = losing.filter((l) => !l.annotation);
  const annotations = losing.filter((l) => l.annotation);
  const group = (items: ReparseLoss[], kind: "Notes" | "Annotations") =>
    items.length > 0 && (
      <div data-reparse-losses={kind.toLowerCase()} className="text-[11.5px] leading-snug text-sand-700">
        <p className="font-semibold">
          {items.length === 1 ? t(`panes.reparseLoses${kind}One`) : t(`panes.reparseLoses${kind}`, { n: items.length })}
        </p>
        <ul className="mt-0.5 flex flex-col gap-0.5">
          {items.slice(0, SHOWN).map((l) => (
            <li key={l.id} className="flex gap-1.5">
              <span aria-hidden className="text-sand-400">
                –
              </span>
              <span className="min-w-0 break-words">{l.name}</span>
            </li>
          ))}
          {items.length > SHOWN && (
            <li className="pl-3 text-sand-500">{t("panes.reparseLosesMore", { n: items.length - SHOWN })}</li>
          )}
        </ul>
      </div>
    );
  return (
    <>
      {group(notes, "Notes")}
      {group(annotations, "Annotations")}
    </>
  );
}
