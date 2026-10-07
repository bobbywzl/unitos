"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLang } from "@/components/lang-provider";
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

/** Voice typing's listening (lib/voice-typing.ts): start and stop the
    browser's speech service, the words heard so far, and the trouble it
    reports. Each final phrase goes to `onFinal`. Listening goes on through
    pauses until the reader stops it, and stops when the surface closes. */
export function useSpeech(onFinal: (phrase: string, english: boolean) => void) {
  const appLang = useLang();
  const language = useSyncExternalStore(
    subscribeLanguage,
    () => readVoiceLanguage(appLang),
    () => (appLang === "zh" ? "zh-CN" : "en-US"),
  );
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState<SpeechStatus>("");
  const [interim, setInterim] = useState("");
  const recRef = useRef<Recognition | null>(null);
  const wantRef = useRef(false);
  const onFinalRef = useRef(onFinal);
  useEffect(() => {
    onFinalRef.current = onFinal;
  }, [onFinal]);

  const stop = useCallback(() => {
    wantRef.current = false;
    recRef.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback((): boolean => {
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
  }, [language]);

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
    },
    [],
  );

  return { listening, status, setStatus, interim, language, setLanguage, start, stop };
}
