"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { READING_LINE_PX } from "@/lib/reading-position";
import { browserUtterances } from "@/lib/voice/browser-voice";

// Read aloud for the whole document (SPEC.md §6, Voice): the button beside
// Collapse reads the document from the block at the reading position to the
// end, block by block, in the voice the selection's Read aloud uses
// (POST /api/speech: the free Edge voice, then Gemini's, then OpenAI TTS;
// the browser voice when the route answers 503, and for the rest of the
// reading after that, so no block waits on a server that cannot read). The next two blocks' audio is fetched while
// one plays, so the reading runs on without gaps. The block being read
// carries the read-aloud mark, drawn over the pane, never in the text, and
// the pane follows it while the reader has not scrolled away.

/** The blocks that are read: words, not figures, code, tables, or math. */
const READ_TYPES = new Set(["PARAGRAPH", "HEADING", "LIST"]);
/** /api/speech takes at most 4096 characters; a longer block is read in pieces. */
const MAX_PIECE_CHARS = 3500;
/** The blocks fetched ahead of the one playing. */
const PREFETCH = 2;

export type ReadPiece = { blockId: string; text: string };
export type ReadAloudState = "idle" | "loading" | "playing" | "paused";

/** Whether the document has words to read. */
export function hasReadableBlocks(blocks: { type: string; text: string }[]): boolean {
  return blocks.some((b) => READ_TYPES.has(b.type) && b.text.trim().length > 0);
}

/** The pieces read from the block `fromId` (the first block when absent or
    not found) to the end: one per block, a long block cut at its sentence
    ends into pieces of at most MAX_PIECE_CHARS. */
export function readPieces(blocks: { id: string; type: string; text: string }[], fromId: string | null): ReadPiece[] {
  const start = Math.max(0, fromId ? blocks.findIndex((b) => b.id === fromId) : 0);
  const pieces: ReadPiece[] = [];
  for (const block of blocks.slice(start)) {
    if (!READ_TYPES.has(block.type)) continue;
    const text = spoken(block.type, block.text);
    if (!text) continue;
    for (const part of cut(text)) pieces.push({ blockId: block.id, text: part });
  }
  return pieces;
}

/** A block's words as the voice reads them: a list's bullets go, and each
    item ends with a stop, so the items do not run together. */
function spoken(type: string, text: string): string {
  if (type !== "LIST") return text.replace(/\s+/g, " ").trim();
  return text
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•◦▪]\s+/, "").trim())
    .filter(Boolean)
    .map((line) => (/[.!?;:,。！？；：，]$/.test(line) ? line : `${line}.`))
    .join(" ");
}

function cut(text: string): string[] {
  if (text.length <= MAX_PIECE_CHARS) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_PIECE_CHARS) {
    const window = rest.slice(0, MAX_PIECE_CHARS);
    const end = Math.max(window.lastIndexOf(". "), window.lastIndexOf("。"), window.lastIndexOf("? "), window.lastIndexOf("! "));
    const at = end > MAX_PIECE_CHARS / 2 ? end + 1 : window.lastIndexOf(" ") > 0 ? window.lastIndexOf(" ") : MAX_PIECE_CHARS;
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest) parts.push(rest);
  return parts;
}

type Clip = { url: string } | { browser: true };

/** A short silent sound: played on the button's press, it lets the audio
    element play the pieces that arrive later (Safari plays sound only from a
    press, and the element keeps that leave). */
function silence(): string {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => [...s].forEach((c, i) => (bytes[at + i] = c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);
  bytes.fill(128, 44);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

export function useReadAloud({
  onError,
  failedLine,
  unavailableLine,
}: {
  /** A piece failed and the reading stopped: the reason. */
  onError: (message: string) => void;
  /** The failure line for a status the route gave no reason for. */
  failedLine: (status: number) => string;
  /** The line when the browser has no voice either. */
  unavailableLine: string;
}) {
  const [state, setState] = useState<ReadAloudState>("idle");
  const [blockId, setBlockId] = useState<string | null>(null);
  const run = useRef(0);
  const pieces = useRef<ReadPiece[]>([]);
  const clips = useRef(new Map<number, Promise<Clip>>());
  // The pieces whose audio has arrived: the button shows no spinner for them.
  const ready = useRef(new Set<number>());
  const audio = useRef<HTMLAudioElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const paused = useRef(false);
  // What plays now: the audio element, the browser voice, or nothing yet.
  const playing = useRef<"audio" | "browser" | null>(null);
  // playFrom calls itself for the next piece, through this ref.
  const playRef = useRef<(i: number, r: number) => Promise<void>>(async () => {});
  const onErrorRef = useRef(onError);
  const failedLineRef = useRef(failedLine);
  const unavailableRef = useRef(unavailableLine);
  // The route answered 503 once: the browser voice reads the rest.
  const browserOnly = useRef(false);
  useEffect(() => {
    onErrorRef.current = onError;
    failedLineRef.current = failedLine;
    unavailableRef.current = unavailableLine;
  });

  const release = useCallback(() => {
    for (const clip of clips.current.values()) {
      void clip.then((c) => "url" in c && URL.revokeObjectURL(c.url)).catch(() => {});
    }
    clips.current.clear();
    ready.current.clear();
  }, []);

  const stop = useCallback(() => {
    run.current += 1;
    abort.current?.abort();
    abort.current = null;
    const el = audio.current;
    if (el) {
      el.onended = null;
      el.onerror = null;
      el.pause();
      if (el.src.startsWith("blob:")) URL.revokeObjectURL(el.src);
    }
    if (playing.current === "browser") window.speechSynthesis?.cancel();
    playing.current = null;
    paused.current = false;
    release();
    pieces.current = [];
    setState("idle");
    setBlockId(null);
  }, [release]);

  const clipFor = useCallback((i: number, signal: AbortSignal): Promise<Clip> => {
    const known = clips.current.get(i);
    if (known) return known;
    const piece = pieces.current[i];
    const clip = (async (): Promise<Clip> => {
      if (browserOnly.current) return { browser: true };
      const res = await fetch("/api/speech", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: piece.text }),
        signal,
      });
      if (res.status === 503) {
        browserOnly.current = true;
        return { browser: true };
      }
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? failedLineRef.current(res.status));
      }
      return { url: URL.createObjectURL(await res.blob()) };
    })();
    // A prefetched clip that fails says so when its turn comes.
    clip.then(() => ready.current.add(i)).catch(() => {});
    clips.current.set(i, clip);
    return clip;
  }, []);

  const playFrom = useCallback(
    async (i: number, r: number): Promise<void> => {
      if (r !== run.current) return;
      const signal = abort.current?.signal;
      if (!signal) return;
      if (i >= pieces.current.length) {
        stop();
        return;
      }
      setBlockId(pieces.current[i].blockId);
      if (!paused.current && !ready.current.has(i)) setState("loading");
      const current = clipFor(i, signal);
      for (let k = i + 1; k <= i + PREFETCH && k < pieces.current.length; k++) clipFor(k, signal);
      let clip: Clip;
      try {
        clip = await current;
      } catch (err) {
        if (r !== run.current) return;
        stop();
        onErrorRef.current(err instanceof Error && err.message ? err.message : failedLineRef.current(0));
        return;
      }
      if (r !== run.current) return;
      clips.current.delete(i);
      const next = () => {
        if (r === run.current) void playRef.current(i + 1, r);
      };
      if ("browser" in clip) {
        const synth = window.speechSynthesis;
        const utterances = synth ? browserUtterances(pieces.current[i].text) : [];
        const last = utterances[utterances.length - 1];
        if (!synth || !last) {
          stop();
          onErrorRef.current(unavailableRef.current);
          return;
        }
        // The piece ends once: at its last sentence, or at an error, which
        // drops the sentences left so they never overlap the next piece.
        let ended = false;
        const end = () => {
          if (ended) return;
          ended = true;
          next();
        };
        last.onend = end;
        for (const u of utterances) {
          u.onerror = () => {
            if (r !== run.current) return;
            synth.cancel();
            end();
          };
        }
        playing.current = "browser";
        for (const u of utterances) synth.speak(u);
        if (paused.current) synth.pause();
        else setState("playing");
        return;
      }
      const el = audio.current;
      if (!el) return;
      el.onended = () => {
        URL.revokeObjectURL(clip.url);
        next();
      };
      el.onerror = () => {
        URL.revokeObjectURL(clip.url);
        next();
      };
      el.src = clip.url;
      playing.current = "audio";
      if (paused.current) return;
      try {
        await el.play();
        if (r === run.current) setState("playing");
      } catch {
        // The browser refused the sound (no press it counts): wait for Resume.
        if (r !== run.current) return;
        paused.current = true;
        setState("paused");
      }
    },
    [clipFor, stop],
  );
  useEffect(() => {
    playRef.current = playFrom;
  }, [playFrom]);

  /** Read `list` from its first piece. Called from the button's press. */
  const start = useCallback(
    (list: ReadPiece[]) => {
      stop();
      if (list.length === 0) return;
      const r = run.current;
      pieces.current = list;
      browserOnly.current = false;
      abort.current = new AbortController();
      audio.current ??= new Audio();
      const el = audio.current;
      const quiet = silence();
      el.src = quiet;
      void el.play().catch(() => {}).finally(() => URL.revokeObjectURL(quiet));
      // Warm the browser's voice list: the 503 fallback needs it loaded.
      window.speechSynthesis?.getVoices();
      void playFrom(0, r);
    },
    [playFrom, stop],
  );

  const pause = useCallback(() => {
    paused.current = true;
    if (playing.current === "audio") audio.current?.pause();
    if (playing.current === "browser") window.speechSynthesis?.pause();
    setState("paused");
  }, []);

  const resume = useCallback(() => {
    paused.current = false;
    const r = run.current;
    if (playing.current === "audio") {
      void audio.current
        ?.play()
        .then(() => r === run.current && setState("playing"))
        .catch(() => {});
      return;
    }
    if (playing.current === "browser") {
      window.speechSynthesis?.resume();
      setState("playing");
      return;
    }
    setState("loading");
  }, []);

  // The document closes, or the pane goes: the reading stops.
  useEffect(() => stop, [stop]);

  return { state, blockId, start, pause, resume, stop };
}

/** The block being read: a soft tint with a bar at its left, over the pane
    (the text itself is never touched, so the page editor's words stay as
    they are). The pane follows the reading: a new block below the pane's
    foot or above its top scrolls to the reading line, unless the reader
    scrolled away from the block before it. */
export function ReadAloudMark({ container, blockId }: { container: RefObject<HTMLElement | null>; blockId: string }) {
  const [box, setBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const followed = useRef<string | null>(null);

  useLayoutEffect(() => {
    const pane = container.current;
    if (!pane) return;
    const find = () => pane.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
    const measure = () => {
      const el = find();
      if (!el || el.getClientRects().length === 0) {
        setBox(null);
        return;
      }
      const p = pane.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const next = {
        top: Math.round(r.top - p.top + pane.scrollTop - 4),
        left: Math.round(r.left - p.left + pane.scrollLeft - 10),
        width: Math.round(r.width + 20),
        height: Math.round(r.height + 8),
      };
      setBox((b) => (b && b.top === next.top && b.left === next.left && b.width === next.width && b.height === next.height ? b : next));
    };
    measure();
    const el = find();
    if (el && followed.current !== blockId) {
      const p = pane.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const out = r.top < p.top || r.bottom > p.bottom;
      const wasFollowing = followed.current === null || followedInView(pane, followed.current);
      if (out && wasFollowing) {
        pane.scrollTo({ top: r.top - p.top + pane.scrollTop - READING_LINE_PX, behavior: "smooth" });
      }
      followed.current = blockId;
    }
    const sizes = new ResizeObserver(measure);
    sizes.observe(pane);
    if (el) sizes.observe(el);
    // Text above the block may grow or shrink while it is read.
    const timer = window.setInterval(measure, 1000);
    return () => {
      sizes.disconnect();
      window.clearInterval(timer);
    };
  }, [container, blockId]);

  if (!box) return null;
  return (
    <div
      aria-hidden
      data-read-aloud-mark
      className="pointer-events-none absolute z-[5] rounded-lg bg-clay/10 print:hidden"
      style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
    >
      <span className="absolute top-1 bottom-1 left-0 w-[3px] rounded-full bg-clay" />
    </div>
  );
}

/** Whether the block read before is still in the pane: the reader is
    following the reading. */
function followedInView(pane: HTMLElement, blockId: string): boolean {
  const el = pane.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(blockId)}"]`);
  if (!el) return true;
  const p = pane.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return r.bottom > p.top && r.top < p.bottom;
}
