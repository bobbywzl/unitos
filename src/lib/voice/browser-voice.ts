// The browser's own voice (speechSynthesis), which reads when /api/speech
// cannot: the selection's Read aloud and the document's Read aloud both
// fall back to it. Client only.

/** How long a reading waits for /api/speech before the browser voice reads
    instead: a server voice that takes longer holds the reader in silence. */
export const SPEECH_WAIT_MS = 15_000;

/** The language a text is read in: Chinese characters → zh-CN, else en-US. */
export function speechLang(text: string): string {
  return /[一-鿿]/.test(text) ? "zh-CN" : "en-US";
}

/** The most natural voice the browser has for the language. A voice on the
    device ranks first: an online voice (Chrome's Google voices on a Mac
    above all) can take the speak and make no sound, and never end. Among
    the device's voices the premium ones (Premium, Enhanced, Siri, Natural)
    rank first, then the exact language; then the online voices. The
    browser's default is used when the language has none. */
export function pickBrowserVoice(lang: string): SpeechSynthesisVoice | null {
  const prefix = lang.split("-")[0];
  const candidates = (window.speechSynthesis?.getVoices() ?? []).filter((v) =>
    v.lang.replace("_", "-").toLowerCase().startsWith(prefix),
  );
  const score = (v: SpeechSynthesisVoice) => {
    const name = v.name.toLowerCase();
    let s = v.localService ? 10 : 0;
    if (name.includes("premium") || name.includes("enhanced") || name.includes("siri") || name.includes("natural")) s += 3;
    if (v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) s += 1;
    return s;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Chrome's online voices stop after about 15 seconds of one utterance,
    so a text is spoken in sentences of at most this many characters. */
const MAX_UTTERANCE_CHARS = 220;

/** `text` as utterances in its language: one per sentence, a long sentence
    cut at its last space, in `voice` (null: the browser's default).
    speechSynthesis queues them, so speaking them all reads the text
    through; the last one's end is the text's end. */
export function browserUtterances(text: string, voice: SpeechSynthesisVoice | null = pickBrowserVoice(speechLang(text))): SpeechSynthesisUtterance[] {
  const lang = speechLang(text);
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]*\s*/g) ?? [text];
  const parts: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence.trim();
    while (rest.length > MAX_UTTERANCE_CHARS) {
      const at = rest.lastIndexOf(" ", MAX_UTTERANCE_CHARS);
      const cut = at > MAX_UTTERANCE_CHARS / 2 ? at : MAX_UTTERANCE_CHARS;
      parts.push(rest.slice(0, cut));
      rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
  }
  return parts.map((part) => {
    const utterance = new SpeechSynthesisUtterance(part);
    utterance.lang = lang;
    if (voice) utterance.voice = voice;
    return utterance;
  });
}

/** The utterances being spoken: held here, because Chrome can drop an
    utterance nothing holds before it ends, and its end event with it. */
let held: SpeechSynthesisUtterance[] = [];

/** A voice that has not started this long after the speak is taken as
    silent: the speak runs again in the browser's default voice. */
const START_MS = 2500;

/** The voice list, loaded: Chrome fills it after the page starts and says
    so with voiceschanged. Waits at most 1.5 s; an empty list still speaks,
    in the default voice. */
function voicesReady(synth: SpeechSynthesis): Promise<void> {
  if (synth.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, 1500);
    synth.addEventListener("voiceschanged", done);
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 80));

/** Speak `text` with the browser voice, a sentence at a time, past Chrome's
    known stalls: the voice list is loaded first; a voice still speaking is
    cancelled, and the next speak waits a moment, since Chrome can drop a
    speak that comes right after a cancel; a pause left over is resumed. A
    voice that has not started within START_MS is cancelled and the text is
    spoken again in the browser's default voice; when that does not start
    either, the speak ends with an error. `onEnd` runs once, after the last
    sentence, or with `true` at an error (the sentences left are dropped).
    False when the browser has no voice. */
export async function speakText(
  text: string,
  { onEnd }: { onEnd: (error: boolean) => void },
): Promise<boolean> {
  const synth = typeof window === "undefined" ? undefined : window.speechSynthesis;
  if (!synth) return false;
  await voicesReady(synth);
  if (browserUtterances(text).length === 0) return false;
  if (synth.speaking || synth.pending) {
    synth.cancel();
    await settle();
  }
  synth.resume();
  let ended = false;
  let started = false;
  let watchdog = 0;
  const end = (error: boolean) => {
    if (ended) return;
    ended = true;
    clearTimeout(watchdog);
    if (error) synth.cancel();
    held = [];
    onEnd(error);
  };
  const speak = (voice: SpeechSynthesisVoice | null, retry: boolean) => {
    const utterances = browserUtterances(text, voice);
    const last = utterances[utterances.length - 1];
    for (const u of utterances) {
      u.onstart = () => {
        started = true;
        clearTimeout(watchdog);
      };
      u.onerror = (e) => {
        // A cancel (Stop, or the watchdog's retry) is not an error of the text.
        if (e.error === "interrupted" || e.error === "canceled") return;
        end(true);
      };
    }
    last.onend = () => {
      if (held === utterances) end(false);
    };
    held = utterances;
    for (const u of utterances) synth.speak(u);
    const check = () => {
      if (started || ended) return;
      // Paused by the reader before the first word: no start is due yet.
      if (synth.paused) {
        watchdog = window.setTimeout(check, START_MS);
        return;
      }
      synth.cancel();
      if (!retry) {
        end(true);
        return;
      }
      console.warn("[voice] the browser voice made no start; speaking again in the default voice");
      void settle().then(() => {
        if (!ended) speak(null, false);
      });
    };
    watchdog = window.setTimeout(check, START_MS);
  };
  speak(pickBrowserVoice(speechLang(text)), true);
  return true;
}
