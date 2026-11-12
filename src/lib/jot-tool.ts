import { clientAppShell } from "@/lib/app-shell";
import { JOT_COLORS, type JotColor } from "@/lib/jottings";

// The Jot tool's state (SPEC.md §33), one for the browser: whether Jot is on,
// the pen or the eraser, the pen's color and width, and whether this browser
// has seen a pen. Kept in localStorage, so every pane and every tab shows the
// same pen. Jot starts on in the iPad app, where the pen is the Apple Pencil;
// everywhere else it starts off, and its button shows once a pen has touched
// the reader, so a reader with a mouse sees nothing new.

export type JotTool = "pen" | "eraser";

export type JotState = {
  on: boolean;
  tool: JotTool;
  color: JotColor;
  /** Index into JOT_WIDTHS_PX. */
  width: 0 | 1;
  penSeen: boolean;
};

const KEY = "unitos-jot";
const CHANGE_EVENT = "unitos:jot-change";

export const JOT_SERVER_STATE: JotState = { on: false, tool: "pen", color: "ink", width: 0, penSeen: false };

function initial(): JotState {
  const ipad = clientAppShell()?.device === "ipad";
  return { ...JOT_SERVER_STATE, on: ipad, penSeen: ipad };
}

let cached: { raw: string | null; state: JotState } | null = null;

export function readJot(): JotState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage is off (a private window): the state lives for the page.
    if (cached) return cached.state;
  }
  if (cached && cached.raw === raw) return cached.state;
  let state = initial();
  if (raw) {
    try {
      const stored = JSON.parse(raw) as Partial<JotState>;
      state = {
        on: typeof stored.on === "boolean" ? stored.on : state.on,
        tool: stored.tool === "eraser" ? "eraser" : "pen",
        color: JOT_COLORS.includes(stored.color as JotColor) ? (stored.color as JotColor) : state.color,
        width: stored.width === 1 ? 1 : 0,
        penSeen: stored.penSeen === true || state.penSeen,
      };
    } catch {
      // Unreadable: the defaults stand.
    }
  }
  cached = { raw, state };
  return state;
}

export function writeJot(patch: Partial<JotState>): void {
  const state = { ...readJot(), ...patch };
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(KEY, raw);
    cached = { raw, state };
  } catch {
    cached = { raw: cached?.raw ?? null, state };
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeJot(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}
