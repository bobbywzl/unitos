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

/** An utterance of `text` in its language, with the most natural voice. */
export function browserUtterance(text: string): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = speechLang(text);
  const voice = pickBrowserVoice(utterance.lang);
  if (voice) utterance.voice = voice;
  return utterance;
}
