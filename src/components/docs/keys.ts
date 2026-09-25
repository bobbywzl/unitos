// Shortcut labels the way Google Docs prints them in tooltips and menus:
// "Ctrl+B" on Windows, Linux, and ChromeOS; "⌘B" on a Mac.

export function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
}

const MAC: Record<string, string> = { Mod: "⌘", Ctrl: "⌃", Alt: "⌥", Shift: "⇧" };
const PC: Record<string, string> = { Mod: "Ctrl", Ctrl: "Ctrl", Alt: "Alt", Shift: "Shift" };

/** "Mod+Shift+7" → "Ctrl+Shift+7" or "⌘⇧7". */
export function keys(combo: string): string {
  const mac = isMac();
  const parts = combo.split("+").map((p) => (mac ? MAC[p] ?? p : PC[p] ?? p));
  return mac ? parts.join("") : parts.join("+");
}

/** A tooltip with its shortcut: "Bold (Ctrl+B)". */
export function withKeys(label: string, combo?: string): string {
  return combo ? `${label} (${keys(combo)})` : label;
}
