import { recognitionCtor } from "@/lib/voice-typing";

// Voice typing through the voice model (SPEC.md §6, voice typing). The
// browser records what the reader says and cuts the recording at each pause;
// each phrase goes to POST /api/speech/transcribe, which answers its words,
// and the words are handed on in the order they were said. So the words land
// a moment after each pause, punctuated, in whatever language was spoken.
//
// Why phrases and not a live stream: the model's streaming door is a
// WebSocket opened with the provider's key, which has to stay on a server,
// and the app's host runs no WebSocket server. A phrase is a plain request.
//
// Each phrase is recorded by its own MediaRecorder, so every upload is a
// whole file. The cut falls in a silence, so no word is lost between two
// recorders.

/** What this deploy can do with speech: `model` when the voice model is set,
    `any` when some transcription provider is. Asked once per page. */
export type SpeechService = { model: boolean; any: boolean };

let service: SpeechService | null = null;
let asking: Promise<SpeechService | null> | null = null;

/** Ask the server, once; later calls answer from the first. A failed ask is
    asked again next time. */
export function askSpeechService(): Promise<SpeechService | null> {
  if (service) return Promise.resolve(service);
  asking ??= fetch("/api/speech/transcribe")
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<SpeechService>;
      service = { model: body.model === true, any: body.any === true };
      return service;
    })
    .catch(() => null)
    .finally(() => {
      asking = null;
    });
  return asking;
}

function canRecord(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined" &&
    typeof AudioContext !== "undefined"
  );
}

/** Voice typing goes through the model: the voice model is set, or the
    browser has no speech service of its own (Firefox, the app's web view)
    and some provider can write a recording out. False until the server has
    answered: the browser's own service is used meanwhile, as before. */
export function dictatesByModel(): boolean {
  if (!service || !canRecord()) return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  return service.model || (service.any && recognitionCtor() === null);
}

/** Voice typing can run at all here: by the model, or by the browser. */
export function voiceTypingAvailable(): boolean {
  return dictatesByModel() || recognitionCtor() !== null;
}

function recordingMime(): string | undefined {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"].find((m) =>
    MediaRecorder.isTypeSupported(m),
  );
}

// How the recording is cut.
const TICK_MS = 50;
/** A silence this long after speech ends the phrase. */
const PAUSE_MS = 700;
/** A phrase is cut at this length even with no pause. */
const PHRASE_MAX_MS = 25_000;
/** A recorder that has heard nothing for this long starts over, so a phrase
    never begins with a long silence. */
const QUIET_RESTART_MS = 4_000;
/** Speech shorter than this is a click or a cough: nothing is sent. */
const SPEECH_MIN_MS = 150;
/** The level over which the microphone hears speech, and how far over the
    room's own noise it must be. */
const LEVEL_FLOOR = 0.012;
const OVER_NOISE = 3;
const BITS_PER_SECOND = 32_000;

export type DictationEvents = {
  /** A phrase written out. Called in the order the phrases were said. */
  onText: (text: string) => void;
  /** Words are on their way (a phrase is being said or written out), or not. */
  onPending: (pending: boolean) => void;
  /** A phrase could not be written out. */
  onTrouble: () => void;
};

export class Dictation {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private listening = false;
  private gone = false;
  // The phrase being recorded.
  private startedAt = 0;
  private lastSpeechAt = 0;
  private speechMs = 0;
  private noise = 0.004;
  // The phrases sent and not yet handed on, in order.
  private tail: Promise<void> = Promise.resolve();
  private sending = 0;
  private abort = new AbortController();

  constructor(
    private readonly language: string,
    private readonly events: DictationEvents,
  ) {}

  /** Open the microphone and listen. False when the reader refused it or
      the browser cannot record. */
  async start(): Promise<boolean> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch {
      return false;
    }
    if (this.gone) {
      this.release();
      return false;
    }
    try {
      this.context = new AudioContext();
      const source = this.context.createMediaStreamSource(this.stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      source.connect(this.analyser);
      this.samples = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
      this.listening = true;
      this.record();
    } catch {
      this.release();
      return false;
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
    return true;
  }

  /** Stop listening. The phrase being said is written out and handed on;
      the promise ends when every phrase has been. */
  async stop(): Promise<void> {
    if (!this.listening) return this.tail;
    this.listening = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.cut();
    this.release();
    await this.tail;
  }

  /** Write out what has been said so far, now, and go on listening. The
      promise ends when every phrase said before the call has been handed on. */
  async flush(): Promise<void> {
    if (this.listening && this.heardSpeech()) await this.cut();
    await this.tail;
  }

  /** Words are on their way: a phrase is being said or written out. */
  pending(): boolean {
    return this.sending > 0 || (this.listening && this.heardSpeech());
  }

  /** The surface closed: the microphone turns off and nothing more is handed on. */
  dispose(): void {
    this.gone = true;
    this.listening = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.abort.abort();
    const recorder = this.recorder;
    this.recorder = null;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.stop();
    }
    this.release();
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close().catch(() => {});
    this.context = null;
    this.analyser = null;
  }

  private heardSpeech(): boolean {
    return this.speechMs >= SPEECH_MIN_MS;
  }

  /** Start recording a new phrase on the open microphone. */
  private record(): void {
    if (!this.stream) return;
    const mimeType = recordingMime();
    const recorder = new MediaRecorder(this.stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: BITS_PER_SECOND,
    });
    this.chunks = [];
    const chunks = this.chunks;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    this.recorder = recorder;
    this.startedAt = performance.now();
    this.lastSpeechAt = 0;
    this.speechMs = 0;
    recorder.start();
  }

  private level(): number {
    if (!this.analyser || !this.samples) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.analyser.fftSize; i++) sum += this.samples[i] * this.samples[i];
    return Math.sqrt(sum / this.analyser.fftSize);
  }

  private tick(): void {
    if (!this.listening || !this.recorder) return;
    const now = performance.now();
    const level = this.level();
    const speaking = level > Math.max(LEVEL_FLOOR, this.noise * OVER_NOISE);
    if (speaking) {
      const was = this.pending();
      this.speechMs += TICK_MS;
      this.lastSpeechAt = now;
      if (!was && this.pending()) this.events.onPending(true);
    } else {
      // The room's own noise, learned from the quiet between words.
      this.noise = this.noise * 0.95 + level * 0.05;
    }
    if (this.heardSpeech()) {
      if (now - this.lastSpeechAt >= PAUSE_MS || now - this.startedAt >= PHRASE_MAX_MS) void this.cut();
    } else if (now - this.startedAt >= QUIET_RESTART_MS) {
      void this.cut();
    }
  }

  /** End the phrase being recorded: send it when speech was heard in it, and
      start the next one while listening goes on. The promise ends when the
      phrase is on its way (or dropped). */
  private cut(): Promise<void> {
    const recorder = this.recorder;
    if (!recorder || recorder.state === "inactive") return Promise.resolve();
    const spoke = this.heardSpeech();
    const chunks = this.chunks;
    this.recorder = null;
    return new Promise<void>((resolve) => {
      recorder.onstop = () => {
        if (spoke && !this.gone) this.send(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        resolve();
      };
      recorder.stop();
      if (this.listening) this.record();
      else this.speechMs = 0;
    });
  }

  /** Send a phrase now; hand its words on after the phrases before it. */
  private send(blob: Blob): void {
    if (blob.size === 0) return;
    this.sending++;
    this.events.onPending(true);
    const request = this.write(blob);
    this.tail = this.tail.then(async () => {
      const text = await request;
      this.sending--;
      if (this.gone) return;
      if (text === null) this.events.onTrouble();
      else if (text) this.events.onText(text);
      this.events.onPending(this.pending());
    });
  }

  /** The words of one phrase; "" when nothing was said in it, null when it
      could not be written out. */
  private async write(blob: Blob): Promise<string | null> {
    try {
      const res = await fetch(`/api/speech/transcribe?language=${encodeURIComponent(this.language)}`, {
        method: "POST",
        headers: { "Content-Type": blob.type || "audio/webm" },
        body: blob,
        signal: this.abort.signal,
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { text?: unknown };
      return typeof body.text === "string" ? body.text.trim() : "";
    } catch {
      return null;
    }
  }
}
