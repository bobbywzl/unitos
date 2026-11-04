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

// macOS ships joke voices beside its real ones (a bleating sheep, a dying
// bubble, a robot): never read with them.
const NOVELTY_VOICES = new Set(
  [
    "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos", "deranged", "good news",
    "hysterical", "jester", "organ", "pipe organ", "superstar", "trinoids", "whisper", "wobble",
    "zarvox", "fred", "junior", "kathy", "ralph", "princess", "agnes", "bruce", "vicki", "victoria",
  ],
);
// The standard voices that read well, the voices a Mac and Windows ship.
const GOOD_VOICES =
  /\b(samantha|alex|allison|ava|susan|tom|karen|daniel|moira|tessa|zoe|evan|nathan|joelle|noelle|serena|aaron|nicky|jenny|aria|guy|zira|david|mark|tingting|ting-ting|meijia|mei-jia|sinji|sin-ji|lili|yu-shu|xiaoxiao|yunxi|huihui|yaoyao|kangkang)\b/;

function voiceName(v: SpeechSynthesisVoice): string {
  return v.name.toLowerCase().replace(/\s*\(.*$/, "").trim();
}

/** The browser's voices for the language, best first, the joke voices left
    out: a natural, premium, or enhanced voice (Siri, Ava (Premium), Edge's
    Online (Natural)); then Chrome's Google voice, natural but online (it
    can make no sound on a Mac: speakText's watchdog moves on); then the
    standard voices that read well (Samantha, Alex, Tingting, ...); then
    the system's default; then the rest. */
export function rankedVoices(lang: string): SpeechSynthesisVoice[] {
  const prefix = lang.split("-")[0];
  const exact = lang.toLowerCase();
  const candidates = (window.speechSynthesis?.getVoices() ?? []).filter(
    (v) => v.lang.replace("_", "-").toLowerCase().startsWith(prefix) && !NOVELTY_VOICES.has(voiceName(v)),
  );
  const score = (v: SpeechSynthesisVoice) => {
    const name = v.name.toLowerCase();
    let s = 0;
    if (/premium|enhanced|siri|natural|neural/.test(name)) s = 40;
    else if (name.includes("google")) s = 30;
    else if (GOOD_VOICES.test(name)) s = 20;
    else if (v.default) s = 10;
    if (v.lang.replace("_", "-").toLowerCase() === exact) s += 2;
    if (v.localService) s += 1;
    return s;
  };
  return candidates.sort((a, b) => score(b) - score(a));
}

/** The best voice the browser has for the language (rankedVoices), or null:
    the browser's default. */
export function pickBrowserVoice(lang: string): SpeechSynthesisVoice | null {
  return rankedVoices(lang)[0] ?? null;
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
    spoken again in the next voice of rankedVoices; when that does not start
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
      // The next voice that reads well, never the browser's default, which
      // can be a joke voice.
      const others = rankedVoices(speechLang(text)).filter((v) => v !== voice);
      const next = others.find((v) => v.localService) ?? others[0] ?? null;
      console.warn(`[voice] ${voice?.name ?? "the default voice"} made no start; speaking again in ${next?.name ?? "the default voice"}`);
      void settle().then(() => {
        if (!ended) speak(next, false);
      });
    };
    watchdog = window.setTimeout(check, START_MS);
  };
  speak(pickBrowserVoice(speechLang(text)), true);
  return true;
}
