// The browser's own voice (speechSynthesis), which reads when /api/speech
// cannot: the selection's Read aloud and the document's Read aloud both
// fall back to it. Client only.

/** The language a text is read in: Chinese characters → zh-CN, else en-US. */
export function speechLang(text: string): string {
  return /[一-鿿]/.test(text) ? "zh-CN" : "en-US";
}

/** The most natural voice the browser has for the language. The default is
    often robotic; neural voices ("Natural", Edge) rank first, then Google's,
    then premium local ones, then any voice matching the language. */
export function pickBrowserVoice(lang: string): SpeechSynthesisVoice | null {
  const prefix = lang.split("-")[0];
  const candidates = (window.speechSynthesis?.getVoices() ?? []).filter((v) =>
    v.lang.replace("_", "-").toLowerCase().startsWith(prefix),
  );
  const score = (v: SpeechSynthesisVoice) => {
    const name = v.name.toLowerCase();
    if (name.includes("natural") || name.includes("online")) return 4;
    if (name.includes("google")) return 3;
    if (name.includes("premium") || name.includes("enhanced") || name.includes("siri")) return 2;
    if (v.lang.replace("_", "-").toLowerCase() === lang.toLowerCase()) return 1;
    return 0;
  };
  return candidates.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Chrome's online voices stop after about 15 seconds of one utterance,
    so a text is spoken in sentences of at most this many characters. */
const MAX_UTTERANCE_CHARS = 220;

/** `text` as utterances in its language, with the most natural voice: one
    per sentence, a long sentence cut at its last space. speechSynthesis
    queues them, so speaking them all reads the text through; the last
    one's end is the text's end. */
export function browserUtterances(text: string): SpeechSynthesisUtterance[] {
  const lang = speechLang(text);
  const voice = pickBrowserVoice(lang);
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

/** Speak `text` with the browser voice, a sentence at a time, past Chrome's
    known stalls: the voice list is loaded first; a voice still speaking is
    cancelled, and the next speak waits a moment, since Chrome can drop a
    speak that comes right after a cancel; a pause left over is resumed.
    `onEnd` runs once, after the last sentence or at the first error (the
    sentences left are dropped). False when the browser has no voice. */
export async function speakText(
  text: string,
  { onEnd, onStart }: { onEnd: (error: boolean) => void; onStart?: () => void },
): Promise<boolean> {
  const synth = typeof window === "undefined" ? undefined : window.speechSynthesis;
  if (!synth) return false;
  await voicesReady(synth);
  const utterances = browserUtterances(text);
  const last = utterances[utterances.length - 1];
  if (!last) return false;
  if (synth.speaking || synth.pending) {
    synth.cancel();
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  synth.resume();
  let ended = false;
  const end = (error: boolean) => {
    if (ended) return;
    ended = true;
    if (error) synth.cancel();
    if (held === utterances) held = [];
    onEnd(error);
  };
  utterances[0].onstart = () => onStart?.();
  last.onend = () => end(false);
  for (const u of utterances) u.onerror = (e) => {
    // A cancel by the reader (Stop) is not an error of the text.
    if (e.error === "interrupted" || e.error === "canceled") return;
    end(true);
  };
  held = utterances;
  for (const u of utterances) synth.speak(u);
  return true;
}

