"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { clientLang } from "@/lib/api";
import { USER_ID } from "@/lib/constants";
import { translate } from "@/lib/i18n/dictionaries";
import { postUndoPill } from "@/lib/notes/undo-pill";
import { readAccountCookie, tabAccount } from "@/lib/tab-account";

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
// tab never loses a turn.
//
// Each page writes its own local copy (`<project>|<place>|<page id>`), so two
// tabs never write over each other's unsaved turns. A copy names the account
// that wrote it. A load, and every save, takes in the unsaved copies other
// pages of the same account left for the place (a closed tab's turns, a tab
// whose saves fail), and drops such a copy once its turns are on the server.
// Every turn carries an id, so a turn two copies hold lands once.
//
// A save names the server copy it was built on (`base`, the row's
// updatedAt; null = no row read). When the row changed since — another tab,
// another device, or a load that failed — the server refuses (409), and the
// store reads the server copy and puts its own new turns after it: the turns
// past `baseCount`, the count the base held, that the server does not hold
// yet. So no save ever writes over turns it never saw. A surface whose
// conversation is one exchange that a new one replaces (Ask about a range)
// merges by replacing instead. Clear empties the conversation at once and
// shows the Undo pill; the row is deleted when the pill goes without Undo,
// whatever its base: it is the reader's explicit word.

export type KeptTurn = {
  role: "user" | "assistant";
  content: string;
  /** What the surface draws under the turn; the surface reads it back. */
  data?: Record<string, unknown>;
  /** The turn's own id, so copies merge without doubling it; the store
      gives one to a turn that has none. */
  id?: string;
};

/** append: new turns go after the server's; replace: the newest exchange wins. */
export type KeptMode = "append" | "replace";

type State<T extends KeptTurn> = { turns: T[]; hydrated: boolean; busy: boolean };

type Entry = {
  notebookId: string;
  place: string;
  mode: KeptMode;
  state: State<KeptTurn>;
  listeners: Set<() => void>;
  // The local change count and the count the server last confirmed.
  version: number;
  confirmed: number;
  timer: ReturnType<typeof setTimeout> | null;
  retry: number;
  // A save on its way: a second one waits for it.
  inflight: boolean;
  // The running answer, so Stop works from a surface opened again.
  abort: AbortController | null;
  // The signed-in account the server answered for; null until it answers.
  account: string | null;
  // The server copy the turns were built on, and how many turns it held.
  base: string | null;
  baseCount: number;
  // Other pages' copies taken in, as they stood: dropped once a save lands.
  adopted: { name: string; at: number }[];
  // A Clear whose Undo pill still shows.
  pendingClear: object | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;
};

const LOCAL_PREFIX = "unitos-kept-chat:";
const SAVE_DELAY_MS = 400;
const TURNS_MAX = 2000;
const TURN_MAX_CHARS = 60_000;

const entries = new Map<string, Entry>();
const EMPTY: State<KeptTurn> = { turns: [], hydrated: false, busy: false };

const keyOf = (notebookId: string, place: string) => `${notebookId}|${place}`;

// When this page started, and its id: the name of its own local copies.
const PAGE_START = Date.now();
const PAGE_ID = `${PAGE_START.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const ownName = (key: string) => `${key}|${PAGE_ID}`;
// A copy parked under no account by an earlier version of this store.
const UNKNOWN_ACCOUNT = "unknown";

function turnId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function withIds(turns: KeptTurn[]): KeptTurn[] {
  return turns.some((turn) => !turn.id) ? turns.map((turn) => (turn.id ? turn : { ...turn, id: turnId() })) : turns;
}

type LocalCopy = {
  turns: KeptTurn[];
  at: number;
  account?: string;
  // The server copy the turns were built on (see Entry).
  base?: string | null;
  baseCount?: number;
};

function readLocal(name: string): LocalCopy | null {
  try {
    const raw = localStorage.getItem(LOCAL_PREFIX + name);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalCopy;
    return Array.isArray(parsed.turns) && typeof parsed.at === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function putLocal(name: string, copy: LocalCopy) {
  try {
    localStorage.setItem(LOCAL_PREFIX + name, JSON.stringify(copy));
  } catch {
    // A full or blocked store: the server save still runs.
  }
}

/** The account signed in on this tab, when sign-in names one. */
function tabSignedIn(): string | null {
  return tabAccount() ?? readAccountCookie();
}

/** The entry's turns as this page's local copy, with the base they were built on. */
function writeLocal(entry: Entry) {
  const account = entry.account ?? tabSignedIn();
  putLocal(ownName(keyOf(entry.notebookId, entry.place)), {
    turns: entry.state.turns,
    at: Date.now(),
    ...(account ? { account } : {}),
    base: entry.base,
    baseCount: entry.baseCount,
  });
}

function dropLocal(name: string) {
  try {
    localStorage.removeItem(LOCAL_PREFIX + name);
  } catch {
    // Nothing to drop.
  }
}

/** Drop another page's copy only when it still stands as it was taken in. */
function dropAdopted(adopted: { name: string; at: number }) {
  if (readLocal(adopted.name)?.at === adopted.at) dropLocal(adopted.name);
}

type Found = { name: string; copy: LocalCopy; own: boolean; writer: string | null };

/** Every local copy of the place: this page's, other pages', and the ones an
    earlier version of this store left (`<key>`, parked `<account>|<key>`). */
function copiesOf(key: string): Found[] {
  const names: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name?.startsWith(LOCAL_PREFIX)) names.push(name.slice(LOCAL_PREFIX.length));
    }
  } catch {
    return [];
  }
  const found: Found[] = [];
  for (const name of names) {
    let parkedUnder: string | null = null;
    if (name !== key && !name.startsWith(`${key}|`)) {
      if (!name.endsWith(`|${key}`)) continue;
      parkedUnder = name.slice(0, -(key.length + 1));
    }
    const copy = readLocal(name);
    if (!copy) continue;
    const writer = copy.account ?? (parkedUnder && parkedUnder !== UNKNOWN_ACCOUNT ? parkedUnder : null);
    found.push({ name, copy, own: name === ownName(key), writer });
  }
  return found.sort((a, b) => a.copy.at - b.copy.at);
}

/** A copy this account may take in: its own, this page's, or, with sign-in
    off (one account only), one whose writer is not known. */
function isMine(found: Found, account: string): boolean {
  return found.own || found.writer === account || (found.writer === null && account === USER_ID);
}

function emit(entry: Entry) {
  for (const listener of entry.listeners) listener();
}

function setState(entry: Entry, next: Partial<State<KeptTurn>>) {
  entry.state = { ...entry.state, ...next };
  emit(entry);
}

/** The turns as the server takes them, each cut to the route's limit. */
function wire(turns: KeptTurn[]): KeptTurn[] {
  return turns.map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, TURN_MAX_CHARS),
    ...(turn.data ? { data: JSON.parse(JSON.stringify(turn.data)) as Record<string, unknown> } : {}),
    ...(turn.id ? { id: turn.id } : {}),
  }));
}

/** `extra` after `turns`, leaving out a turn `turns` holds already (by id;
    a turn with no id, from before turns had one, by its words when asked). */
function appendNew(turns: KeptTurn[], extra: KeptTurn[], byWords = false): KeptTurn[] {
  const ids = new Set(turns.map((turn) => turn.id).filter(Boolean));
  const words = byWords ? new Set(turns.map((turn) => `${turn.role}\u0000${turn.content}`)) : null;
  const add = extra.filter((turn) =>
    turn.id ? !ids.has(turn.id) : !words?.has(`${turn.role}\u0000${turn.content}`),
  );
  return add.length > 0 ? [...turns, ...add] : turns;
}

/** This browser's turns put on the server's: what neither copy may lose. */
function merge(mode: KeptMode, server: KeptTurn[], local: KeptTurn[], baseCount: number): KeptTurn[] {
  if (mode === "replace") return local.length > 0 ? local : server;
  return appendNew(server, local.slice(Math.min(baseCount, local.length)));
}

type ServerCopy = { turns: KeptTurn[]; updatedAt: string | null; account: string };

async function readServer(entry: Entry): Promise<ServerCopy> {
  const params = new URLSearchParams({ notebookId: entry.notebookId, place: entry.place });
  const res = await fetch(`/api/assistant/kept?${params}`);
  const json = (await res.json().catch(() => null)) as Partial<ServerCopy> | null;
  if (!res.ok || !json?.account) throw new Error(String(res.status));
  return { turns: json.turns ?? [], updatedAt: json.updatedAt ?? null, account: json.account };
}

/** The server refused a save: read its copy and put this browser's new turns after it. */
async function resync(entry: Entry) {
  const server = await readServer(entry);
  const turns = merge(entry.mode, server.turns, entry.state.turns, entry.baseCount);
  entry.base = server.updatedAt;
  entry.baseCount = server.turns.length;
  setState(entry, { turns });
  writeLocal(entry);
}

/** Take in the new turns of other pages' unsaved copies of this account
    (another tab, a tab closed while its saves failed). True when turns came in. */
function absorb(entry: Entry): boolean {
  const account = entry.account;
  if (entry.mode !== "append" || !account || !entry.state.hydrated || entry.pendingClear) return false;
  let turns = entry.state.turns;
  for (const found of copiesOf(keyOf(entry.notebookId, entry.place))) {
    if (found.own || !isMine(found, account)) continue;
    const seen = entry.adopted.find((a) => a.name === found.name);
    if (seen?.at === found.copy.at) continue;
    // A copy from before turns had ids waits for the next load's merge.
    const extra = found.copy.turns.slice(found.copy.baseCount ?? 0).filter((turn) => turn.id);
    turns = appendNew(turns, extra);
    entry.adopted = [...entry.adopted.filter((a) => a.name !== found.name), { name: found.name, at: found.copy.at }];
  }
  if (turns === entry.state.turns) return false;
  entry.version += 1;
  setState(entry, { turns });
  writeLocal(entry);
  return true;
}

async function save(entry: Entry) {
  entry.timer = null;
  if (entry.inflight) {
    schedule(entry);
    return;
  }
  absorb(entry);
  const version = entry.version;
  const turns = entry.state.turns;
  const adopted = entry.adopted;
  const key = keyOf(entry.notebookId, entry.place);
  entry.inflight = true;
  try {
    if (turns.length > TURNS_MAX) throw new Error("too long");
    const res =
      turns.length === 0
        ? await fetch("/api/assistant/kept", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ notebookId: entry.notebookId, place: entry.place }),
            // A Clear committed as the page closes still goes.
            keepalive: true,
          })
        : await fetch("/api/assistant/kept", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              notebookId: entry.notebookId,
              place: entry.place,
              base: entry.base,
              turns: wire(turns),
            }),
          });
    if (res.status === 409) {
      // The row changed since this browser read it: merge, then save again.
      await resync(entry);
      entry.retry = Math.min(entry.retry + 1, 6);
      schedule(entry, entry.retry > 2 ? 1000 * 2 ** entry.retry : 0);
      return;
    }
    // Refused for good (no access, signed out, a body the route refuses):
    // the local copy stays, so nothing is lost; the next change tries again.
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json().catch(() => null)) as { updatedAt?: string | null } | null;
    entry.base = turns.length === 0 ? null : (json?.updatedAt ?? null);
    entry.baseCount = turns.length;
    entry.confirmed = Math.max(entry.confirmed, version);
    entry.retry = 0;
    if (entry.version === version) dropLocal(ownName(key));
    else writeLocal(entry);
    // The other pages' turns this save carried are on the server now.
    for (const a of adopted) dropAdopted(a);
    entry.adopted = entry.adopted.filter((a) => !adopted.includes(a));
  } catch {
    // Offline: the local copy holds the turns; try again with a backoff,
    // and at once when the browser is back online.
    entry.retry = Math.min(entry.retry + 1, 6);
    if (entry.version === version && !entry.timer) {
      entry.timer = setTimeout(() => void save(entry), 1000 * 2 ** entry.retry);
    }
  } finally {
    entry.inflight = false;
  }
}

function schedule(entry: Entry, delay = SAVE_DELAY_MS) {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => void save(entry), delay);
}

function change(entry: Entry, turns: KeptTurn[], delay = SAVE_DELAY_MS) {
  entry.version += 1;
  setState(entry, { turns: withIds(turns) });
  writeLocal(entry);
  // Before the server copy is read, a save would overwrite it: hydrate()
  // saves once it has decided which copy wins.
  if (entry.state.hydrated) schedule(entry, delay);
}

async function hydrate(entry: Entry) {
  const key = keyOf(entry.notebookId, entry.place);
  try {
    const server = await readServer(entry);
    const account = server.account;
    entry.account = account;
    // What this browser holds that the server never confirmed, merged onto
    // the server's copy, oldest first: every unsaved copy of this account
    // (this page's turns typed before the load answered, a closed tab's, an
    // earlier page's). The first copy built on the server's copy as it
    // stands holds the whole conversation (a change or a clear there too);
    // every other copy adds its new turns. Another account's copy stays
    // where it is, for that account.
    const mine = copiesOf(key).filter((found) => isMine(found, account));
    let turns = server.turns;
    let whole = false;
    for (const { copy } of mine) {
      if (!whole && copy.base !== undefined && copy.base === server.updatedAt) {
        turns = copy.turns;
        whole = true;
      } else {
        turns = merge(entry.mode, turns, copy.turns, copy.baseCount ?? 0);
      }
    }
    const changedHere = entry.version > 0;
    if (changedHere) turns = merge(entry.mode, turns, entry.state.turns, entry.baseCount);
    entry.base = server.updatedAt;
    entry.baseCount = server.turns.length;
    entry.adopted = mine.filter((found) => !found.own).map((found) => ({ name: found.name, at: found.copy.at }));
    setState(entry, { turns: withIds(turns), hydrated: true });
    if (changedHere || mine.length > 0) {
      writeLocal(entry);
      schedule(entry, 0);
    }
  } catch {
    // Offline or refused: what this browser holds for the account signed in
    // on this tab stands (another account's copy never shows), with the base
    // the newest copy was built on, so the save that follows merges with the
    // server's copy instead of replacing it.
    const mine = copiesOf(key).filter((found) => isMine(found, tabSignedIn() ?? USER_ID));
    const newest = mine[mine.length - 1]?.copy;
    if (newest && entry.version === 0) {
      let turns = newest.turns;
      if (entry.mode === "append") {
        for (const { copy } of mine.slice(0, -1)) turns = appendNew(turns, copy.turns.slice(copy.baseCount ?? 0), true);
      }
      entry.base = newest.base ?? null;
      entry.baseCount = newest.baseCount ?? 0;
      entry.adopted = mine.filter((found) => !found.own).map((found) => ({ name: found.name, at: found.copy.at }));
      setState(entry, { turns: withIds(turns) });
    }
    setState(entry, { hydrated: true });
    if (entry.version > 0 || newest) schedule(entry, 2000);
  }
}

/** Show what other tabs and devices saved, when nothing here waits to save:
    another tab's copy changed, the tab came back into view, or the surface
    opened again. A change waiting here merges on its own save (409). */
function refresh(entry: Entry) {
  if (!entry.state.hydrated || entry.listeners.size === 0) return;
  if (entry.refreshTimer) clearTimeout(entry.refreshTimer);
  entry.refreshTimer = setTimeout(() => {
    entry.refreshTimer = null;
    if (entry.state.busy || entry.pendingClear) return;
    if (absorb(entry)) {
      schedule(entry, 0);
      return;
    }
    const quiet = () =>
      !entry.timer && !entry.inflight && !entry.state.busy && !entry.pendingClear && entry.version === entry.confirmed;
    if (!quiet()) return;
    const version = entry.version;
    void readServer(entry)
      .then((server) => {
        if (!quiet() || entry.version !== version || server.updatedAt === entry.base) return;
        entry.account = server.account;
        entry.base = server.updatedAt;
        entry.baseCount = server.turns.length;
        setState(entry, { turns: server.turns });
      })
      .catch(() => {
        // Offline: what is on screen stands.
      });
  }, 300);
}

function entryFor(notebookId: string, place: string, mode: KeptMode): Entry {
  const key = keyOf(notebookId, place);
  let entry = entries.get(key);
  if (!entry) {
    entry = {
      notebookId,
      place,
      mode,
      state: EMPTY,
      listeners: new Set(),
      version: 0,
      confirmed: 0,
      timer: null,
      retry: 0,
      inflight: false,
      abort: null,
      account: null,
      base: null,
      baseCount: 0,
      adopted: [],
      pendingClear: null,
      refreshTimer: null,
    };
    entries.set(key, entry);
    if (typeof window !== "undefined") void hydrate(entry);
  }
  return entry;
}

if (typeof window !== "undefined") {
  // Back online: every conversation with an unconfirmed change saves now.
  window.addEventListener("online", () => {
    for (const entry of entries.values()) {
      if (entry.version > entry.confirmed && entry.state.hydrated) schedule(entry, 0);
    }
  });
  // Another tab's copy of a place changed (a turn, or its save landed).
  window.addEventListener("storage", (event) => {
    if (!event.key?.startsWith(LOCAL_PREFIX)) return;
    const name = event.key.slice(LOCAL_PREFIX.length);
    for (const entry of entries.values()) {
      const key = keyOf(entry.notebookId, entry.place);
      if (name === key || name.startsWith(`${key}|`)) refresh(entry);
    }
  });
}
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    for (const entry of entries.values()) refresh(entry);
  });
}

function stopRun(entry: Entry) {
  entry.abort?.abort();
  entry.abort = null;
  setState(entry, { busy: false });
}

/** Clear (SPEC.md §21): the turns leave at once and the Undo pill shows;
    Undo puts them back; the row is deleted when the pill goes without Undo
    (its 12 s, ✕, the next delete, the page closing). A turn sent while the
    pill shows starts the conversation again: its save replaces the row. */
function clearEntry(entry: Entry) {
  stopRun(entry);
  const turns = entry.state.turns;
  if (turns.length === 0) return;
  const token = {};
  const version = entry.version;
  const baseCount = entry.baseCount;
  entry.pendingClear = token;
  // Every turn after this point is new to the server's copy.
  entry.baseCount = 0;
  setState(entry, { turns: [] });
  postUndoPill({
    message: translate(clientLang(), "common.conversationCleared"),
    undo: () => {
      if (entry.pendingClear !== token) return;
      entry.pendingClear = null;
      if (entry.version === version) {
        entry.baseCount = baseCount;
        setState(entry, { turns });
      } else {
        change(entry, [...turns, ...entry.state.turns]);
      }
    },
    commit: () => {
      if (entry.pendingClear !== token) return;
      entry.pendingClear = null;
      if (entry.version === version) change(entry, [], 0);
    },
  });
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
export function useKeptChat<T extends KeptTurn>(
  notebookId: string | null,
  place: string | null,
  mode: KeptMode = "append",
) {
  const entry = useMemo(
    () => (notebookId && place && typeof window !== "undefined" ? entryFor(notebookId, place, mode) : null),
    [notebookId, place, mode],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!entry) return noop();
      entry.listeners.add(listener);
      // The surface opens again: show what other tabs saved meanwhile.
      if (entry.listeners.size === 1) refresh(entry);
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
  /** Clear conversation: the turns go at once and the Undo pill shows;
      the server's copy goes when the pill goes without Undo. */
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
// sent, so leaving the page or a reload never loses them. With sign-in on
// they are kept under the account that typed them, so another account
// signed in on the same browser neither sees nor overwrites them. Words
// kept before the account was named go to the first account that reads them.
const DRAFT_PREFIX = "unitos-kept-chat-draft:";

function draftName(key: string): string {
  const account = tabSignedIn();
  return account ? `${DRAFT_PREFIX}${account}|${key}` : DRAFT_PREFIX + key;
}

export function readChatDraft(key: string): string {
  try {
    const name = draftName(key);
    const text = localStorage.getItem(name);
    if (text) return text;
    const unnamed = name === DRAFT_PREFIX + key ? null : localStorage.getItem(DRAFT_PREFIX + key);
    if (!unnamed) return "";
    localStorage.setItem(name, unnamed);
    localStorage.removeItem(DRAFT_PREFIX + key);
    return unnamed;
  } catch {
    return "";
  }
}

export function writeChatDraft(key: string, text: string) {
  try {
    const name = draftName(key);
    if (text) localStorage.setItem(name, text);
    else localStorage.removeItem(name);
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

/** The store at one place without React, for scripts and checks
    (scripts/qa/kept-chat-check.mts). */
export function keptStore(notebookId: string, place: string, mode: KeptMode = "append") {
  const entry = entryFor(notebookId, place, mode);
  return {
    turns: () => entry.state.turns,
    hydrated: () => entry.state.hydrated,
    setTurns: (update: (turns: KeptTurn[]) => KeptTurn[]) => change(entry, update(entry.state.turns)),
    clear: () => clearEntry(entry),
    /** A surface shows the conversation: it follows other tabs' turns. */
    open: () => {
      entry.listeners.add(noopListener);
      refresh(entry);
    },
  };
}

function noopListener() {}
