"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLang } from "@/components/lang-provider";
import { askSpeechService, Dictation, dictatesByModel } from "@/lib/voice/dictation";
import {
  recognitionCtor,
  readVoiceLanguage,
  VOICE_LANG_EVENT,
  writeVoiceLanguage,
  type Recognition,
} from "@/lib/voice-typing";

export type SpeechStatus = "" | "unsupported" | "trouble" | "blocked";

function subscribeLanguage(onChange: () => void) {
  window.addEventListener(VOICE_LANG_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(VOICE_LANG_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Voice typing's listening (lib/voice-typing.ts): start and stop it, the
    words heard so far, and the trouble it reports. Each final phrase goes to
    `onFinal`. Listening goes on through pauses until the reader stops it,
    and stops when the surface closes.

    Two ways to listen, chosen at each start. With the voice model set on
    the server (lib/voice/dictation.ts) the page records, and each phrase is
    written out by the model after its pause: `written` is true, the words
    come punctuated, there are no words-so-far (`interim` stays empty), and
    `pending` says words are on their way. Otherwise the browser's own
    speech service listens, as it always did: `written` is false and
    `interim` carries the words so far. */
export function useSpeech(onFinal: (phrase: string, english: boolean, written?: boolean) => void) {
  const appLang = useLang();
  const language = useSyncExternalStore(
    subscribeLanguage,
    () => readVoiceLanguage(appLang),
    () => (appLang === "zh" ? "zh-CN" : "en-US"),
  );
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<SpeechStatus>("");
  const [interim, setInterimState] = useState("");
  const interimRef = useRef("");
  const setInterim = useCallback((heard: string) => {
    interimRef.current = heard;
    setInterimState(heard);
  }, []);
  const recRef = useRef<Recognition | null>(null);
  const dictationRef = useRef<Dictation | null>(null);
  const [pending, setPending] = useState(false);
  const wantRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  // What this deploy can do with speech is asked once per page, when the
  // first voice typing surface shows, so the answer is in before a press.
  useEffect(() => {
    void askSpeechService();
  }, []);

  const stop = useCallback(() => {
    wantRef.current = false;
    const dictation = dictationRef.current;
    if (dictation) {
      // The phrase being said is still written out and typed; the
      // microphone turns off now.
      setListening(false);
      void dictation.stop().then(() => {
        if (dictationRef.current !== dictation) return;
        dictationRef.current = null;
        setPending(false);
      });
      return;
    }
    recRef.current?.stop();
    setListening(false);
    setInterim("");
  }, [setInterim]);

  // The words still being heard go to `onFinal` now, as a final phrase: the
  // reader is about to close the box (a press elsewhere, Escape) and the
  // service would finalize them too late. The service then starts afresh, so
  // it never sends the same words a second time.
  // With the model the words are not here yet: the answer is a promise that
  // ends when every phrase said so far has gone to `onFinal`, and the caller
  // holds the press or the key until then. Nothing on its way: no promise.
  const flush = useCallback((): Promise<void> | undefined => {
    const dictation = dictationRef.current;
    if (dictation) return dictation.pending() ? dictation.flush() : undefined;
    const heard = interimRef.current.trim();
    if (!heard) return;
    setInterim("");
    onFinalRef.current(heard, language.startsWith("en"));
    if (wantRef.current) recRef.current?.abort();
  }, [language, setInterim]);

  const start = useCallback((): boolean => {
    if (dictatesByModel()) {
      recRef.current?.abort();
      const dictation = new Dictation(language, {
        // A phrase said before the reader turned the microphone off is still typed.
        onText: (text) => onFinalRef.current(text, language.startsWith("en"), true),
        onPending: (on) => {
          if (dictationRef.current === dictation) setPending(on);
        },
        onTrouble: () => {
          if (dictationRef.current === dictation) setStatus("trouble");
        },
      });
      dictationRef.current = dictation;
      wantRef.current = true;
      setPending(false);
      setListening(true);
      setStatus("");
      void dictation.start().then((ok) => {
        if (ok || dictationRef.current !== dictation) return;
        dictationRef.current = null;
        wantRef.current = false;
        setListening(false);
        setStatus("blocked");
      });
      return true;
    }
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setStatus("unsupported");
      return false;
    }
    recRef.current?.abort();
    const rec = new Ctor();
    rec.lang = language;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let heard = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) onFinalRef.current(result[0].transcript, language.startsWith("en"));
        else heard += result[0].transcript;
      }
      setInterim(heard);
      setStatus("");
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantRef.current = false;
        setStatus("blocked");
      } else if (e.error !== "aborted" && e.error !== "no-speech") {
        setStatus("trouble");
      }
    };
    rec.onend = () => {
      // The service stops after a pause; listening goes on until the reader stops it.
      if (wantRef.current && recRef.current === rec) {
        try {
          rec.start();
          return;
        } catch {
          // Could not restart: fall through and stop.
        }
      }
      if (recRef.current === rec) {
        setListening(false);
        setInterim("");
      }
    };
    recRef.current = rec;
    wantRef.current = true;
    try {
      rec.start();
      setListening(true);
      setStatus("");
      return true;
    } catch {
      wantRef.current = false;
      setStatus("trouble");
      return false;
    }
  }, [language, setInterim]);

  const setLanguage = useCallback(
    (code: string) => {
      writeVoiceLanguage(code);
      // The service listens in one language: a change stops it.
      if (wantRef.current) stop();
    },
    [stop],
  );

  // The surface closed: the microphone turns off.
  useEffect(
    () => () => {
      wantRef.current = false;
      recRef.current?.abort();
      recRef.current = null;
      dictationRef.current?.dispose();
      dictationRef.current = null;
    },
    [],
  );

  return { listening, status, setStatus, interim, pending, language, setLanguage, start, stop, flush };
}
