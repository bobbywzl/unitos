"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type Ref,
  type TextareaHTMLAttributes,
} from "react";

// A box that keeps its own words while the reader types (SPEC.md §6): a key
// renders the box alone, never the surface around it (the reader, a card,
// the panel). The surface gets the words through onCommit: at most every
// 300 ms while the reader types, at once when the box turns empty or not
// empty, or equal to or different from `saved` (so Send and Save turn on
// and off with the key that changes them), on blur, before the box's own
// Enter or Escape handler runs, when the page closes, and when the box goes.
// persist, called with every commit, writes the words to storage at once,
// for a surface whose own draft keeping waits for a render that may never
// come (a card closed in the same press). A new value from the surface
// (sent, cleared, put back after a failure, a draft restored) replaces the
// words.

export type KeptFieldHandle = {
  /** The words in the box now, committed or not. */
  value: () => string;
  /** Hand the words to the surface now. */
  commit: () => void;
};

const COMMIT_MS = 300;

type Kept = {
  value: string;
  onCommit: (text: string) => void;
  persist?: (text: string) => void;
  saved?: string;
  handle?: Ref<KeptFieldHandle>;
};

function useKept({ value, onCommit, persist, saved, handle }: Kept) {
  const [text, setText] = useState(value);
  // The surface's value as last seen, and the words last handed to it: a
  // value that differs from both came from the surface, and takes the box.
  const [seen, setSeen] = useState(value);
  const [committed, setCommitted] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (value !== committed) {
      setText(value);
      setCommitted(value);
    }
  }
  const live = useRef(value);
  const sent = useRef(value);
  useEffect(() => {
    live.current = text;
  }, [text]);
  useEffect(() => {
    sent.current = committed;
  }, [committed]);
  const timer = useRef<number | null>(null);
  const hooks = useRef({ onCommit, persist, saved });
  useEffect(() => {
    hooks.current = { onCommit, persist, saved };
  });
  const commitNow = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    if (live.current === sent.current) return;
    sent.current = live.current;
    setCommitted(live.current);
    hooks.current.onCommit(live.current);
    hooks.current.persist?.(live.current);
  };
  const commitRef = useRef(commitNow);
  useEffect(() => {
    commitRef.current = commitNow;
  });
  const change = (next: string) => {
    const base = hooks.current.saved?.trim();
    const flipped =
      !next.trim() !== !live.current.trim() ||
      (base !== undefined && (next.trim() === base) !== (live.current.trim() === base));
    live.current = next;
    setText(next);
    if (flipped) {
      commitNow();
      return;
    }
    timer.current ??= window.setTimeout(() => {
      timer.current = null;
      commitRef.current();
    }, COMMIT_MS);
  };
  useImperativeHandle(handle, () => ({ value: () => live.current, commit: () => commitRef.current() }), []);
  // The page closes, or the box goes: the words go over now.
  useEffect(() => {
    const onHide = () => commitRef.current();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      commitRef.current();
    };
  }, []);
  return { text, change, commitNow };
}

// Enter (without Shift) and Escape hand the words over before the box's
// own handler runs, so the handler reads the surface's state as typed.
function committingKeys<E extends HTMLTextAreaElement | HTMLInputElement>(
  commitNow: () => void,
  onKeyDown: ((e: KeyboardEvent<E>) => void) | undefined,
) {
  return (e: KeyboardEvent<E>) => {
    if ((e.key === "Enter" && !e.shiftKey) || e.key === "Escape") commitNow();
    onKeyDown?.(e);
  };
}

type AreaProps = Kept &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue" | "onChange"> & {
    fieldRef?: Ref<HTMLTextAreaElement>;
    /** Every change, after the box took it: for a caller that clears an error line. */
    onType?: (text: string) => void;
  };

/** A textarea that keeps its own words (see above). */
export function KeptTextarea({
  value,
  onCommit,
  persist,
  saved,
  handle,
  fieldRef,
  onType,
  onKeyDown,
  onBlur,
  ...rest
}: AreaProps) {
  const { text, change, commitNow } = useKept({ value, onCommit, persist, saved, handle });
  return (
    <textarea
      {...rest}
      ref={fieldRef}
      value={text}
      onChange={(e) => {
        change(e.target.value);
        onType?.(e.target.value);
      }}
      onKeyDown={committingKeys(commitNow, onKeyDown)}
      onBlur={(e) => {
        commitNow();
        onBlur?.(e);
      }}
    />
  );
}

type InputProps = Kept &
  Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "defaultValue" | "onChange"> & {
    fieldRef?: Ref<HTMLInputElement>;
  };

/** An input that keeps its own words (see above). */
export function KeptInput({ value, onCommit, persist, saved, handle, fieldRef, onKeyDown, onBlur, ...rest }: InputProps) {
  const { text, change, commitNow } = useKept({ value, onCommit, persist, saved, handle });
  return (
    <input
      {...rest}
      ref={fieldRef}
      value={text}
      onChange={(e) => change(e.target.value)}
      onKeyDown={committingKeys(commitNow, onKeyDown)}
      onBlur={(e) => {
        commitNow();
        onBlur?.(e);
      }}
    />
  );
}
