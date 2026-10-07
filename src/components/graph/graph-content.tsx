"use client";

// [view2] What the documents say, on the graph (SPEC.md §13): the node card
// (a click selects a node and pins its card), Find across the project, and
// the last Stitch answer's proposed links lit in place. The overlay holds
// this state (useGraphContentState) and provides it; the canvas reads it
// (useGraphContent) for the spotlight, the find counts, and the halo.
// Nothing here calls a model: the card reads stored outlines, and Find
// matches words.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { FindResult } from "@/lib/graph/find";
import { FIND_MAX, FIND_MIN, normalizeQuery } from "@/lib/graph/find";

/** Decision 2 (pending with Linda), option A: a click on a node selects it
    and pins its card; a second click, Enter, or Open in reader opens the
    document. false is option B: a click opens, as before, and the card
    pins from a right-click or a long press on the node. */
export const CLICK_SELECTS = true;

export type GraphContentList = "document" | "find";

export type GraphContent = {
  clickSelects: boolean;
  /** The node whose card is pinned; null = none. */
  focusedId: string | null;
  /** Select a node: its card pins beside the canvas. */
  select: (documentId: string) => void;
  /** Each document's gist (the skeleton's), for the hover card. */
  gists: Record<string, string>;
  /** Find's passages per document; null = no find. */
  findHits: Map<string, number> | null;
  /** The recommended links the last Stitch answer proposed. */
  proposedLinkIds: Set<string>;
};

const NONE = new Set<string>();

const GraphContentContext = createContext<GraphContent>({
  clickSelects: false,
  focusedId: null,
  select: () => {},
  gists: {},
  findHits: null,
  proposedLinkIds: NONE,
});

export const GraphContentProvider = GraphContentContext.Provider;

export function useGraphContent(): GraphContent {
  return useContext(GraphContentContext);
}

// The card and the find live in the URL (replaceState), so Back from a
// document opened from either returns to it.
const DOC_PARAM = "graphDoc";
const FIND_PARAM = "graphFind";
function readParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}
function writeParam(name: string, value: string | null) {
  const url = new URL(window.location.href);
  if (url.searchParams.get("graph") !== "1") return; // the graph is leaving
  if ((url.searchParams.get(name) ?? null) === value) return;
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  window.history.replaceState(window.history.state, "", url);
}
/** The URL without the graph's card and find (the graph closed). */
export function withoutGraphParams(url: URL): URL {
  url.searchParams.delete(DOC_PARAM);
  url.searchParams.delete(FIND_PARAM);
  return url;
}

export type FindState = {
  query: string;
  setQuery: (q: string) => void;
  result: FindResult | null;
  loading: boolean;
  error: boolean;
  clear: () => void;
};

/** The overlay's half: the selection, the find, and the proposed links.
    list/setList: the overlay's one side list at a time. */
export function useGraphContentState<L extends string | null>({
  notebookId,
  nodeIds,
  gists,
  list,
  setList,
}: {
  notebookId: string;
  nodeIds: string[];
  gists: Record<string, string>;
  list: L;
  setList: (list: GraphContentList | null) => void;
}) {
  const [focusId, setFocusId] = useState<string | null>(() => readParam(DOC_PARAM));
  // Restored from the URL (Back from a document): the card reopens.
  useEffect(() => {
    if (focusId) setList("document");
    else if (readParam(FIND_PARAM)) setList("find");
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const known = useMemo(() => new Set(nodeIds), [nodeIds]);
  const focusedId = list === "document" && focusId && (known.size === 0 || known.has(focusId)) ? focusId : null;
  useEffect(() => {
    writeParam(DOC_PARAM, focusedId);
  }, [focusedId]);
  const select = useCallback(
    (documentId: string) => {
      setFocusId(documentId);
      setList("document");
    },
    [setList],
  );

  // Find (SPEC.md §13): the words, after a rest of 250 ms.
  const [query, setQueryState] = useState(() => readParam(FIND_PARAM) ?? "");
  // The last answer, and the words it answers: while new words wait, the
  // canvas keeps the last answer's counts.
  const [answer, setAnswer] = useState<{ words: string; result: FindResult | null } | null>(null);
  const setQuery = useCallback(
    (q: string) => {
      setQueryState(q);
      if (normalizeQuery(q).length >= FIND_MIN) setList("find");
      else if (list === "find") setList(null);
    },
    [list, setList],
  );
  const words = normalizeQuery(query).slice(0, FIND_MAX);
  useEffect(() => {
    writeParam(FIND_PARAM, words.length >= FIND_MIN ? words : null);
    if (words.length < FIND_MIN) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/notebooks/${notebookId}/find?q=${encodeURIComponent(words)}`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<FindResult>) : Promise.reject(new Error(String(r.status)))))
        .then((result) => setAnswer({ words, result }))
        .catch(() => {
          if (!controller.signal.aborted) setAnswer({ words, result: null });
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [words, notebookId]);
  const clear = useCallback(() => {
    setQueryState("");
    if (list === "find") setList(null);
  }, [list, setList]);
  const active = words.length >= FIND_MIN;
  const current = active && answer?.words === words ? answer : null;
  const shownResult = active ? (answer?.result ?? null) : null;
  const findHits = useMemo(
    () => (shownResult ? new Map(shownResult.documents.map((d) => [d.id, d.count])) : null),
    [shownResult],
  );
  const find: FindState = {
    query,
    setQuery,
    result: current?.result ?? null,
    loading: active && !current,
    error: current !== null && current.result === null,
    clear,
  };

  // The links the last Stitch answer proposed: lit until the next command
  // or a click on the canvas, as its cited documents are.
  const [proposedLinkIds, setProposed] = useState<Set<string>>(NONE);
  const onProposed = useCallback((ids: string[]) => setProposed(ids.length > 0 ? new Set(ids) : NONE), []);

  // Ask Stitch from Find: the box takes the words, the reader presses Send.
  const [prefill, setPrefill] = useState<{ text: string; seq: number } | null>(null);
  const askStitch = useCallback((text: string) => setPrefill((p) => ({ text, seq: (p?.seq ?? 0) + 1 })), []);

  const content = useMemo<GraphContent>(
    () => ({ clickSelects: CLICK_SELECTS, focusedId, select, gists, findHits, proposedLinkIds }),
    [focusedId, select, gists, findHits, proposedLinkIds],
  );
  return { content, focusedId, select, find, proposedLinkIds, onProposed, prefill, askStitch };
}
