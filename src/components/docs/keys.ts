// Shortcut labels as Google Docs prints them (SPEC.md §29). A combo is
// written "Mod+Shift+7": Mod is Ctrl, or ⌘ on a Mac; "Ctrl" is Control on
// every platform. On a Mac a single character after ⌘ takes no plus ("⌘B"),
// anything longer does ("⌘+Shift+7"), and Alt is Option.

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

/** Keys Docs names in its key strings ("open-square-bracket"), so ⌘ takes a
    plus before them even though they print as one character. */
const NAMED = new Set(["[", "]", "=", "-"]);

/** "Mod+Shift+7" → "Ctrl+Shift+7" or "⌘+Shift+7". */
export function keys(combo: string): string {
  const parts = combo.split(/\+(?!$)/);
  if (!isMac()) return parts.map((p) => (p === "Mod" ? "Ctrl" : p)).join("+");
  const mac = parts.map((p) => (p === "Alt" ? "Option" : p));
  if (mac[0] === "Mod") {
    const rest = mac.slice(1);
    if (rest.length === 1 && [...rest[0]].length === 1 && !NAMED.has(rest[0])) return `⌘${rest[0]}`;
    return ["⌘", ...rest].join("+");
  }
  return mac.join("+");
}

/** A tooltip with its shortcut: "Bold (Ctrl+B)". */
export function withKeys(label: string, combo?: string): string {
  return combo ? `${label} (${keys(combo)})` : label;
}

/** The KeyboardEvent.code a combo's last key has, for keys the layout or
    Option can change (Option+/ types ÷ on a Mac). */
function codeOf(key: string): string | null {
  if (/^[A-Z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  const named: Record<string, string> = {
    "/": "Slash",
    "\\": "Backslash",
    "[": "BracketLeft",
    "]": "BracketRight",
    ".": "Period",
    ",": "Comma",
    "=": "Equal",
    "-": "Minus",
    ";": "Semicolon",
    "'": "Quote",
  };
  return named[key] ?? null;
}

/** Whether a key press is the combo, with exactly its modifiers. */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  const parts = combo.split(/\+(?!$)/);
  const key = parts[parts.length - 1];
  const mods = new Set(parts.slice(0, -1));
  const mac = isMac();
  const wantMeta = mac && mods.has("Mod");
  const wantCtrl = mods.has("Ctrl") || (!mac && mods.has("Mod"));
  if (e.metaKey !== wantMeta || e.ctrlKey !== wantCtrl) return false;
  if (e.altKey !== mods.has("Alt") || e.shiftKey !== mods.has("Shift")) return false;
  const code = codeOf(key);
  if (code) return e.code === code;
  return e.key.toLowerCase() === key.toLowerCase();
}
