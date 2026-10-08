"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Extract's question box keeps a draft (SPEC.md §4, §13): the words typed in
// it go to localStorage at most every 300 ms, and at once when the page
// closes or the box goes, under `unitos-extract-draft:<scope>` (scope: the
// document, or the project for the project's Extract). A reload, a crash, a
// failed or stopped question, or a deploy never throws them away; the draft
// clears when the extraction for that question lands.

const PREFIX = "unitos-extract-draft:";
const WRITE_MS = 300;

function read(scope: string): string {
  try {
    return localStorage.getItem(PREFIX + scope) ?? "";
  } catch {
    return "";
  }
}

function write(scope: string, text: string) {
  try {
    if (text.trim()) localStorage.setItem(PREFIX + scope, text);
    else localStorage.removeItem(PREFIX + scope);
  } catch {
    // Storage blocked or full: the box still holds the words on screen.
  }
}

/** The extraction for `question` landed: its draft goes, unless the box
    holds other words by now. */
export function clearExtractDraft(scope: string, question: string) {
  try {
    const held = localStorage.getItem(PREFIX + scope);
    if (held !== null && held.trim() === question.trim()) localStorage.removeItem(PREFIX + scope);
  } catch {
    // Nothing kept, nothing to clear.
  }
}

/** The box's words, kept as a draft. change: the reader typed; flush: write
    the draft now (before a run starts, so a crash mid-run keeps it). */
export function useExtractDraft(scope: string) {
  const [text, setText] = useState(() => (typeof window === "undefined" ? "" : read(scope)));
  const pending = useRef<string | null>(null);
  const timer = useRef<number | null>(null);
  const flush = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (pending.current === null) return;
    write(scope, pending.current);
    pending.current = null;
  }, [scope]);
  const change = useCallback(
    (next: string) => {
      setText(next);
      pending.current = next;
      timer.current ??= window.setTimeout(flush, WRITE_MS);
    },
    [flush],
  );
  useEffect(() => {
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [flush]);
  return { text, change, flush };
}
