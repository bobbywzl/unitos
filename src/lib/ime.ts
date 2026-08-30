"use client";

import { useCallback, useMemo, useRef } from "react";

/** Guard for Enter-submit inputs while an IME composes (pinyin, kana, hangul).
    The Enter that picks a candidate must never send or submit. Chrome and
    Firefox flag that keydown with isComposing (keyCode 229); Safari fires
    compositionend first and then a plain Enter keydown, so an Enter landing
    right after compositionend is still the IME's.

    Usage — spread the composition props and check Enter first:
      const ime = useImeGuard();
      <textarea
        {...ime.props}
        onKeyDown={(e) => {
          if (ime.isImeEnter(e)) return; // inside a <form> with an <input>: e.preventDefault() too
          if (e.key === "Enter") submit();
        }}
      />

    One instance serves every input in a component: only one composes at a time. */
export function useImeGuard() {
  const composing = useRef(false);
  const endedAt = useRef(0);

  const onCompositionStart = useCallback(() => {
    composing.current = true;
  }, []);
  const onCompositionEnd = useCallback((e: React.CompositionEvent) => {
    composing.current = false;
    endedAt.current = e.timeStamp;
  }, []);

  /** True when this Enter keydown belongs to the IME. */
  const isImeEnter = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return false;
    if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229)
      return true;
    // Safari: the committing Enter's keydown arrives right after compositionend.
    return e.timeStamp - endedAt.current < 50;
  }, []);

  const props = useMemo(() => ({ onCompositionStart, onCompositionEnd }), [
    onCompositionStart,
    onCompositionEnd,
  ]);

  return { props, isImeEnter };
}
