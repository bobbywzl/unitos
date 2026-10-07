"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

// Kept conversations (SPEC.md §21): the turns of an assistant surface that
// keeps no note of its own — the media assistant, Ask about a range, Stitch,
// the note's assistant — kept for the account at one place, so the
// conversation survives leaving the page, a reload, and another device. It
// stays until the reader clears it (Clear conversation).
//
// One store per place for the page's life, outside every component: an
// answer that lands after the surface closed (the reader went to another
// page) still lands in the conversation, and the surface shows it when it
// opens again. Every change is written to localStorage at once and to the
// server (PUT /api/assistant/kept) a moment later; the local copy is cleared
// when the server confirms it, so a lost connection, a reload, or a closed
// tab never loses a turn. A clear is a change like any other: an empty
// conversation deletes the row.

export type KeptTurn = {
  role: "user" | "assistant";
  content: string;
  /** What the surface draws under the turn; the surface reads it back. */
  data?: Record<string, unknown>;
};

type State<T extends KeptTurn> = { turns: T[]; hydrated: boolean; busy: boolean };

type Entry = {
  notebookId: string;
  place: string;
  state: State<KeptTurn>;
  listeners: Set<() => void>;
  // The local change count and the count the server last confirmed.
  version: number;
  confirmed: number;
  timer: ReturnType<typeof setTimeout> | null;
  retry: number;
  // The running answer, so Stop works from a surface opened again.
  abort: AbortController | null;
  // The signed-in account the server answered for; null until it answers.
  account: string | null;
};

const LOCAL_PREFIX = "unitos-kept-chat:";
const SAVE_DELAY_MS = 400;
const TURNS_MAX = 200;
const TURN_MAX_CHARS = 60_000;

const entries = new Map<string, Entry>();
const EMPTY: State<KeptTurn> = { turns: [], hydrated: false, busy: false };

const keyOf = (notebookId: string, place: string) => `${notebookId}|${place}`;

// The account that wrote a local copy rides with it: another account
// signed in on this browser never adopts it. A copy whose account is not the
// one signed in is parked under that account's own name, so it saves when
// that account comes back. A copy written before the server answered has no
// account: one written in this page was typed by the account signed in now;
// one left by an earlier page has no known writer, so it is parked under
// "unknown" and never saved as anyone's.
// When this page started.
const PAGE_START = Date.now();
const UNKNOWN_ACCOUNT = "unknown";

type LocalCopy = { turns: KeptTurn[]; at: number; account?: string };

const parkedKey = (account: string, key: string) => `${account}|${key}`;

function readLocal(key: string): LocalCopy | null {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalCopy;
    return Array.isArray(parsed.turns) && typeof parsed.at === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocal(key: string, turns: KeptTurn[], account: string | null, at = Date.now()) {
  try {
    const copy: LocalCopy = { turns, at, ...(account ? { account } : {}) };
    localStorage.setItem(LOCAL_PREFIX + key, JSON.stringify(copy));
  } catch {
    // A full or blocked store: the server save still runs.
  }
}

function dropLocal(key: string) {
  try {
    localStorage.removeItem(LOCAL_PREFIX + key);
  } catch {
    // Nothing to drop.
  }
}

function emit(entry: Entry) {
  for (const listener of entry.listeners) listener();
}

function setState(entry: Entry, next: Partial<State<KeptTurn>>) {
  entry.state = { ...entry.state, ...next };
  emit(entry);
}

/** The turns as the server takes them: the newest TURNS_MAX, each cut. */
function wire(turns: KeptTurn[]): KeptTurn[] {
  return turns.slice(-TURNS_MAX).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, TURN_MAX_CHARS),
    ...(turn.data ? { data: JSON.parse(JSON.stringify(turn.data)) as Record<string, unknown> } : {}),
  }));
}

async function save(entry: Entry) {
  entry.timer = null;
  const version = entry.version;
  const turns = entry.state.turns;
  const key = keyOf(entry.notebookId, entry.place);
  try {
    const res =
      turns.length === 0
        ? await fetch("/api/assistant/kept", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notebookId: entry.notebookId, place: entry.place }),
          })
        : await fetch("/api/assistant/kept", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notebookId: entry.notebookId, place: entry.place, turns: wire(turns) }),
          });
    // Refused for good (no access, signed out, a body the route refuses):
    // the local copy stays, so nothing is lost; the next change tries again.
    if (!res.ok) throw new Error(String(res.status));
    entry.confirmed = Math.max(entry.confirmed, version);
    entry.retry = 0;
    if (entry.version === version) dropLocal(key);
  } catch {
    // Offline: the local copy holds the turns; try again with a backoff,
    // and at once when the browser is back online.
    entry.retry = Math.min(entry.retry + 1, 6);
    if (entry.version === version && !entry.timer) {
      entry.timer = setTimeout(() => void save(entry), 1000 * 2 ** entry.retry);
    }
  }
}

function schedule(entry: Entry, delay = SAVE_DELAY_MS) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => void save(entry), delay);
}

function change(entry: Entry, turns: KeptTurn[]) {
  entry.version += 1;
  writeLocal(keyOf(entry.notebookId, entry.place), turns, entry.account);
  setState(entry, { turns });
  // Before the server copy is read, a save would overwrite it: hydrate()
  // saves once it has decided which copy wins.
  if (entry.state.hydrated) schedule(entry);
}

async function hydrate(entry: Entry) {
  const key = keyOf(entry.notebookId, entry.place);
  let local = readLocal(key);
  try {
    const params = new URLSearchParams({ notebookId: entry.notebookId, place: entry.place });
    const res = await fetch(`/api/assistant/kept?${params}`);
    const json = (await res.json().catch(() => null)) as {
      turns?: KeptTurn[];
      updatedAt?: string | null;
      account?: string;
    } | null;
    if (!res.ok || !json?.account) throw new Error(String(res.status));
    const account = json.account;
    entry.account = account;
    // Another account's copy is parked under its name; this account's
    // parked copy, if any, takes its place.
    const owner = local ? (local.account ?? (local.at < PAGE_START ? UNKNOWN_ACCOUNT : account)) : null;
    if (local && owner !== account) {
      writeLocal(parkedKey(owner!, key), local.turns, owner, local.at);
      dropLocal(key);
      local = null;
    }
    const parked = readLocal(parkedKey(account, key));
    if (parked) {
      dropLocal(parkedKey(account, key));
      if (!local || parked.at > local.at) local = parked;
    }
    // Every local copy from here on names this account.
    if (local) writeLocal(key, local.turns, account, local.at);
    if (local && entry.version === 0) setState(entry, { turns: local.turns });
    const server = json.turns ?? [];
    const serverAt = json.updatedAt ? Date.parse(json.updatedAt) : 0;
    const changedHere = entry.version > 0;
    // A local copy is a change the server never confirmed: it wins unless the
    // server's copy changed after it (another device, later).
    const localWins = changedHere || (local !== null && local.at >= serverAt);
    if (localWins) {
      entry.state = { ...entry.state, hydrated: true };
      emit(entry);
      if (changedHere || local) schedule(entry, 0);
    } else {
      if (local) dropLocal(key);
      setState(entry, { turns: server, hydrated: true });
    }
  } catch {
    // Offline or refused: what this browser holds stands, shown only when it
    // is not another account's; a later change saves it.
    const mine = local && !local.account && local.at >= PAGE_START;
    if (mine && entry.version === 0) setState(entry, { turns: local!.turns });
    setState(entry, { hydrated: true });
    if (entry.version > 0 || mine) schedule(entry, 2000);
  }
}

function entryFor(notebookId: string, place: string): Entry {
  const key = keyOf(notebookId, place);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      notebookId,
      place,
      state: EMPTY,
      listeners: new Set(),
      version: 0,
      confirmed: 0,
      timer: null,
      retry: 0,
      abort: null,
      account: null,
    };
    entries.set(key, entry);
    if (typeof window !== "undefined") void hydrate(entry);
  }
  return entry;
}

// Back online: every conversation with an unconfirmed change saves now.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const entry of entries.values()) {
      if (entry.version > entry.confirmed && entry.state.hydrated) schedule(entry, 0);
    }
  });
}

function stopRun(entry: Entry) {
  entry.abort?.abort();
  entry.abort = null;
  setState(entry, { busy: false });
}

function clearEntry(entry: Entry) {
  stopRun(entry);
  change(entry, []);
}

function beginRun(entry: Entry): AbortController {
  const controller = new AbortController();
  entry.abort = controller;
  setState(entry, { busy: true });
  return controller;
}

function endRun(entry: Entry, controller: AbortController) {
  if (entry.abort !== controller) return;
  entry.abort = null;
  setState(entry, { busy: false });
}

const noop = () => () => {};

/**
 * The kept conversation at one place of one project. `setTurns` and the run
 * helpers keep working after the surface closes, so an answer that lands
 * late still lands. Null ids: nothing is kept (no project at hand).
 */
export function useKeptChat<T extends KeptTurn>(notebookId: string | null, place: string | null) {
  const entry = useMemo(
    () => (notebookId && place && typeof window !== "undefined" ? entryFor(notebookId, place) : null),
    [notebookId, place],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!entry) return noop();
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    [entry],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => (entry ? entry.state : EMPTY),
    () => EMPTY,
  ) as State<T>;

  const setTurns = useCallback(
    (update: (turns: T[]) => T[]) => {
      if (!entry) return;
      change(entry, update(entry.state.turns as T[]));
    },
    [entry],
  );
  /** Clear conversation: the turns go, here and on the server. */
  const clear = useCallback(() => {
    if (entry) clearEntry(entry);
  }, [entry]);
  /** An answer starts: the conversation is busy until `end` with the same controller. */
  const begin = useCallback(() => (entry ? beginRun(entry) : new AbortController()), [entry]);
  const end = useCallback(
    (controller: AbortController) => {
      if (entry) endRun(entry, controller);
    },
    [entry],
  );
  const stop = useCallback(() => {
    if (entry) stopRun(entry);
  }, [entry]);

  return { turns: state.turns, hydrated: state.hydrated, busy: state.busy, setTurns, clear, begin, end, stop };
}

// The words typed in a surface's box, kept in this browser until they are
// sent, so leaving the page or a reload never loses them.
const DRAFT_PREFIX = "unitos-kept-chat-draft:";

export function readChatDraft(key: string): string {
  try {
    return localStorage.getItem(DRAFT_PREFIX + key) ?? "";
  } catch {
    return "";
  }
}

export function writeChatDraft(key: string, text: string) {
  try {
    if (text) localStorage.setItem(DRAFT_PREFIX + key, text);
    else localStorage.removeItem(DRAFT_PREFIX + key);
  } catch {
    // The words stay in the box for this session.
  }
}

/** Restore a box's kept words after the first render (server and client agree). */
export function useChatDraft(key: string | null, set: (text: string) => void) {
  useEffect(() => {
    if (!key) return;
    const text = readChatDraft(key);
    if (text) set(text);
    // set is a state setter; the key alone decides.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
