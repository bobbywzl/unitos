"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { useWeb, WebChip } from "@/components/assistant/web-chip";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
import { DriveIcon, PaperclipIcon, StopIcon } from "@/components/icons";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { Markdown } from "@/components/markdown";
import { RatingButtons } from "@/components/rating-buttons";
import { LoadingDots, ThinkingIndicator } from "@/components/thinking";

type Scope = "document" | "notebook";
type Task = "contradictions" | "gaps" | "unsourced";
type Issue = { noteIds: string[]; issue: string; explanation: string };

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
};
const plural = (n: number) => (n === 1 ? "" : "s");
// One side chat of this conversation (SPEC.md §7): the quote it was started
// from and its own turns. noteId = the note it saves on, null until the
// first answer lands; key holds it together before then.
type SideChat = { key: string; noteId: string | null; quote: string; turns: Turn[] };
type Thread = {
  turns: Turn[];
  conversationNoteId: string | null;
  sideChats: SideChat[];
  // The side chat on screen, by key; null = the conversation itself.
  openKey: string | null;
};

// One message as it is sent: the text and the attachments read for it.
type OutgoingMessage = {
  content: string;
  images: { id: string; url: string; name: string }[];
  files: { name: string; text: string }[];
};
// A message queued while an answer runs (SPEC.md §7): it sends, in order,
// once the answer lands. The key removes it from the queue.
type QueuedMessage = OutgoingMessage & { key: string };

// The conversation survives a tab switch and a document switch within the
// same tab (both remount the panel, so the thread lives outside it, per
// project, for the page's life) and a reload (it is saved, SPEC.md §21: one
// note per reader per project, loaded once per project per tab — see the
// hydration effect below).
const threads = new Map<string, Thread>();


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
  if (!res.ok || typeof json?.text !== "string") {
    throw new Error(json?.error ?? t("assistant.requestFailedStatus", { status: res.status }));
  }
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
    if (!res.ok) {
      const detail = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(detail?.error ?? t("assistant.requestFailedStatus", { status: res.status }));
    }
  }
  const res = await fetch("/api/assistant/attach-media", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploadId, name: capFileName(file.name), mimeType: file.type || undefined }),
  });
  const json = (await res.json().catch(() => null)) as { text?: string; error?: string } | null;
  if (!res.ok || typeof json?.text !== "string") {
    throw new Error(json?.error ?? t("assistant.requestFailedStatus", { status: res.status }));
  }
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
  if (!res.ok || !json || (json.kind !== "file" && json.kind !== "image")) {
    throw new Error(json?.error ?? t("assistant.requestFailedStatus", { status: res.status }));
  }
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
  const [question, setQuestion] = useState("");
  // The conversation (SPEC.md §7, §21): the first question opens it; every
  // turn after continues it. Empty = the panel's first layout. The note it
  // is saved on, once a turn has persisted; null until then, and again once
  // New conversation clears it.
  const cached = threads.get(notebookId);
  const [turns, setTurnsState] = useState<Turn[]>(() => cached?.turns ?? []);
  const [conversationNoteId, setConversationNoteId] = useState<string | null>(
    () => cached?.conversationNoteId ?? null,
  );
  // The side chats of this conversation, and the one on screen (SPEC.md §7).
  const [sideChats, setSideChatsState] = useState<SideChat[]>(() => cached?.sideChats ?? []);
  const [openKey, setOpenKeyState] = useState<string | null>(() => cached?.openKey ?? null);
  const [hydrated, setHydrated] = useState(() => cached !== undefined);
  // The thread as the running send() reads it: state is stale inside its own
  // closure, and a queued message sends from there.
  const turnsRef = useRef<Turn[]>(turns);
  const sideChatsRef = useRef<SideChat[]>(sideChats);
  const openKeyRef = useRef<string | null>(openKey);
  const noteIdRef = useRef<string | null>(conversationNoteId);
  function cacheThread() {
    threads.set(notebookId, {
      turns: turnsRef.current,
      conversationNoteId: noteIdRef.current,
      sideChats: sideChatsRef.current,
      openKey: openKeyRef.current,
    });
  }
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
    setTurnsState((prev) => {
      turnsRef.current = update(prev);
      cacheThread();
      return turnsRef.current;
    });
  }
  // The panel is keyed by document, so it remounts on every document switch;
  // the thread cache (keyed by project) means this only actually fetches the
  // first time this project's conversation is shown in this browser tab.
  useEffect(() => {
    if (threads.has(notebookId)) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/assistant/conversation?notebookId=${encodeURIComponent(notebookId)}`);
        type StoredTurn = {
          role: "user" | "assistant";
          content: string;
          images?: { id: string; name: string }[];
          files?: { name: string }[];
        };
        const json = (await res.json().catch(() => null)) as {
          conversationNoteId?: string | null;
          turns?: StoredTurn[];
          sideChats?: { id: string; quote: string; turns: StoredTurn[] }[];
        } | null;
        if (cancelled || !res.ok || !json) return;
        const toTurns = (stored: StoredTurn[]): Turn[] =>
          stored.map((turn) => ({
            role: turn.role,
            content: turn.content,
            images: turn.images?.map((img) => ({ id: img.id, name: img.name, url: imageUrl(img.id) })),
            files: turn.files,
          }));
        const loaded = toTurns(json.turns ?? []);
        const loadedSideChats: SideChat[] = (json.sideChats ?? []).map((s) => ({
          key: s.id,
          noteId: s.id,
          quote: s.quote,
          turns: toTurns(s.turns),
        }));
        turnsRef.current = loaded;
        sideChatsRef.current = loadedSideChats;
        noteIdRef.current = json.conversationNoteId ?? null;
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

  // New conversation: back to the first layout, the turns gone — on the
  // server too, not only on screen (SPEC.md §21).
  function newConversation() {
    stopRun();
    reset();
    if (conversationNoteId) {
      void fetch("/api/assistant/conversation", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notebookId, conversationNoteId }),
      }).catch(() => {});
    }
    turnsRef.current = [];
    sideChatsRef.current = [];
    openKeyRef.current = null;
    noteIdRef.current = null;
    setTurnsState([]);
    setSideChatsState([]);
    setOpenKeyState(null);
    setConversationNoteId(null);
    setQuote(null);
    setCommentQuote(null);
    setComments([]);
    clearSelection();
    cacheThread();
    setAttachments([]);
    setQueue(() => []);
    setQuestion("");
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
  }
  // Ask about this: the words ride into the next message of this thread.
  function askAboutThis() {
    const text = takeSelection();
    if (!text) return;
    setQuote(text);
    setCommentQuote(null);
  }
  function openComment() {
    const text = takeSelection();
    if (!text || !activeNoteId) return;
    setCommentQuote(text);
  }
  async function postComment(text: string) {
    if (!activeNoteId || commentBusy) return;
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
      if (!res.ok || !json?.id) throw new Error(json?.error ?? t("assistant.commentFailed"));
      setComments((list) => [...list, json]);
      setCommentQuote(null);
      clearSelection();
      // The Annotations tab lists the comment under the conversation.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("assistant.commentFailed"));
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
  async function saveConversation(savedTurns: Turn[], sideChatKey: string | null) {
    const side = sideChatKey ? sideChatsRef.current.find((s) => s.key === sideChatKey) : null;
    if (sideChatKey && !side) return;
    try {
      const res = await fetch("/api/assistant/conversation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notebookId,
          conversationNoteId: side ? side.noteId : noteIdRef.current,
          // A side chat belongs to the conversation it was started from.
          sideChatOf: side ? noteIdRef.current : undefined,
          quote: side ? side.quote : undefined,
          turns: savedTurns.map((turn) => ({
            role: turn.role,
            content: turn.content.slice(0, TURN_MAX_CHARS),
            images: turn.images?.map((img) => ({ id: img.id, name: img.name })),
            files: turn.files?.map((f) => ({ name: f.name })),
          })),
        }),
      });
      const json = (await res.json().catch(() => null)) as { conversationNoteId?: string } | null;
      if (!res.ok || !json?.conversationNoteId) return;
      if (side) {
        const noteId = json.conversationNoteId;
        setSideChats((list) => list.map((s) => (s.key === side.key ? { ...s, noteId } : s)));
        return;
      }
      setNoteId(json.conversationNoteId);
    } catch {
      // Offline, or the request otherwise never landed — the thread is still
      // right here on screen; the next completed turn tries again.
    }
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
      const res = await fetch("/api/derive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ type: "SUMMARIZE", documentId, notebookId, depth }),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? t("assistant.requestFailedStatus", { status: res.status }));
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
      setRecError(err instanceof Error ? err.message : t("common.requestFailed"));
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
      setError(err instanceof Error ? err.message : t("common.requestFailed"));
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
          setError(err instanceof Error ? err.message : t("common.requestFailed"));
        }
      })();
    }
  }

  function removeAttachment(key: string) {
    setAttachments((list) => list.filter((a) => a.key !== key));
  }

  function removeQueued(key: string) {
    setQueue((list) => list.filter((m) => m.key !== key));
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
    const message: OutgoingMessage = {
      content: quote ? quoteMessage(quote, question) : question.trim(),
      images: attachments.flatMap((a) =>
        a.kind === "image" ? [{ id: a.id, url: a.url, name: a.name }] : [],
      ),
      files: attachments.flatMap((a) => (a.kind === "file" ? [{ name: a.name, text: a.text }] : [])),
    };
    setQuestion("");
    if (quote) dropQuote();
    setAttachments([]);
    if (busy) {
      setQueue((list) => [...list, { ...message, key: `${Date.now()}-${Math.random().toString(36).slice(2)}` }]);
      return;
    }
    void send(message);
  }

  async function send(message: OutgoingMessage) {
    if (busyRef.current) return;
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
        : { role: "assistant", content: turn.content.slice(0, TURN_MAX_CHARS) },
    );
    const userTurn: Turn = { role: "user", content: q, images, files };
    setTurns((prev) => [...prev, userTurn, { role: "assistant", content: "" }]);
    const setAnswer = (content: string, plan?: Turn["plan"]) =>
      setTurns((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== "assistant") return prev;
        return [...prev.slice(0, -1), { ...last, content, plan }];
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
      };
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(
          detail?.error ?? t("assistant.assistantFailedStatus", { status: res.status }),
        );
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamed = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        streamed += decoder.decode(value, { stream: true });
        setAnswer(splitStreamPlan(splitStreamError(streamed).text).text);
      }
      // A failure mid-stream arrives in-band; an empty stream is a failure too.
      const { text: answered, error: streamError } = splitStreamError(streamed);
      const { text, plan } = splitStreamPlan(answered);
      if (streamError || !text.trim()) {
        setAnswer("");
        throw new Error(streamError ?? t("assistant.emptyResponse"));
      }
      setAnswer(text, plan ?? undefined);
      // The plan goes to the reader's plan card (SPEC.md §7): the actions
      // wait for approval there, and Undo follows them.
      if (plan && plan.actions.length > 0) proposePlan(plan);
      void saveConversation([...threadTurns, userTurn, { role: "assistant", content: text }], sideChatKey);
    } catch (err) {
      // Stopped, not failed: whatever streamed in already stays on screen.
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : t("assistant.assistantFailed"));
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
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ notebookId, scope: "notebook", task, thinking }),
      });
      const json = (await res.json().catch(() => null)) as
        | { issues?: Issue[]; error?: string }
        | null;
      if (!res.ok)
        throw new Error(json?.error ?? t("assistant.taskFailedStatus", { status: res.status }));
      setIssues(json?.issues ?? []);
    } catch (err) {
      // Stopped, not failed: no cards, no error.
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : t("assistant.taskFailed"));
    } finally {
      if (runAbortRef.current === controller) runAbortRef.current = null;
      setBusy(false);
    }
  }

  function showNote(noteId: string) {
    window.dispatchEvent(new CustomEvent("dissect:show-note", { detail: { noteId } }));
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
  const scopeRow = SCOPES.find((s) => s.id === scope);
  // A side chat is open on top of a conversation: both are a conversation on
  // screen, so the first layout never returns while one is open.
  const inConversation = turns.length > 0 || openSideChat !== null;

  // The composer's box grows with the message, up to six lines.
  const boxRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [question]);

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

  const scopeChips = (
    <div className="flex flex-wrap gap-1">
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
      <ThinkingChips />
      <WebChip className="ml-auto" />
      {inConversation && (
        <button
          onClick={newConversation}
          data-track="assistant-new-conversation"
          data-tip={t("assistant.newConversationTitle")}
          className="rounded-full bg-card px-3 py-1 text-xs font-semibold text-sand-600 shadow-soft hover:text-clay-800"
        >
          {t("assistant.newConversation")}
        </button>
      )}
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
      {quote && <QuoteChip quote={quote} onClear={dropQuote} className="mb-1.5" />}
      <textarea
        ref={boxRef}
        value={question}
        rows={1}
        onChange={(e) => setQuestion(e.target.value)}
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
          data-tip={busy ? t(canQueue ? "assistant.queueTitle" : "assistant.stopAsk") : undefined}
          aria-label={busy && !canQueue ? t("assistant.stopAsk") : undefined}
          className="ml-auto rounded-full bg-clay px-4 py-1.5 text-sm font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
        >
          {busy && !canQueue ? (
            <StopIcon size={13} />
          ) : (
            t(canQueue ? "assistant.queue" : inConversation ? "assistant.send" : "assistant.ask")
          )}
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

  if (inConversation) {
    return (
      <div className="flex h-full flex-col gap-3">
        {scopeChips}
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
              <div key={i} className="rounded-2xl bg-card p-4 text-sm shadow-soft">
                {turn.content ? (
                  <>
                    {/* Highlighting the answer offers the side chat, the
                        quoted question, and the comment (SPEC.md §7). */}
                    <div {...{ [ANSWER_MARK]: "" }}>
                      <Markdown>{turn.content}</Markdown>
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
                        the answer, once the answer is whole. */}
                    {!(busy && i === activeTurns.length - 1) && (
                      <RatingButtons
                        tool="assistant"
                        input={activeTurns[i - 1]?.content ?? ""}
                        output={turn.content}
                        notebookId={notebookId}
                        documentId={documentId ?? undefined}
                        className="mt-2"
                      />
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
          {error && <p className="text-sm text-red-600">{error}</p>}
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
            quote={commentQuote}
            busy={commentBusy}
            onCancel={() => {
              setCommentQuote(null);
              clearSelection();
            }}
            onSubmit={(text) => void postComment(text)}
          />
        ) : (
          composer
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

  return (
    <div className="space-y-3">
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
                <button
                  onClick={() => void generateRecommended(recDepth)}
                  data-track="assistant-regenerate"
                  data-tip={t("assistant.regenerateTitle")}
                  disabled={recBusy !== null}
                  className="text-xs text-sand-500 hover:text-clay-700 disabled:opacity-40"
                >
                  {t("common.regenerate")}
                </button>
              </div>
              {recError ? (
                <p className="text-sm text-red-600">{recError}</p>
              ) : recommendedShown ? (
                <div className="text-sm">
                  <Markdown>{recommendedShown}</Markdown>
                </div>
              ) : (
                <ThinkingIndicator className="text-xs" onStop={stopRecommended} />
              )}
            </div>
          )}
        </div>
      )}

      {scopeChips}
      <p className="text-xs text-sand-500">{scopeRow ? t(scopeRow.hintKey) : null}</p>

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
