"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  attachmentKind,
  capFileName,
  capFileText,
  FILE_ACCEPT,
  FILE_MAX_BYTES,
  MAX_FILES_PER_MESSAGE,
  MAX_IMAGES_PER_MESSAGE,
  MEDIA_MAX_BYTES,
  TURN_MAX_CHARS,
  type ConversationTurn,
} from "@/lib/assistant/attachments";
import { splitStreamError, splitStreamPlan } from "@/lib/derive/config";
import type { DriveConfig } from "@/lib/drive/config";
import { pickDriveFiles } from "@/lib/drive/picker-client";
import { DRIVE_ASSISTANT_MIME_TYPES, type DrivePickedFile } from "@/lib/drive/types";
import { useImeGuard } from "@/lib/ime";
import { imageUrl, refuseImage, uploadImage } from "@/lib/images";
import type { Person } from "@/lib/person";
import type { AssistantAction, SummaryDepth, SummaryLevels } from "@/lib/types";
import { UPLOAD_CHUNK_BYTES } from "@/lib/video/types";
import {
  ANSWER_MARK,
  AnswerTint,
  AnswerToolbar,
  CommentBox,
  CommentList,
  QuoteChip,
  quoteMessage,
  SideChatChips,
  SideChatHeader,
  useAnswerSelection,
  type AnswerComment,
} from "@/components/assistant/answer-tools";
import { ThinkingChips, useThinking } from "@/components/assistant/thinking-chips";
import { queuedKey } from "@/components/assistant/queued-list";
import {
  hasSuggestRun,
  SUGGEST_EVENT,
  SuggestionRow,
  type SuggestRequest,
} from "@/components/assistant/suggestion-row";
import { pageEditorIn } from "@/components/docs/layer/anchor";
import { NEW_GLOW_CLASS, NewPill, useNewFeature } from "@/components/new-feature";
import { useWeb, WebChip } from "@/components/assistant/web-chip";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import Link from "next/link";
import {
  ChevronLeftIcon,
  DriveIcon,
  HistoryIcon,
  PaperclipIcon,
  PlusIcon,
  StopIcon,
  TrashIcon,
} from "@/components/icons";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { Markdown } from "@/components/markdown";
import { SaveAsNote } from "@/components/assistant/save-as-note";
import { splitActionsFence } from "@/lib/assistant/fence";
import { RatingButtons } from "@/components/rating-buttons";
import { LoadingDots, ThinkingIndicator } from "@/components/thinking";
import { VoiceTypingButton } from "@/components/voice/voice-typing-button";
import { deleteConversationWithUndo } from "@/components/assistant/conversation-delete";
import { callFailure, callLine, failureLine, modelFetch, noReason } from "@/components/assistant/failure";
import { SEND_CLASS } from "@/components/assistant/decision-classes";
import { KeptTextarea } from "@/components/kept-field";
import { AnswerMarkdown } from "@/components/assistant/answer-markdown";

type Scope = "document" | "notebook";
type Task = "contradictions" | "gaps" | "unsourced";
type Issue = { noteIds: string[]; issue: string; explanation: string };
type SuggestAction = Extract<AssistantAction, { type: "suggest" }>;

/** The paragraph the caret stands in on a document's open page. */
function caretBlockIn(documentId: string): string | undefined {
  const editor = pageEditorIn(document.querySelector(`[data-reader-root][data-document-id="${documentId}"]`));
  const id: unknown = editor?.state.selection.$from.parent.attrs.blockId;
  return typeof id === "string" && id ? id : undefined;
}

// One attachment of a message (SPEC.md §7): an image stored through
// POST /api/images, or a file read to text. `pending` while it is still
// being read; a pending one cannot be sent.
type Attachment =
  | { key: string; kind: "image"; name: string; id: string; url: string; pending?: false }
  | { key: string; kind: "file"; name: string; text: string; pending?: false }
  | { key: string; kind: "pending"; name: string; pending: true };

// One turn of the conversation as the panel holds it: the reader's message
// with what it attached, or the assistant's answer. A restored turn's files
// carry no text — the model already read it when the turn was first sent;
// only a turn built fresh from the composer's own attachments has it.
type Turn = {
  role: "user" | "assistant";
  content: string;
  images?: { id: string; url: string; name: string }[];
  files?: { name: string; text?: string }[];
  // The plan the answer came with (SPEC.md §7, This page scope): the actions
  // the reader approves in the plan card, and the warnings for the ones the
  // server dropped. Not saved: the conversation keeps the answer alone.
  plan?: { actions: AssistantAction[]; warnings: string[] };
  // The run of the assistant's suggestions the answer asked for (SPEC.md
  // §29), by its key: the row under the answer follows it. Not saved.
  suggest?: string;
};
const plural = (n: number) => (n === 1 ? "" : "s");
// An answer as the next message's history reads it: with the actions it
// proposed named, so a later "implement" reads which change it confirms.
const withProposed = (turn: Turn): string => {
  const proposed = [
    ...(turn.plan?.actions.map((a) => a.description) ?? []),
    ...(turn.suggest ? ["suggestions on the page"] : []),
  ].filter(Boolean);
  return proposed.length > 0 ? `${turn.content}\n\nProposed actions: ${proposed.join("; ")}` : turn.content;
};
// One side chat of this conversation (SPEC.md §7): the quote it was started
// from and its own turns. noteId = the note it saves on, null until the
// first answer lands; key holds it together before then.
// base: the note's updatedAt the turns were built on, and baseCount: how
// many turns the note held then (saveConversationNow merges by them).
type SideChat = {
  key: string;
  noteId: string | null;
  quote: string;
  turns: Turn[];
  base?: string | null;
  baseCount?: number;
};
type Thread = {
  turns: Turn[];
  conversationNoteId: string | null;
  // The conversation note's copy the turns were built on (see SideChat).
  base: string | null;
  baseCount: number;
  sideChats: SideChat[];
  // The side chat on screen, by key; null = the conversation itself.
  openKey: string | null;
};
// One conversation of the conversations list (SPEC.md §7): its title (the
// note's gist, else the first message's words), when it last changed, and
// how many messages it holds.
type ConversationEntry = { id: string; title: string; updatedAt: string; turns: number };

// A turn as the conversation route stores it (lib/assistant/attachments.ts),
// and the conversation it answers: the turns, and the side chats with theirs.
type StoredTurn = {
  role: "user" | "assistant";
  content: string;
  images?: { id: string; name: string }[];
  files?: { name: string }[];
};
type StoredConversation = {
  conversationNoteId?: string | null;
  turns?: StoredTurn[];
  updatedAt?: string | null;
  sideChats?: { id: string; quote: string; turns: StoredTurn[]; updatedAt?: string }[];
};
const toTurns = (stored: StoredTurn[]): Turn[] =>
  stored.map((turn) => ({
    role: turn.role,
    content: turn.content,
    images: turn.images?.map((img) => ({ id: img.id, name: img.name, url: imageUrl(img.id) })),
    files: turn.files,
  }));
const toSideChats = (stored: NonNullable<StoredConversation["sideChats"]>): SideChat[] =>
  stored.map((s) => ({
    key: s.id,
    noteId: s.id,
    quote: s.quote,
    turns: toTurns(s.turns),
    base: s.updatedAt ?? null,
    baseCount: s.turns.length,
  }));

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// One message as it is sent: the text and the attachments read for it.
// key: the message's own, for the queue and the held draft; question and
// quote: the box's words and the quote chip as typed, so a failed message
// goes back into the composer as it was.
type OutgoingMessage = {
  key: string;
  content: string;
  question: string;
  quote: string | null;
  images: { id: string; url: string; name: string }[];
  files: { name: string; text: string }[];
};
// A message queued while an answer runs (SPEC.md §7): it sends, in order,
// once the answer lands. The key removes it from the queue.
type QueuedMessage = OutgoingMessage;

// The conversation survives a tab switch, a document switch, and leaving the
// page within the same tab (each remounts the panel, so the thread lives
// outside it, per project, for the page's life) and a reload (it is saved,
// SPEC.md §21: one note per reader per project, loaded once per project per
// tab — see the hydration effect below). The panel's refs read and write the
// shared thread, so an answer that lands after the panel closed still lands
// in it, and a panel open on the project shows it (the listeners).
type SharedThread = Thread & {
  // Read from the server, or started here: no load needed.
  loaded: boolean;
  listeners: Set<() => void>;
  // The saves in order, so the second never starts a second note.
  saving: Promise<void>;
  // Counts the conversations shown (showConversation): a save started on
  // one never lands on the next.
  shown: number;
};
const threads = new Map<string, SharedThread>();
function sharedThread(notebookId: string): SharedThread {
  let thread = threads.get(notebookId);
  if (!thread) {
    thread = {
      turns: [],
      conversationNoteId: null,
      base: null,
      baseCount: 0,
      sideChats: [],
      openKey: null,
      loaded: false,
      listeners: new Set(),
      saving: Promise.resolve(),
      shown: 0,
    };
    threads.set(notebookId, thread);
  }
  return thread;
}
/** A ref onto one field of the shared thread. */
function sharedRef<K extends keyof Thread>(shared: SharedThread, key: K): { current: Thread[K] } {
  const thread: Thread = shared;
  return {
    get current() {
      return thread[key];
    },
    set current(value: Thread[K]) {
      thread[key] = value;
    },
  };
}

// The composer's words (SPEC.md §7, CLAUDE.md rule zero 6), one draft per
// project in localStorage: the words in the box, and each message sent or
// queued that the server has not yet confirmed (held). A reload, a crash, a
// tab or document switch, or New conversation keeps them; a failed answer
// puts its message back in the box; only a saved answer clears it.
const PANEL_DRAFT_PREFIX = "unitos-assistant-panel-draft:";
type HeldMessage = { key: string; content: string };
type PanelDraft = { text: string; held: HeldMessage[] };
function readPanelDraft(notebookId: string): PanelDraft {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PANEL_DRAFT_PREFIX + notebookId) ?? "null");
    if (!parsed || typeof parsed !== "object") return { text: "", held: [] };
    const d = parsed as { text?: unknown; held?: unknown };
    const held = Array.isArray(d.held)
      ? d.held.filter(
          (h): h is HeldMessage =>
            !!h &&
            typeof h === "object" &&
            typeof (h as HeldMessage).key === "string" &&
            typeof (h as HeldMessage).content === "string",
        )
      : [];
    return { text: typeof d.text === "string" ? d.text : "", held };
  } catch {
    return { text: "", held: [] };
  }
}
function writePanelDraft(notebookId: string, draft: PanelDraft) {
  try {
    if (!draft.text.trim() && draft.held.length === 0) localStorage.removeItem(PANEL_DRAFT_PREFIX + notebookId);
    else localStorage.setItem(PANEL_DRAFT_PREFIX + notebookId, JSON.stringify(draft));
  } catch {
    // Storage blocked or full: the box still holds the words on screen.
  }
}
// Per project, for the page's life: the messages this tab sent and the
// server has not confirmed. A panel that remounts mid-answer (a tab or a
// document switch) finds them here and does not put them back in its box.
const heldMessages = new Map<string, HeldMessage[]>();
// The mounted panel's way to put a failed message back in its box; a
// message that fails while no panel is mounted waits in pendingRestore.
const liveRestore = new Map<string, (message: OutgoingMessage) => void>();
const pendingRestore = new Map<string, OutgoingMessage[]>();
// The words in the mounted panel's box, per project: what the draft writes.
const boxText = new Map<string, string>();
function writeDraftNow(notebookId: string) {
  writePanelDraft(notebookId, { text: boxText.get(notebookId) ?? "", held: heldMessages.get(notebookId) ?? [] });
}
function holdMessage(notebookId: string, message: OutgoingMessage) {
  const held = (heldMessages.get(notebookId) ?? []).filter((h) => h.key !== message.key);
  heldMessages.set(notebookId, [...held, { key: message.key, content: message.content }]);
  writeDraftNow(notebookId);
}
function releaseMessage(notebookId: string, key: string) {
  heldMessages.set(notebookId, (heldMessages.get(notebookId) ?? []).filter((h) => h.key !== key));
  writeDraftNow(notebookId);
}
// A message that did not land goes back into the box: the mounted panel's
// now, else the next panel's when it mounts (it stays held until then).
function putBack(notebookId: string, message: OutgoingMessage) {
  const restore = liveRestore.get(notebookId);
  if (!restore) {
    pendingRestore.set(notebookId, [...(pendingRestore.get(notebookId) ?? []), message]);
    return;
  }
  restore(message);
  releaseMessage(notebookId, message.key);
}
// The box's words when a panel mounts: this tab's, else the stored draft's,
// with the messages a closed tab never had confirmed put back in front.
function initialBoxText(notebookId: string): string {
  if (typeof window === "undefined") return "";
  const kept = boxText.get(notebookId);
  if (kept !== undefined) return kept;
  const draft = readPanelDraft(notebookId);
  const text = [...draft.held.map((h) => h.content), draft.text].filter((s) => s.trim()).join("\n\n");
  boxText.set(notebookId, text);
  heldMessages.set(notebookId, []);
  writeDraftNow(notebookId);
  return text;
}


// Two scopes, both reading the digest (SPEC.md §7). Scope ids stay as wire
// values: document = This page (the open document whole), notebook = Project
// (this project whole). Tables hold dictionary keys, translated at render.
const SCOPES: { id: Scope; labelKey: TKey; hintKey: TKey }[] = [
  { id: "document", labelKey: "assistant.scopeDocumentLabel", hintKey: "assistant.scopeDocumentHint" },
  { id: "notebook", labelKey: "assistant.scopeProjectLabel", hintKey: "assistant.scopeProjectHint" },
];

// Recommended functions for the open document, in this order.
const RECOMMENDED: { depth: SummaryDepth; labelKey: TKey; hintKey: TKey }[] = [
  { depth: "layman", labelKey: "assistant.recLaymanLabel", hintKey: "assistant.recLaymanHint" },
  {
    depth: "professional",
    labelKey: "assistant.recProfessionalLabel",
    hintKey: "assistant.recProfessionalHint",
  },
];

// Task wire values with their button labels and the noun inside noTaskFound.
const TASK_LABEL: Record<Task, TKey> = {
  contradictions: "assistant.taskContradictions",
  gaps: "assistant.taskGaps",
  unsourced: "assistant.taskUnsourced",
};
const TASK_TITLE: Record<Task, TKey> = {
  contradictions: "assistant.taskContradictionsTitle",
  gaps: "assistant.taskGapsTitle",
  unsourced: "assistant.taskUnsourcedTitle",
};
const TASK_NOUN: Record<Task, TKey> = {
  contradictions: "assistant.taskNounContradictions",
  gaps: "assistant.taskNounGaps",
  unsourced: "assistant.taskNounUnsourced",
};

// A PDF becomes text on the server (POST /api/assistant/attach); the text
// rides in the message. Throws with the server's plain reason.
async function attachToText(file: File, t: TFunc): Promise<string> {
  const res = await fetch("/api/assistant/attach", {
    method: "POST",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  const json = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || typeof json?.text !== "string") throw callFailure(res, json, t("common.notLoaded"));
  return json.text;
}

// A video or audio file becomes its transcript on the server (SPEC.md §7).
// The bytes stage in chunks first, the upload's own path (a request body caps
// at about 4.5 MB), then POST /api/assistant/attach-media transcribes them.
// Throws with the server's plain reason.
async function attachMediaToText(file: File, t: TFunc): Promise<string> {
  const uploadId = crypto.randomUUID();
  for (let sent = 0; sent < file.size; sent += UPLOAD_CHUNK_BYTES) {
    const index = Math.floor(sent / UPLOAD_CHUNK_BYTES);
    const res = await fetch(`/api/uploads?uploadId=${uploadId}&index=${index}`, {
      method: "POST",
      body: file.slice(sent, sent + UPLOAD_CHUNK_BYTES),
    });
    if (!res.ok) throw callFailure(res, await res.json().catch(() => null), t("common.notLoaded"));
  }
  const res = await fetch("/api/assistant/attach-media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, name: capFileName(file.name), mimeType: file.type || undefined }),
  });
  const json = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || typeof json?.text !== "string") throw callFailure(res, json, t("common.notLoaded"));
  return json.text;
}

// A Google Drive file becomes an attachment on the server (SPEC.md §7, §14):
// text for a Doc, Sheet, Slide, Drawing, PDF, or text file, a transcript for
// video or audio, a stored image for an image. Throws with the server's
// plain reason.
type DriveAttached =
  | { kind: "file"; name: string; text: string }
  | { kind: "image"; name: string; id: string; url: string };
async function attachDriveFile(file: DrivePickedFile, token: string, t: TFunc): Promise<DriveAttached> {
  const res = await fetch("/api/assistant/attach-drive", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ fileId: file.id, name: file.name, mimeType: file.mimeType }),
  });
  const json = (await res.json().catch(() => null)) as (DriveAttached & { error?: string }) | null;
  if (!res.ok || !json || (json.kind !== "file" && json.kind !== "image")) throw callFailure(res, json, t("common.notLoaded"));
  return json;
}

function hasFiles(e: React.DragEvent): boolean {
  return e.dataTransfer?.types.includes("Files") ?? false;
}

// One assistant panel with the Recommended functions and a scope control (SPEC.md §7).
// The first question turns it into a conversation: the turns in a thread
// that scrolls, the composer at the foot, images and files attachable.
export function AssistantPanel({
  notebookId,
  documentId,
  summaries,
  drive,
}: {
  notebookId: string;
  documentId: string | null;
  summaries: SummaryLevels;
  // Google Drive (SPEC.md §14); null = not configured, no Drive button.
  drive: DriveConfig | null;
}) {
  const router = useRouter();
  const t = useT();
  const ime = useImeGuard();
  const { premium, myId, people } = useCollab();
  // This page while a document is open, else Project: the panel remounts on
  // every document switch, so the default follows the open document.
  const [scope, setScope] = useState<Scope>(documentId ? "document" : "notebook");
  // Web access (SPEC.md §7): the one toggle every surface shares (web-chip.tsx).
  const web = useWeb();
  // Fast Thinking or Deep Thinking (SPEC.md §7): one choice for every
  // assistant surface, remembered in this browser.
  const thinking = useThinking();
  // The box's words: kept as a draft (initialBoxText above).
  const [question, setQuestion] = useState(() => initialBoxText(notebookId));
  // The conversation (SPEC.md §7, §21): the first question opens it; every
  // turn after continues it. Empty = the panel's first layout. The note it
  // is saved on, once a turn has persisted; null until then, and again once
  // New conversation clears it.
  const shared = useMemo(() => sharedThread(notebookId), [notebookId]);
  const [turns, setTurnsState] = useState<Turn[]>(() => shared.turns);
  const [conversationNoteId, setConversationNoteId] = useState<string | null>(
    () => shared.conversationNoteId,
  );
  // The side chats of this conversation, and the one on screen (SPEC.md §7).
  const [sideChats, setSideChatsState] = useState<SideChat[]>(() => shared.sideChats);
  const [openKey, setOpenKeyState] = useState<string | null>(() => shared.openKey);
  const [hydrated, setHydrated] = useState(() => shared.loaded);
  // The conversations list (SPEC.md §7): this reader's conversations of the
  // project, read when the list opens; null until then.
  const [listOpen, setListOpen] = useState(false);
  const [conversations, setConversations] = useState<ConversationEntry[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // The thread as the running send() reads it: state is stale inside its own
  // closure, and a queued message sends from there.
  // They read and write the shared thread, so a run that outlives this panel
  // still writes where the next panel reads.
  const turnsRef = useMemo(() => sharedRef(shared, "turns"), [shared]);
  const sideChatsRef = useMemo(() => sharedRef(shared, "sideChats"), [shared]);
  const openKeyRef = useMemo(() => sharedRef(shared, "openKey"), [shared]);
  const noteIdRef = useMemo(() => sharedRef(shared, "conversationNoteId"), [shared]);
  const baseRef = useMemo(() => sharedRef(shared, "base"), [shared]);
  const baseCountRef = useMemo(() => sharedRef(shared, "baseCount"), [shared]);
  // The refs changed: every panel open on this project draws them.
  function cacheThread() {
    shared.loaded = true;
    for (const listener of shared.listeners) listener();
  }
  useEffect(() => {
    const listener = () => {
      setTurnsState(shared.turns);
      setSideChatsState(shared.sideChats);
      setOpenKeyState(shared.openKey);
      setConversationNoteId(shared.conversationNoteId);
      setHydrated(true);
    };
    shared.listeners.add(listener);
    // What changed between the first render and now.
    if (shared.loaded) listener();
    return () => {
      shared.listeners.delete(listener);
    };
  }, [shared]);
  function setSideChats(update: (list: SideChat[]) => SideChat[]) {
    sideChatsRef.current = update(sideChatsRef.current);
    setSideChatsState(sideChatsRef.current);
    cacheThread();
  }
  function setOpenKey(key: string | null) {
    openKeyRef.current = key;
    setOpenKeyState(key);
    cacheThread();
  }
  function setNoteId(id: string | null) {
    noteIdRef.current = id;
    setConversationNoteId(id);
    cacheThread();
  }
  // The open thread: the side chat on screen, or the conversation itself.
  const openSideChat = sideChats.find((s) => s.key === openKey) ?? null;
  const activeTurns = openSideChat ? openSideChat.turns : turns;
  // The note the open thread saves on: what a comment is written under.
  const activeNoteId = openSideChat ? openSideChat.noteId : conversationNoteId;
  // Highlighting an answer (SPEC.md §7): the quote the next message carries,
  // the quote a comment is being written on, and this thread's comments.
  const { selection, tintRects, hold: holdSelection, clear: clearSelection } = useAnswerSelection();
  const [quote, setQuote] = useState<string | null>(null);
  // The quote as a message that comes back reads it (restoreMessage).
  const quoteRef = useRef<string | null>(null);
  useEffect(() => {
    quoteRef.current = quote;
  }, [quote]);
  const [commentQuote, setCommentQuote] = useState<string | null>(null);
  const [comments, setComments] = useState<AnswerComment[]>([]);
  const [commentPeople, setCommentPeople] = useState<Record<string, Person>>({});
  const [commentBusy, setCommentBusy] = useState(false);
  /** Update the thread on screen — the side chat's turns, or the conversation's. */
  function setTurns(update: (turns: Turn[]) => Turn[]) {
    if (openKeyRef.current) {
      const key = openKeyRef.current;
      setSideChats((list) =>
        list.map((s) => (s.key === key ? { ...s, turns: update(s.turns) } : s)),
      );
      return;
    }
    turnsRef.current = update(turnsRef.current);
    setTurnsState(turnsRef.current);
    cacheThread();
  }
  // The panel is keyed by document, so it remounts on every document switch;
  // the thread cache (keyed by project) means this only actually fetches the
  // first time this project's conversation is shown in this browser tab.
  useEffect(() => {
    if (shared.loaded) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/assistant/conversation?notebookId=${encodeURIComponent(notebookId)}`);
        const json = (await res.json().catch(() => null)) as StoredConversation | null;
        // A message sent while the load ran started the thread here: it stands.
        if (cancelled || !res.ok || !json || shared.loaded) return;
        const loaded = toTurns(json.turns ?? []);
        const loadedSideChats = toSideChats(json.sideChats ?? []);
        turnsRef.current = loaded;
        sideChatsRef.current = loadedSideChats;
        noteIdRef.current = json.conversationNoteId ?? null;
        baseRef.current = json.updatedAt ?? null;
        baseCountRef.current = loaded.length;
        openKeyRef.current = null;
        cacheThread();
        setTurnsState(loaded);
        setSideChatsState(loadedSideChats);
        setConversationNoteId(json.conversationNoteId ?? null);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // One load per project per tab: cacheThread writes the refs it is given,
    // so it never needs to re-run this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  // Messages sent while an answer runs wait here and go out in order once it
  // lands (SPEC.md §7). The ref mirrors the state for the drain at the end of
  // a run, which reads the queue as it is then, not as it was when the run
  // started.
  const [queue, setQueueState] = useState<QueuedMessage[]>([]);
  const queueRef = useRef<QueuedMessage[]>([]);
  function setQueue(update: (list: QueuedMessage[]) => QueuedMessage[]) {
    queueRef.current = update(queueRef.current);
    setQueueState(queueRef.current);
  }
  // Whether a run is on, as the drain reads it: the state is stale inside
  // the run's own closure.
  const busyRef = useRef(false);
  // The draft (PANEL_DRAFT_PREFIX above): written at most every 300 ms
  // while the reader types, and at once when the page closes or the panel
  // goes.
  const draftTimer = useRef<number | null>(null);
  useEffect(() => {
    boxText.set(notebookId, question);
    if (draftTimer.current !== null) return;
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = null;
      writeDraftNow(notebookId);
    }, 300);
  }, [notebookId, question]);
  useEffect(() => {
    const flush = () => writeDraftNow(notebookId);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      if (draftTimer.current !== null) window.clearTimeout(draftTimer.current);
      draftTimer.current = null;
      flush();
    };
  }, [notebookId]);
  // A message that did not land comes back as it was typed: its words after
  // whatever the box holds now, its quote chip when the box has none, its
  // attachments.
  function restoreMessage(m: OutgoingMessage) {
    const current = boxRef.current?.value ?? boxText.get(notebookId) ?? "";
    const plain = !current.trim() && !quoteRef.current;
    const words = plain ? m.question : m.content;
    const next = current.trim() ? (words.trim() ? `${current}\n\n${words}` : current) : words;
    boxText.set(notebookId, next);
    setQuestion(next);
    if (plain && m.quote) setQuote(m.quote);
    const back: Attachment[] = [
      ...m.images.map((img) => ({ key: `${m.key}-${img.id}`, kind: "image" as const, name: img.name, id: img.id, url: img.url })),
      ...m.files.map((f, i) => ({ key: `${m.key}-f${i}`, kind: "file" as const, name: f.name, text: f.text })),
    ];
    if (back.length > 0) setAttachments((list) => [...list, ...back]);
  }
  useEffect(() => {
    liveRestore.set(notebookId, restoreMessage);
    const waiting = pendingRestore.get(notebookId) ?? [];
    pendingRestore.delete(notebookId);
    for (const m of waiting) {
      restoreMessage(m);
      releaseMessage(notebookId, m.key);
    }
    return () => {
      if (liveRestore.get(notebookId) === restoreMessage) liveRestore.delete(notebookId);
    };
    // One registration per mount: restoreMessage reads refs and setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [taskRun, setTaskRun] = useState<Task | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Recommended output: generated in this session, over the stored initials.
  const [recDepth, setRecDepth] = useState<SummaryDepth | null>(null);
  const [recTexts, setRecTexts] = useState<SummaryLevels>({});
  const [recBusy, setRecBusy] = useState<SummaryDepth | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  // The running ask() or task, so Stop can abort it — whatever streamed in
  // already stays on screen, the read just stops.
  const runAbortRef = useRef<AbortController | null>(null);
  // Whether the thread sticks to its newest turn (the scroll effect below).
  const stickRef = useRef(true);
  function stopRun() {
    runAbortRef.current?.abort();
    runAbortRef.current = null;
    setBusy(false);
  }
  // The running Recommended generation; a stopped one leaves the stored
  // summary, if any, in place.
  const recAbortRef = useRef<AbortController | null>(null);
  function stopRecommended() {
    recAbortRef.current?.abort();
  }

  function reset() {
    setIssues(null);
    setTaskRun(null);
    setError(null);
  }

  // The thread takes a conversation's place: the one from the list, or none
  // (New conversation). What was on screen stays saved, in the list.
  function showConversation(next: {
    noteId: string | null;
    turns: Turn[];
    sideChats: SideChat[];
    base: string | null;
    baseCount: number;
  }) {
    stopRun();
    reset();
    shared.shown += 1;
    turnsRef.current = next.turns;
    baseRef.current = next.base;
    baseCountRef.current = next.baseCount;
    sideChatsRef.current = next.sideChats;
    openKeyRef.current = null;
    noteIdRef.current = next.noteId;
    setTurnsState(next.turns);
    setSideChatsState(next.sideChats);
    setOpenKeyState(null);
    setConversationNoteId(next.noteId);
    setQuote(null);
    setCommentQuote(null);
    setComments([]);
    clearSelection();
    cacheThread();
    // The box keeps its words and its attachments (one draft per project),
    // and the messages queued for the thread on screen go back into it.
    for (const m of queueRef.current) putBack(notebookId, m);
    setQueue(() => []);
    setListOpen(false);
  }

  // New conversation (SPEC.md §7): back to the first layout, an empty thread.
  // The conversation on screen is not deleted: it stays in the list.
  function newConversation() {
    showConversation({ noteId: null, turns: [], sideChats: [], base: null, baseCount: 0 });
  }

  // The conversations list: read every time it opens, so it is current.
  async function loadConversations() {
    setListError(null);
    try {
      const res = await fetch(`/api/assistant/conversation?notebookId=${encodeURIComponent(notebookId)}&list=1`);
      const json = (await res.json().catch(() => null)) as { conversations?: ConversationEntry[]; error?: string } | null;
      if (!res.ok || !json) throw callFailure(res, json, t("common.notLoaded"));
      setConversations(json.conversations ?? []);
    } catch (err) {
      setListError(callLine(err, t("common.notLoaded")));
    }
  }
  function openList() {
    setListOpen(true);
    void loadConversations();
  }

  // Open a conversation from the list: its turns and side chats take the
  // thread's place.
  async function openConversation(id: string) {
    if (id === conversationNoteId) {
      setListOpen(false);
      return;
    }
    setListError(null);
    try {
      const res = await fetch(
        `/api/assistant/conversation?notebookId=${encodeURIComponent(notebookId)}&conversationNoteId=${encodeURIComponent(id)}`,
      );
      const json = (await res.json().catch(() => null)) as (StoredConversation & { error?: string }) | null;
      if (!res.ok || !json?.conversationNoteId) throw callFailure(res, json, t("common.notLoaded"));
      showConversation({
        noteId: json.conversationNoteId,
        turns: toTurns(json.turns ?? []),
        sideChats: toSideChats(json.sideChats ?? []),
        base: json.updatedAt ?? null,
        baseCount: json.turns?.length ?? 0,
      });
    } catch (err) {
      setListError(callLine(err, t("common.notLoaded")));
    }
  }

  // Delete a conversation from the list (SPEC.md §7): no ask; the notes'
  // Undo pill offers Undo, and once it goes the note goes through
  // DELETE /api/notes/:id, its side chats and comments with it, all kept for
  // History's Restore. The open one deleted leaves an empty thread; Undo
  // brings it back.
  function deleteConversation(id: string) {
    setListError(null);
    const wasOpen = id === conversationNoteId;
    const shown = wasOpen
      ? {
          noteId: noteIdRef.current,
          turns: turnsRef.current,
          sideChats: sideChatsRef.current,
          base: baseRef.current,
          baseCount: baseCountRef.current,
        }
      : null;
    deleteConversationWithUndo({
      noteId: id,
      message: t("outline.conversationDeleted"),
      gone: () => {
        setConversations((all) => (all ? all.filter((c) => c.id !== id) : all));
        if (wasOpen) {
          showConversation({ noteId: null, turns: [], sideChats: [], base: null, baseCount: 0 });
          setListOpen(true);
        }
      },
      // Undo: the list reads the server again (the note is still there), and
      // the thread comes back when nothing took its place.
      back: () => {
        void loadConversations();
        if (shown && noteIdRef.current === null && turnsRef.current.length === 0) {
          showConversation(shown);
          setListOpen(true);
        }
      },
      failed: () => setListError(t("assistant.conversationDeleteFailed")),
    });
  }

  // The comments under the open thread, reloaded when the thread changes.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!activeNoteId) {
        setComments([]);
        return;
      }
      try {
        const res = await fetch(`/api/replies?noteId=${encodeURIComponent(activeNoteId)}`);
        const json = (await res.json().catch(() => null)) as {
          replies?: AnswerComment[];
          people?: Record<string, Person>;
        } | null;
        if (cancelled || !res.ok || !json) return;
        setComments(json.replies ?? []);
        setCommentPeople(json.people ?? {});
      } catch {
        // Offline: the thread reads the same, with no comments under it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeNoteId]);

  // The selection's three actions (SPEC.md §7). The browser's own selection
  // goes — the box that opens takes focus — and the words stay marked by the
  // tint until the reader is done with them.
  function takeSelection(): string {
    return holdSelection();
  }
  // Start side chat: a conversation of its own off these words, kept with
  // this conversation and out of assistant history.
  function startSideChat() {
    const text = takeSelection();
    if (!text || !conversationNoteId) return;
    const key = `side-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setSideChats((list) => [...list, { key, noteId: null, quote: text, turns: [] }]);
    setOpenKey(key);
    setQuote(text);
    setCommentQuote(null);
    stickRef.current = true;
    setFocusTick((n) => n + 1);
  }
  // Ask about this: the words ride into the next message of this thread.
  function askAboutThis() {
    const text = takeSelection();
    if (!text) return;
    setQuote(text);
    setCommentQuote(null);
    setFocusTick((n) => n + 1);
  }
  function openComment() {
    const text = takeSelection();
    if (!text || !activeNoteId) return;
    setCommentQuote(text);
  }
  // The words of a comment not yet posted (SPEC.md §6), one per conversation
  // and quote, in localStorage: Escape, Cancel, a closed panel, or a reload
  // keeps them, and only the server's confirmation clears them.
  const commentDraftKey =
    activeNoteId && commentQuote ? `unitos-answer-comment:${activeNoteId}:${commentQuote.slice(0, 200)}` : null;
  function readCommentDraft(key: string | null): string {
    if (!key) return "";
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  }
  function writeCommentDraft(key: string | null, text: string) {
    if (!key) return;
    try {
      if (text.trim()) localStorage.setItem(key, text);
      else localStorage.removeItem(key);
    } catch {
      // Storage blocked: the box still holds the words while it is open.
    }
  }
  async function postComment(text: string) {
    if (!activeNoteId || commentBusy) return;
    const draftKey = commentDraftKey;
    setCommentBusy(true);
    try {
      const res = await fetch("/api/replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          noteId: activeNoteId,
          content: quoteMessage(commentQuote ?? "", text),
        }),
      });
      const json = (await res.json().catch(() => null)) as (AnswerComment & { error?: string }) | null;
      if (!res.ok || !json?.id) throw callFailure(res, json, t("common.notSaved"));
      setComments((list) => [...list, json]);
      writeCommentDraft(draftKey, "");
      setCommentQuote(null);
      clearSelection();
      // The Annotations tab lists the comment under the conversation.
      router.refresh();
    } catch (err) {
      setError(callLine(err, t("common.notSaved")));
    } finally {
      setCommentBusy(false);
    }
  }
  async function deleteComment(id: string) {
    setComments((list) => list.filter((c) => c.id !== id));
    try {
      await fetch(`/api/replies/${id}`, { method: "DELETE" });
    } catch {
      // Offline: the row is gone on screen and stays on the server; the next
      // load of the thread shows it again.
    }
  }

  // A completed turn saves (SPEC.md §21): the first one creates the note,
  // every one after updates it in place. Fire-and-forget — a save that fails
  // costs the reader nothing they would notice this session; the thread
  // stays on screen either way, from the threads cache above.
  // Saves run one after another on the shared thread: the first one's note
  // id is in place before the next one starts, so a conversation is one note.
  // build: the turns to save, read when the save runs (an earlier save may
  // have merged the thread since). The answer says whether this save landed.
  function saveConversation(build: () => Turn[], sideChatKey: string | null): Promise<boolean> {
    const shownAt = shared.shown;
    const run = shared.saving.then(() => saveConversationNow(build, sideChatKey, shownAt));
    shared.saving = run.then(() => undefined);
    return run;
  }
  // The note moved since this tab read it (another tab, another device): the
  // server's turns come first, then this tab's turns past what the base held,
  // on screen and in the save; then the save runs again (SPEC.md §21).
  function mergeThread(
    sideChatKey: string | null,
    server: Turn[],
    base: string | null,
    baseCount: number,
  ) {
    const after = (list: Turn[]) => [...server, ...list.slice(Math.min(baseCount, list.length))];
    if (sideChatKey) {
      setSideChats((list) =>
        list.map((s) =>
          s.key === sideChatKey ? { ...s, turns: after(s.turns), base, baseCount: server.length } : s,
        ),
      );
      return;
    }
    turnsRef.current = after(turnsRef.current);
    baseRef.current = base;
    baseCountRef.current = server.length;
    setTurnsState(turnsRef.current);
    cacheThread();
  }
  async function saveConversationNow(
    build: () => Turn[],
    sideChatKey: string | null,
    shownAt: number,
  ): Promise<boolean> {
    // Another conversation took the screen since: these turns are not its.
    const moved = () => !sideChatKey && shared.shown !== shownAt;
    if (moved()) return false;
    let turnsToSave = build();
    for (let attempt = 0; attempt < 4; attempt++) {
      const side = sideChatKey ? sideChatsRef.current.find((s) => s.key === sideChatKey) : null;
      if (sideChatKey && !side) return false;
      const noteId = side ? side.noteId : noteIdRef.current;
      const base = side ? (side.base ?? null) : baseRef.current;
      const baseCount = side ? (side.baseCount ?? 0) : baseCountRef.current;
      try {
        const res = await fetch("/api/assistant/conversation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notebookId,
            conversationNoteId: noteId,
            base: noteId ? base : null,
            // A side chat belongs to the conversation it was started from.
            sideChatOf: side ? noteIdRef.current : undefined,
            quote: side ? side.quote : undefined,
            turns: turnsToSave.map((turn) => ({
              role: turn.role,
              content: turn.content.slice(0, TURN_MAX_CHARS),
              images: turn.images?.map((img) => ({ id: img.id, name: img.name })),
              files: turn.files?.map((f) => ({ name: f.name })),
            })),
          }),
        });
        const json = (await res.json().catch(() => null)) as {
          conversationNoteId?: string;
          updatedAt?: string;
          turns?: StoredTurn[];
        } | null;
        if (moved()) return false;
        if (res.status === 409 && json?.turns && json.updatedAt) {
          const server = toTurns(json.turns);
          turnsToSave = [...server, ...turnsToSave.slice(Math.min(baseCount, turnsToSave.length))];
          mergeThread(sideChatKey, server, json.updatedAt, baseCount);
          continue;
        }
        if (!res.ok || !json?.conversationNoteId) return false;
        const savedId = json.conversationNoteId;
        const savedBase = json.updatedAt ?? null;
        const savedCount = turnsToSave.length;
        if (side) {
          setSideChats((list) =>
            list.map((s) => (s.key === side.key ? { ...s, noteId: savedId, base: savedBase, baseCount: savedCount } : s)),
          );
          return true;
        }
        baseRef.current = savedBase;
        baseCountRef.current = savedCount;
        setNoteId(savedId);
        return true;
      } catch {
        // Offline, or the request otherwise never landed — the thread is still
        // right here on screen; the next completed turn tries again, and the
        // message stays held in the draft until one lands.
        return false;
      }
    }
    return false;
  }

  // Recommended: open shows what exists; generating streams into the card.
  function openRecommended(depth: SummaryDepth) {
    if (recBusy) return;
    setRecDepth(depth);
    setRecError(null);
    if (!(recTexts[depth] ?? summaries[depth])) void generateRecommended(depth);
  }

  async function generateRecommended(depth: SummaryDepth) {
    if (!documentId || recBusy) return;
    setRecBusy(depth);
    setRecDepth(depth);
    setRecError(null);
    setRecTexts((t) => ({ ...t, [depth]: "" }));
    const controller = new AbortController();
    recAbortRef.current = controller;
    try {
      const res = await modelFetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ type: "SUMMARIZE", documentId, notebookId, depth }),
      }, t);
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? noReason(res, t));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamed = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        streamed += decoder.decode(value, { stream: true });
        const live = splitStreamError(streamed).text;
        setRecTexts((t) => ({ ...t, [depth]: live }));
      }
      // A failure mid-stream arrives in-band; an empty stream is a failure too.
      const { text, error: streamError } = splitStreamError(streamed);
      if (streamError || !text.trim()) {
        throw new Error(streamError ?? t("assistant.emptyResponse"));
      }
      setRecTexts((t) => ({ ...t, [depth]: text }));
      router.refresh();
    } catch (err) {
      setRecTexts((t) => {
        const next = { ...t };
        delete next[depth];
        return next;
      });
      // Stopped, not failed: the card goes back to the stored summary, if any.
      if (controller.signal.aborted) return;
      setRecError(failureLine(err, t));
    } finally {
      if (recAbortRef.current === controller) recAbortRef.current = null;
      setRecBusy(null);
    }
  }

  // Attachments (SPEC.md §7): an image stores and rides as its id; a PDF
  // becomes text through the attach route; a text file is read here. A file
  // the composer does not take, or one over the cap, answers with the reason
  // and is not added.
  async function addFiles(files: File[]) {
    if (busy) return;
    setError(null);
    const images = attachments.filter((a) => a.kind === "image").length;
    const others = attachments.filter((a) => a.kind !== "image").length;
    let imageCount = images;
    let fileCount = others;
    for (const file of files) {
      const kind = attachmentKind(file);
      const name = capFileName(file.name);
      if (!kind) {
        setError(t("assistant.attachmentNotTaken", { name }));
        continue;
      }
      if (kind === "image" ? imageCount >= MAX_IMAGES_PER_MESSAGE : fileCount >= MAX_FILES_PER_MESSAGE) {
        setError(
          t("assistant.attachmentsMax", {
            images: String(MAX_IMAGES_PER_MESSAGE),
            files: String(MAX_FILES_PER_MESSAGE),
          }),
        );
        break;
      }
      if (kind === "image") {
        const refusal = refuseImage(file, premium);
        if (refusal === "too-large") {
          setError(t("api.imageTooLarge"));
          continue;
        }
        if (refusal === "premium") {
          setError(t("api.imageNeedsPremium"));
          continue;
        }
        imageCount++;
      } else if (kind === "media") {
        if (file.size > MEDIA_MAX_BYTES) {
          setError(t("api.videoTooLarge"));
          continue;
        }
        fileCount++;
      } else {
        if (file.size > FILE_MAX_BYTES) {
          setError(t("api.attachmentTooLarge"));
          continue;
        }
        fileCount++;
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      setAttachments((list) => [...list, { key, kind: "pending", name, pending: true }]);
      void readAttachment(file, kind, key, name);
    }
  }

  async function readAttachment(
    file: File,
    kind: "image" | "pdf" | "text" | "media",
    key: string,
    name: string,
  ) {
    try {
      let done: Attachment;
      if (kind === "image") {
        const stored = await uploadImage(file);
        done = { key, kind: "image", name, id: stored.id, url: stored.url };
      } else {
        const text =
          kind === "pdf"
            ? await attachToText(file, t)
            : kind === "media"
              ? await attachMediaToText(file, t)
              : capFileText(await file.text());
        if (!text.trim()) throw new Error(t("api.attachmentEmpty"));
        done = { key, kind: "file", name, text };
      }
      setAttachments((list) => list.map((a) => (a.key === key ? done : a)));
    } catch (err) {
      setAttachments((list) => list.filter((a) => a.key !== key));
      setError(callLine(err, t("common.notLoaded")));
    }
  }

  // Add from Google Drive (SPEC.md §14): the picker opens with the
  // assistant's own filter; every picked file becomes an attachment on the
  // server, one pending chip each while it does.
  async function addDriveFiles() {
    if (!drive || busy) return;
    setError(null);
    let token: string;
    let picked: DrivePickedFile[];
    try {
      const result = await pickDriveFiles({
        clientId: drive.clientId,
        apiKey: drive.apiKey,
        linked: drive.linked,
        access: drive.access,
        mimeTypes: DRIVE_ASSISTANT_MIME_TYPES,
      });
      token = result.token;
      picked = result.files;
    } catch (err) {
      setError(err instanceof Error ? err.message : t("panes.driveAuthFailed"));
      return;
    }
    if (picked.length === 0) return; // closed the picker without choosing a file
    let imageCount = attachments.filter((a) => a.kind === "image").length;
    let fileCount = attachments.filter((a) => a.kind !== "image").length;
    for (const file of picked) {
      const image = file.mimeType.startsWith("image/");
      if (image ? imageCount >= MAX_IMAGES_PER_MESSAGE : fileCount >= MAX_FILES_PER_MESSAGE) {
        setError(
          t("assistant.attachmentsMax", {
            images: String(MAX_IMAGES_PER_MESSAGE),
            files: String(MAX_FILES_PER_MESSAGE),
          }),
        );
        break;
      }
      if (image) imageCount++;
      else fileCount++;
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const name = capFileName(file.name);
      setAttachments((list) => [...list, { key, kind: "pending", name, pending: true }]);
      void (async () => {
        try {
          const done = await attachDriveFile(file, token, t);
          const chip: Attachment =
            done.kind === "image"
              ? { key, kind: "image", name: done.name, id: done.id, url: done.url }
              : { key, kind: "file", name: done.name, text: done.text };
          setAttachments((list) => list.map((a) => (a.key === key ? chip : a)));
        } catch (err) {
          setAttachments((list) => list.filter((a) => a.key !== key));
          setError(callLine(err, t("common.notLoaded")));
        }
      })();
    }
  }

  function removeAttachment(key: string) {
    setAttachments((list) => list.filter((a) => a.key !== key));
  }

  function removeQueued(key: string) {
    setQueue((list) => list.filter((m) => m.key !== key));
    releaseMessage(notebookId, key);
  }

  const reading = attachments.some((a) => a.pending);
  // The composer sends when it holds a message and nothing is still being
  // read; while an answer runs, it queues instead (SPEC.md §7).
  const composed = !reading && (question.trim() !== "" || attachments.length > 0);
  const canSend = !busy && composed;
  const canQueue = busy && composed;

  // The quote goes, and the words it marked stop being marked.
  function dropQuote() {
    setQuote(null);
    clearSelection();
  }

  // Ask: the composer's message goes out now, or into the queue while an
  // answer runs. The composer clears either way.
  function ask() {
    if (!composed) return;
    if (document.activeElement === boxRef.current) setFocusTick((n) => n + 1);
    // The box keeps its own words while the reader types (kept-field.tsx).
    const typed = boxRef.current?.value ?? question;
    const message: OutgoingMessage = {
      key: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      content: quote ? quoteMessage(quote, typed) : typed.trim(),
      question: typed.trim(),
      quote,
      images: attachments.flatMap((a) =>
        a.kind === "image" ? [{ id: a.id, url: a.url, name: a.name }] : [],
      ),
      files: attachments.flatMap((a) => (a.kind === "file" ? [{ name: a.name, text: a.text }] : [])),
    };
    // The words leave the box and stay in the draft, held, until the
    // answer is saved.
    boxText.set(notebookId, "");
    holdMessage(notebookId, message);
    setQuestion("");
    if (quote) dropQuote();
    setAttachments([]);
    if (busy) {
      setQueue((list) => [...list, message]);
      return;
    }
    void send(message);
  }

  async function send(message: OutgoingMessage) {
    // A run already on: the message waits its turn in the queue.
    if (busyRef.current) {
      setQueue((list) => [...list, message]);
      return;
    }
    busyRef.current = true;
    const q = message.content;
    const { images, files } = message;
    reset();
    setBusy(true);
    // The thread this message belongs to, read from the refs: a queued
    // message sends from inside the previous run's closure, where the state
    // is the state of the run before it.
    const sideChatKey = openKeyRef.current;
    const threadTurns = sideChatKey
      ? (sideChatsRef.current.find((s) => s.key === sideChatKey)?.turns ?? [])
      : turnsRef.current;
    // The turns so far, as the route replays them: a file by its name alone
    // (its answer already read the text), an image by its id.
    const history: ConversationTurn[] = threadTurns.map((turn) =>
      turn.role === "user"
        ? {
            role: "user",
            content: turn.content.slice(0, TURN_MAX_CHARS),
            images: turn.images?.map((img) => ({ id: img.id, name: img.name })),
            files: turn.files?.map((f) => ({ name: f.name })),
          }
        : { role: "assistant", content: withProposed(turn).slice(0, TURN_MAX_CHARS) },
    );
    const userTurn: Turn = { role: "user", content: q, images, files };
    setTurns((prev) => [...prev, userTurn, { role: "assistant", content: "" }]);
    // The thread this message went to, as it is now: the side chat's turns,
    // or the conversation's while it is still the one on screen.
    const threadNow = () =>
      sideChatKey
        ? (sideChatsRef.current.find((s) => s.key === sideChatKey)?.turns ?? [])
        : turnsRef.current;
    // What a save of this answer writes: the thread up to this message as it
    // is when the save runs (an earlier save may have merged it), then the
    // answer.
    const savedWith = (answer: string): Turn[] => {
      const thread = threadNow();
      const i = thread.indexOf(userTurn);
      const before = i >= 0 ? thread.slice(0, i) : threadTurns;
      return [...before, userTurn, { role: "assistant", content: answer }];
    };
    // A message that did not land leaves the thread and goes back into the
    // box; one on a thread no longer on screen just goes back.
    const takeBack = () => {
      const drop = (prev: Turn[]) => {
        const i = prev.indexOf(userTurn);
        if (i < 0) return prev;
        const after = prev[i + 1];
        const skip = after && after.role === "assistant" && !after.content ? 2 : 1;
        return [...prev.slice(0, i), ...prev.slice(i + skip)];
      };
      if (sideChatKey) {
        setSideChats((list) => list.map((s) => (s.key === sideChatKey ? { ...s, turns: drop(s.turns) } : s)));
      } else if (turnsRef.current.includes(userTurn)) {
        turnsRef.current = drop(turnsRef.current);
        setTurnsState(turnsRef.current);
        cacheThread();
      }
      putBack(notebookId, message);
    };
    let soFar = "";
    const setAnswer = (content: string, plan?: Turn["plan"], suggest?: string) =>
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant") return prev;
        return [...prev.slice(0, -1), { ...last, content, plan, suggest }];
      });
    const controller = new AbortController();
    runAbortRef.current = controller;
    try {
      const body = {
        notebookId,
        scope,
        documentId: scope === "document" ? documentId : undefined,
        task: "ask",
        question: q,
        web,
        thinking,
        history,
        images: images.map((img) => ({ id: img.id, name: img.name })),
        files,
        // Where "here" is on the open page (SPEC.md §29).
        caretBlockId: scope === "document" && documentId ? caretBlockIn(documentId) : undefined,
      };
      const res = await modelFetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      }, t);
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          detail?.error ?? noReason(res, t),
        );
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamed = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        streamed += decoder.decode(value, { stream: true });
        soFar = splitStreamPlan(splitStreamError(streamed).text).text;
        setAnswer(soFar);
      }
      // A failure mid-stream arrives in-band; an empty stream is a failure too.
      const { text: answered, error: streamError } = splitStreamError(streamed);
      const { text, plan } = splitStreamPlan(answered);
      if (streamError || !text.trim()) {
        setAnswer("");
        throw new Error(streamError ?? t("assistant.emptyResponse"));
      }
      // The assistant's suggestions go to the open page (SPEC.md §29); the
      // other actions go to the reader's plan card (SPEC.md §7), where they
      // wait for approval, and Undo follows them.
      const suggest = plan?.actions.find((a): a is SuggestAction => a.type === "suggest");
      const actions = plan?.actions.filter((a) => a.type !== "suggest") ?? [];
      const shown = plan ? { actions, warnings: plan.warnings } : undefined;
      setAnswer(text, shown, suggest && requestSuggestions(suggest, q, text, history));
      if (shown && actions.length > 0) proposePlan(shown);
      void saveConversation(() => savedWith(text), sideChatKey).then(
        (saved) => {
          if (saved) releaseMessage(notebookId, message.key);
        },
      );
    } catch (err) {
      // Stopped, not failed: whatever streamed in already stays on screen
      // and is saved with its question; a stop before the first words, or
      // a switch to another conversation, puts the message back in the box.
      if (controller.signal.aborted) {
        if (soFar.trim() && threadNow().includes(userTurn)) {
          void saveConversation(() => savedWith(soFar), sideChatKey).then(
            (saved) => {
              if (saved) releaseMessage(notebookId, message.key);
            },
          );
        } else {
          takeBack();
        }
        return;
      }
      takeBack();
      setError(failureLine(err, t));
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      setBusy(false);
      // An answer that never started leaves no empty card: the message stays,
      // the reader sends again.
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        return last && last.role === "assistant" && !last.content ? prev.slice(0, -1) : prev;
      });
      busyRef.current = false;
      // The queue drains one message per finished answer, in order — after a
      // Stop too: a queued message was sent to go out next.
      const [next, ...rest] = queueRef.current;
      if (next) {
        setQueue(() => rest);
        stickRef.current = true;
        void send(next);
      }
    }
  }

  async function runTask(task: Task) {
    if (busy) return;
    reset();
    setBusy(true);
    setTaskRun(task);
    const controller = new AbortController();
    runAbortRef.current = controller;
    try {
      const res = await modelFetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ notebookId, scope: "notebook", task, thinking }),
      }, t);
      const json = (await res.json().catch(() => null)) as
        | { issues?: Issue[]; error?: string }
        | null;
      if (!res.ok)
        throw new Error(json?.error ?? noReason(res, t));
      setIssues(json?.issues ?? []);
    } catch (err) {
      // Stopped, not failed: no cards, no error.
      if (controller.signal.aborted) return;
      setError(failureLine(err, t));
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      setBusy(false);
    }
  }

  function showNote(noteId: string) {
    window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId } }));
  }

  // The open document's reader runs the command over the page and lands the
  // suggestions (SPEC.md §29); the row under the answer follows the run.
  function requestSuggestions(
    action: SuggestAction,
    command: string,
    material: string,
    history: ConversationTurn[],
  ): string | undefined {
    if (!documentId) return undefined;
    const request: SuggestRequest = {
      documentId,
      key: queuedKey(),
      command: command.slice(0, 4000),
      instruction: action.instruction,
      blockIds: action.blockIds,
      reorder: action.reorder,
      material: material.slice(0, 20_000),
      history: history
        .filter((turn) => turn.content.trim())
        .slice(-20)
        .map((turn) => ({ role: turn.role, content: turn.content.slice(0, 8000) })),
    };
    window.dispatchEvent(new CustomEvent(SUGGEST_EVENT, { detail: request }));
    if (hasSuggestRun(request.key)) return request.key;
    setError(t("assistant.suggestNoPage"));
    return undefined;
  }

  // The plan card lives in the reader (reader-interactions.tsx); the open
  // document's reader takes the plan by its document id.
  function proposePlan(plan: { actions: AssistantAction[]; warnings: string[] }) {
    if (!documentId) return;
    window.dispatchEvent(
      new CustomEvent("dissect:assistant-plan", {
        detail: { documentId, actions: plan.actions, warnings: plan.warnings },
      }),
    );
  }

  const recommendedShown = recDepth ? (recTexts[recDepth] ?? summaries[recDepth] ?? "") : "";
  const recommendedRow = RECOMMENDED.find((r) => r.depth === recDepth);
  const recommendedLabel = recommendedRow ? t(recommendedRow.labelKey) : "";
  // A side chat is open on top of a conversation: both are a conversation on
  // screen, so the first layout never returns while one is open.
  const inConversation = turns.length > 0 || openSideChat !== null;

  // The composer's box grows with the message, up to six lines: as the
  // reader types, and when the box takes words (sent, put back, a draft).
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const fitBox = () => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  };
  useLayoutEffect(fitBox, [question]);
  // The box keeps the focus when the first message swaps the resting layout
  // for the conversation's, and takes it after Start side chat and Ask about
  // this: the next words typed land in it, never on the page.
  const [focusTick, setFocusTick] = useState(0);
  useEffect(() => {
    if (focusTick) boxRef.current?.focus({ preventScroll: true });
  }, [focusTick]);

  // The thread follows the newest turn while the reader is at its foot; a
  // reader who scrolled up to read stays where they are.
  const threadRef = useRef<HTMLDivElement>(null);
  const lastContent = turns[turns.length - 1]?.content ?? "";
  useEffect(() => {
    const el = threadRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [turns.length, lastContent, error, queue.length]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  // The New glow (SPEC.md §18) on Conversations until it is pressed.
  const conversationsNew = useNewFeature("conversations");

  // The panel's head (SPEC.md §7): Conversations opens the list of this
  // reader's conversations of the project; New conversation (+) starts an
  // empty one and keeps the one on screen in the list. Both stand in the
  // tray's head row, beside the title and ✕ (TOOL13-08), so nothing floats
  // over the turns and the turns get the row; a panel outside the tray
  // keeps them on a row of its own.
  const [headSlot, setHeadSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    // The tray's head row is in the page before the panel mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeadSlot(document.querySelector<HTMLElement>("[data-tray-head-slot]"));
  }, []);
  const headControls = (
    <>
      <button
        onClick={() => {
          conversationsNew.seen();
          openList();
        }}
        data-track="assistant-conversations"
        data-tip={t("assistant.conversationsTitle")}
        className={`flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-semibold text-sand-600 shadow-soft hover:text-clay-800${
          conversationsNew.isNew ? ` ${NEW_GLOW_CLASS}` : ""
        }`}
      >
        <HistoryIcon size={13} />
        {t("assistant.conversations")}
        {conversationsNew.isNew && <NewPill />}
      </button>
      {inConversation && (
        <button
          onClick={newConversation}
          data-track="assistant-new-conversation"
          aria-label={t("assistant.newConversation")}
          data-tip={t("assistant.newConversationTitle")}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-card text-sand-600 shadow-soft hover:text-clay-800 pointer-coarse:size-9"
        >
          <PlusIcon size={13} />
        </button>
      )}
    </>
  );
  const head = headSlot ? (
    createPortal(headControls, headSlot)
  ) : (
    <div className="flex items-center gap-1.5">{headControls}</div>
  );

  // What the next message runs with, on one row right above the composer
  // (SPEC.md §7): the scope — This page or Project — then how the assistant
  // answers — the thinking chip, and Web.
  const scopeRow = (
    <div className="flex flex-wrap items-center gap-1">
      {SCOPES.map((s) => (
        <button
          key={s.id}
          onClick={() => setScope(s.id)}
          data-track={`assistant-scope:${s.id}`}
          // This page needs an open document; without one the pill stays,
          // disabled, and says why.
          disabled={s.id === "document" && !documentId}
          data-tip={t(s.id === "document" && !documentId ? "assistant.scopeDocumentNoDocument" : s.hintKey)}
          className={`rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-40 ${
            scope === s.id
              ? "bg-ink text-paper"
              : "bg-card text-sand-600 shadow-soft hover:text-clay-800"
          }`}
        >
          {t(s.labelKey)}
        </button>
      ))}
      <ThinkingChips className="ml-auto" />
      <WebChip />
    </div>
  );

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        stickRef.current = true;
        ask();
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(true);
      }}
      onDragLeave={(e) => {
        if (hasFiles(e)) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        void addFiles([...(e.dataTransfer?.files ?? [])]);
      }}
      className={`shrink-0 rounded-2xl bg-card p-2 shadow-soft ${over ? "outline-2 outline-clay-300" : ""}`}
    >
      {attachments.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5 px-1 pt-1">
          {attachments.map((a) =>
            a.kind === "image" ? (
              <span key={a.key} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element -- a stored image, its own size */}
                <img src={a.url} alt={a.name} className="size-12 rounded-lg object-cover" />
                <button
                  type="button"
                  onClick={() => removeAttachment(a.key)}
                  data-track="assistant-attachment-remove"
                  aria-label={t("assistant.removeAttachment", { name: a.name })}
                  data-tip={t("assistant.removeAttachment", { name: a.name })}
                  className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-ink text-[11px] text-paper"
                >
                  ✕
                </button>
              </span>
            ) : (
              <span
                key={a.key}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-sand-100 px-2.5 py-0.5 text-xs text-sand-700"
              >
                {a.kind === "pending" && <LoadingDots label={t("assistant.reading", { name: a.name })} />}
                <span className="truncate">{a.name}</span>
                {a.kind === "file" && (
                  <button
                    type="button"
                    onClick={() => removeAttachment(a.key)}
                    data-track="assistant-attachment-remove"
                    aria-label={t("assistant.removeAttachment", { name: a.name })}
                    data-tip={t("assistant.removeAttachment", { name: a.name })}
                    className="text-sand-500 hover:text-clay-800"
                  >
                    ✕
                  </button>
                )}
              </span>
            ),
          )}
        </div>
      )}
      {/* A side chat's header already shows the quote it started on. */}
      {quote && quote !== openSideChat?.quote && <QuoteChip quote={quote} onClear={dropQuote} className="mb-1.5" />}
      <KeptTextarea
        fieldRef={boxRef}
        value={question}
        rows={1}
        onCommit={(text) => {
          boxText.set(notebookId, text);
          setQuestion(text);
        }}
        onType={fitBox}
        {...ime.props}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey) return;
          e.preventDefault();
          if (ime.isImeEnter(e)) return;
          stickRef.current = true;
          ask();
        }}
        onPaste={(e) => {
          const files = [...(e.clipboardData?.files ?? [])];
          if (files.length === 0) return;
          e.preventDefault();
          void addFiles(files);
        }}
        placeholder={t(
          busy
            ? "assistant.queuePlaceholder"
            : openSideChat
              ? "assistant.sideChatPlaceholder"
              : inConversation
                ? "assistant.followUpPlaceholder"
                : scope === "document"
                  ? "assistant.askPlaceholderDocument"
                  : "assistant.askPlaceholderProject",
        )}
        className="block max-h-40 w-full resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-sand-500"
      />
      <div className="flex items-center gap-1">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={FILE_ACCEPT}
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            void addFiles(files);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          data-track="assistant-attach"
          aria-label={t("assistant.attach")}
          data-tip={t("assistant.attachTitle")}
          className="flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
        >
          <PaperclipIcon size={15} />
        </button>
        {drive && (
          <button
            type="button"
            onClick={() => void addDriveFiles()}
            data-track="assistant-attach-drive"
            aria-label={t("assistant.attachDrive")}
            data-tip={t("assistant.attachDriveTitle")}
            className="flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
          >
            <DriveIcon size={15} />
          </button>
        )}
        <VoiceTypingButton field={boxRef} track="assistant-voice-typing" className="ml-auto size-8" size={14} />
        {/* While an answer runs the button is Stop, or Queue once a message
            is composed; the thinking row in the thread keeps its own Stop. */}
        <button
          type="submit"
          data-track={canQueue ? "assistant-queue" : `assistant-ask:${scope}`}
          onClick={(e) => {
            if (!busy || canQueue) return;
            e.preventDefault();
            stopRun();
          }}
          disabled={!busy && !canSend}
          data-tip={busy ? t(canQueue ? "assistant.queueTitle" : "assistant.stopAsk") : t("reader.sendTitle")}
          aria-label={busy && !canQueue ? t("assistant.stopAsk") : undefined}
          // The card's Send (reader-interactions.tsx): one size and color.
          className={SEND_CLASS}
        >
          {busy && !canQueue ? <StopIcon size={11} /> : t(canQueue ? "assistant.queue" : "assistant.send")}
        </button>
      </div>
    </form>
  );

  // A saved conversation loads once per project per tab (the effect above);
  // this is that wait, so the first layout never flashes before it swaps to
  // the restored thread.
  if (!hydrated) {
    return (
      <div className="flex h-32 items-center justify-center">
        <ThinkingIndicator className="text-xs" label={t("assistant.loadingConversation")} />
      </div>
    );
  }

  // The conversations list (SPEC.md §7), in the thread's place: every
  // conversation of this reader in the project, newest first — its title,
  // when, how many messages; the open one marked. A click opens one; the
  // bin deletes one; Back returns to the thread. History, under the list,
  // is the page with every conversation of the project, whoever had it.
  if (listOpen) {
    return (
      <div className="flex h-full flex-col gap-3">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setListOpen(false)}
            data-track="assistant-conversations-back"
            data-tip={t("assistant.conversationsBackTitle")}
            className="flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold text-sand-600 hover:bg-clay-100 hover:text-clay-800"
          >
            <ChevronLeftIcon size={14} />
            {t("assistant.conversationsBack")}
          </button>
          <button
            onClick={newConversation}
            data-track="assistant-new-conversation"
            data-tip={t("assistant.newConversationTitle")}
            className="ml-auto flex items-center gap-1 rounded-full bg-card px-3 py-1 text-xs font-semibold text-sand-600 shadow-soft hover:text-clay-800"
          >
            <PlusIcon size={13} />
            {t("assistant.newConversation")}
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {listError && <p className="mb-2 text-sm text-red-600">{listError}</p>}
          {conversations === null && !listError && (
            <ThinkingIndicator className="text-xs" label={t("assistant.conversationsLoading")} />
          )}
          {conversations && conversations.length === 0 && (
            <p className="text-[13px] text-sand-600">{t("assistant.conversationsEmpty")}</p>
          )}
          {conversations && conversations.length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {conversations.map((c) => {
                const current = c.id === conversationNoteId;
                return (
                  <li
                    key={c.id}
                    className={`group/conversation flex items-start gap-2 rounded-2xl px-3.5 py-2.5 shadow-soft ${
                      current ? "bg-clay-100" : "bg-card hover:bg-clay-100/60"
                    }`}
                  >
                    <button
                      onClick={() => void openConversation(c.id)}
                      data-track="assistant-conversation-open"
                      data-tip={t("assistant.conversationOpenTitle")}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-[13px] font-semibold text-sand-800">
                        {c.title || t("assistant.newConversation")}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-sand-500">
                        {formatWhen(c.updatedAt)} · {t("assistant.historyTurns", { n: String(c.turns) })}
                        {current ? ` · ${t("assistant.conversationCurrent")}` : ""}
                      </span>
                    </button>
                    <button
                      onClick={() => deleteConversation(c.id)}
                      data-track="assistant-conversation-delete"
                      aria-label={t("assistant.conversationDelete")}
                      data-tip={t("assistant.conversationDelete")}
                      className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-sand-400 opacity-0 transition-opacity group-hover/conversation:opacity-100 hover:bg-clay-200 hover:text-clay-800 focus-visible:opacity-100 pointer-coarse:size-9 pointer-coarse:opacity-100"
                    >
                      <TrashIcon size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <Link
          href={`/n/${notebookId}/assistant`}
          data-track="assistant-history"
          data-tip={t("assistant.historyTitle")}
          className="flex shrink-0 items-center gap-1.5 text-[12px] text-sand-600 hover:text-clay-800"
        >
          <HistoryIcon size={13} />
          {t("assistant.history")}
        </Link>
      </div>
    );
  }

  if (inConversation) {
    // The newest answer keeps its rating row and Save as note in view.
    const lastAnswer = activeTurns.findLastIndex((turn) => turn.role === "assistant");
    return (
      <div className="flex h-full flex-col gap-3">
        {head}
        <div
          ref={threadRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain"
        >
          {activeTurns.map((turn, i) =>
            turn.role === "user" ? (
              <div key={i} className="ml-8 flex flex-col items-end gap-1.5">
                {turn.images && turn.images.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {turn.images.map((img) => (
                      // eslint-disable-next-line @next/next/no-img-element -- a stored image, its own size
                      <img
                        key={img.id}
                        src={imageUrl(img.id)}
                        alt={img.name}
                        className="max-h-40 max-w-full rounded-xl bg-card object-contain"
                      />
                    ))}
                  </div>
                )}
                {turn.files && turn.files.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1">
                    {turn.files.map((f, j) => (
                      <span
                        key={j}
                        className="inline-flex max-w-full items-center gap-1 rounded-full bg-sand-100 px-2.5 py-0.5 text-xs text-sand-700"
                      >
                        <PaperclipIcon size={11} />
                        <span className="truncate">{f.name}</span>
                      </span>
                    ))}
                  </div>
                )}
                {turn.content && (
                  <p className="rounded-2xl bg-clay-100 px-3.5 py-2 text-[13.5px] whitespace-pre-wrap text-clay-800">
                    {turn.content}
                  </p>
                )}
              </div>
            ) : (
              <div
                key={i}
                // An older answer shows its rating row on hover or focus; a
                // tap focuses the answer on a touch screen.
                tabIndex={-1}
                className="group/answer rounded-2xl bg-card p-4 text-sm shadow-soft outline-none"
              >
                {turn.content ? (
                  <>
                    {/* Highlighting the answer offers the side chat, the
                        quoted question, and the comment (SPEC.md §7). */}
                    <div {...{ [ANSWER_MARK]: "" }}>
                      {/* An older answer may still carry its actions block:
                          the reader never sees the JSON (SPEC.md §7). */}
                      <AnswerMarkdown>{splitActionsFence(turn.content).text}</AnswerMarkdown>
                    </div>
                    {/* The plan the answer came with: the count, and the way
                        back to the plan card once it was closed. */}
                    {turn.plan && turn.plan.actions.length > 0 && (
                      <div className="mt-2 flex items-center gap-2 text-[12px] text-sand-600">
                        <span>
                          {t("assistant.proposedActions", {
                            n: turn.plan.actions.length,
                            s: plural(turn.plan.actions.length),
                          })}
                        </span>
                        <button
                          onClick={() => proposePlan(turn.plan!)}
                          data-track="assistant-review-plan"
                          className="rounded-full bg-sand-100 px-2.5 py-0.5 font-semibold text-sand-700 hover:bg-sand-200"
                        >
                          {t("assistant.reviewPlan")}
                        </button>
                      </div>
                    )}
                    {turn.suggest && <SuggestionRow runKey={turn.suggest} withSummary />}
                    {turn.plan && turn.plan.warnings.length > 0 && (
                      <ul className="mt-2 flex flex-col gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                        {turn.plan.warnings.map((w, j) => (
                          <li key={j} className="text-[11.5px] font-medium text-amber-700 dark:text-amber-400">
                            ⚠ {w}
                          </li>
                        ))}
                      </ul>
                    )}
                    {/* The rating (SPEC.md §25): the question it answered and
                        the answer, once the answer is whole; the
                        suggestions' row rates a turn that asked for them. */}
                    {!(busy && i === activeTurns.length - 1) && (
                      <div
                        className={`mt-2 flex flex-wrap items-center gap-2${
                          i < lastAnswer
                            ? " opacity-0 transition-opacity group-focus-within/answer:opacity-100 group-hover/answer:opacity-100"
                            : ""
                        }`}
                      >
                        {!turn.suggest && (
                          <RatingButtons
                            tool="assistant"
                            input={activeTurns[i - 1]?.content ?? ""}
                            output={turn.content}
                            notebookId={notebookId}
                            documentId={documentId ?? undefined}
                            inRow
                          />
                        )}
                        {/* Save as note (SPEC.md §7): the answer organized
                            into a note of the project, pending. */}
                        <SaveAsNote
                          notebookId={notebookId}
                          documentId={documentId ?? undefined}
                          question={activeTurns[i - 1]?.content ?? ""}
                          answer={splitActionsFence(turn.content).text}
                          className="ml-auto"
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <ThinkingIndicator className="text-xs" onStop={stopRun} />
                )}
              </div>
            ),
          )}
          {queue.length > 0 && (
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-[11px] font-bold tracking-[0.08em] text-sand-500 uppercase">
                {t("assistant.queued", { n: String(queue.length) })}
              </span>
              {queue.map((m) => (
                <div key={m.key} className="ml-8 flex max-w-full items-start gap-1.5">
                  <div className="flex flex-col items-end gap-1 opacity-60">
                    {(m.images.length > 0 || m.files.length > 0) && (
                      <div className="flex flex-wrap justify-end gap-1">
                        {m.images.map((img) => (
                          <span key={img.id} className="rounded-full bg-sand-100 px-2.5 py-0.5 text-xs text-sand-700">
                            {img.name}
                          </span>
                        ))}
                        {m.files.map((f, j) => (
                          <span key={j} className="inline-flex items-center gap-1 rounded-full bg-sand-100 px-2.5 py-0.5 text-xs text-sand-700">
                            <PaperclipIcon size={11} />
                            {f.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.content && (
                      <p className="rounded-2xl bg-clay-100 px-3.5 py-2 text-[13.5px] whitespace-pre-wrap text-clay-800">
                        {m.content}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeQueued(m.key)}
                    data-track="assistant-queue-remove"
                    aria-label={t("assistant.removeQueued")}
                    data-tip={t("assistant.removeQueued")}
                    className="mt-1.5 text-sand-500 hover:text-clay-800"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <CommentList
            comments={comments}
            people={{ ...people, ...commentPeople }}
            myId={myId}
            onDelete={(id) => void deleteComment(id)}
          />
        </div>
        {openSideChat ? (
          <SideChatHeader quote={openSideChat.quote} onBack={() => setOpenKey(null)} />
        ) : (
          <SideChatChips sideChats={sideChats.filter((s) => s.turns.length > 0)} onOpen={setOpenKey} />
        )}
        {commentQuote ? (
          <CommentBox
            key={commentDraftKey ?? ""}
            quote={commentQuote}
            busy={commentBusy}
            draft={readCommentDraft(commentDraftKey)}
            onDraft={(text) => writeCommentDraft(commentDraftKey, text)}
            onCancel={() => {
              setCommentQuote(null);
              clearSelection();
            }}
            onSubmit={(text) => void postComment(text)}
          />
        ) : (
          <>
            {scopeRow}
            {composer}
          </>
        )}
        {/* Why the last message (or comment) did not go, under the box that
            sent it; its words are back in the box (SPEC.md §7). */}
        {error && (
          <p role="alert" className="-mt-1.5 px-1 text-[12px] font-medium text-red-600">
            {error}
          </p>
        )}
        <AnswerTint rects={tintRects} />
        {selection && (
          <AnswerToolbar
            selection={selection}
            canSideChat={conversationNoteId !== null}
            onSideChat={startSideChat}
            onAsk={askAboutThis}
            onComment={openComment}
          />
        )}
      </div>
    );
  }

  // Below md, in the tray's bottom sheet, the head and Recommended scroll
  // and the rows and the composer stay at the sheet's foot, as in a
  // conversation; on md+ the whole layout scrolls in the tray.
  return (
    <div className="space-y-3 max-md:flex max-md:h-full max-md:flex-col">
      <div className="space-y-3 max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto">
      {head}
      {documentId && (
        <div className="space-y-2">
          <span className="text-[11px] font-bold tracking-[0.08em] text-sand-600 uppercase">
            {t("assistant.recommended")}
          </span>
          <div className="flex flex-col gap-1.5">
            {RECOMMENDED.map((r) => (
              <button
                key={r.depth}
                onClick={() => openRecommended(r.depth)}
                data-track={`assistant-recommended:${r.depth}`}
                disabled={recBusy !== null}
                aria-pressed={recDepth === r.depth}
                className={`rounded-2xl px-3.5 py-2 text-left shadow-soft disabled:opacity-60 ${
                  recDepth === r.depth
                    ? "bg-clay-100 text-clay-800"
                    : "bg-card text-sand-800 hover:bg-clay-100 hover:text-clay-800"
                }`}
              >
                <span className="flex items-center gap-2 text-[13px] font-semibold">
                  {t(r.labelKey)}
                  {recBusy === r.depth && <LoadingDots />}
                </span>
                <span className="mt-0.5 block text-xs text-sand-500">{t(r.hintKey)}</span>
              </button>
            ))}
          </div>
          {recDepth && (recommendedShown || recError || recBusy === recDepth) && (
            <div className="rounded-2xl bg-card p-4 shadow-soft">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-bold tracking-[0.08em] text-clay-800 uppercase">
                  {recommendedLabel}
                </span>
                {/* While the summary streams, Stop stands where Regenerate
                    does, for the whole run: a stopped run leaves the stored
                    summary, if any. */}
                {recBusy === recDepth ? (
                  <button
                    onClick={stopRecommended}
                    data-track="assistant-recommended-stop"
                    data-tip={t("assistant.summaryStopTitle")}
                    className="flex items-center gap-1 text-xs text-sand-500 hover:text-clay-700"
                  >
                    <StopIcon size={10} />
                    {t("common.stop")}
                  </button>
                ) : (
                  <button
                    onClick={() => void generateRecommended(recDepth)}
                    data-track="assistant-regenerate"
                    data-tip={t("assistant.regenerateTitle")}
                    disabled={recBusy !== null}
                    className="text-xs text-sand-500 hover:text-clay-700 disabled:opacity-40"
                  >
                    {t("common.regenerate")}
                  </button>
                )}
              </div>
              {recError ? (
                <p className="text-sm text-red-600">{recError}</p>
              ) : recommendedShown ? (
                <div className="text-sm">
                  <Markdown>{recommendedShown}</Markdown>
                </div>
              ) : (
                <ThinkingIndicator
                  className="text-xs"
                  onStop={stopRecommended}
                  stopTitle={t("assistant.summaryStopTitle")}
                />
              )}
            </div>
          )}
        </div>
      )}
      </div>

      {scopeRow}
      {composer}

      {scope === "notebook" && (
        <div className="flex flex-wrap gap-1.5">
          {(["contradictions", "gaps", "unsourced"] as Task[]).map((task) => (
            <button
              key={task}
              onClick={() => void runTask(task)}
              data-track={`assistant-task:${task}`}
              data-tip={t(TASK_TITLE[task])}
              disabled={busy}
              className="rounded-full border border-line px-3 py-1 text-xs text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
            >
              {t(TASK_LABEL[task])}
            </button>
          ))}
        </div>
      )}

      {busy && taskRun && <ThinkingIndicator className="text-xs" onStop={stopRun} />}
      {error && <p className="text-sm text-red-600">{error}</p>}

      {issues && (
        <div className="space-y-2">
          {issues.length === 0 && (
            <p className="text-sm text-sand-600">
              {t("assistant.noTaskFound", { task: taskRun ? t(TASK_NOUN[taskRun]) : "" })}
            </p>
          )}
          {issues.map((issue, i) => (
            <div
              key={i}
              className="rounded-2xl bg-card p-3.5 shadow-soft outline-2 outline-clay-300"
            >
              <p className="text-sm font-semibold text-clay-800">{issue.issue}</p>
              <p className="mt-1 text-xs text-sand-600">{issue.explanation}</p>
              {issue.noteIds.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {issue.noteIds.map((id) => (
                    <button
                      key={id}
                      onClick={() => showNote(id)}
                      data-track="assistant-note-chip"
                      data-tip={t("assistant.showNoteTitle")}
                      className="rounded-full bg-clay-100 px-2.5 py-0.5 text-xs font-semibold text-clay-800 hover:bg-clay-200"
                    >
                      {t("assistant.noteChip", { id: id.slice(-6) })}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
