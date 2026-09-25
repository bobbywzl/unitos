import { z } from "zod";

// Tools > Preferences in Google Docs (SPEC.md §29, typing): the automatic
// formatting switches and the substitutions list, with Google's defaults.
// They hold for every blank document in this browser (localStorage); a
// private window or blocked storage keeps the defaults.

export type Substitution = { from: string; to: string; enabled: boolean };

export type TypingPrefs = {
  autoCapitalize: boolean;
  smartQuotes: boolean;
  detectLinks: boolean;
  detectLists: boolean;
  markdown: boolean;
  correctSpelling: boolean;
  /** "Automatic substitution": the master switch of the list below. */
  substitute: boolean;
  substitutions: Substitution[];
  /** Words whose spelling correction was undone: never corrected again. */
  spellingBlocklist: string[];
  /** Substitutions undone right after they fired: skipped from then on. */
  substitutionBlocklist: string[];
  /** The metric the floating word counter shows. */
  counterMetric: "pages" | "words" | "characters" | "charactersNoSpaces";
};

/** Google Docs' default substitutions: exactly these 27 pairs, in this order. */
export const DEFAULT_SUBSTITUTIONS: ReadonlyArray<readonly [string, string]> = [
  ["(c)", "©"],
  ["(r)", "®"],
  ["tm", "™"],
  ["c/o", "℅"],
  ["...", "…"],
  ["1/2", "½"],
  ["1/3", "⅓"],
  ["1/4", "¼"],
  ["1/5", "⅕"],
  ["1/6", "⅙"],
  ["1/8", "⅛"],
  ["2/3", "⅔"],
  ["3/4", "¾"],
  ["2/5", "⅖"],
  ["3/5", "⅗"],
  ["4/5", "⅘"],
  ["5/6", "⅚"],
  ["3/8", "⅜"],
  ["5/8", "⅝"],
  ["7/8", "⅞"],
  ["<--", "←"],
  ["<==", "⇐"],
  ["<=>", "⇔"],
  ["==>", "⇒"],
  ["-->", "→"],
  ["--", "–"],
  ["---", "—"],
];

export const DEFAULT_PREFS: TypingPrefs = {
  autoCapitalize: true,
  smartQuotes: true,
  detectLinks: true,
  detectLists: true,
  markdown: false,
  correctSpelling: true,
  substitute: true,
  substitutions: DEFAULT_SUBSTITUTIONS.map(([from, to]) => ({ from, to, enabled: true })),
  spellingBlocklist: [],
  substitutionBlocklist: [],
  counterMetric: "words",
};

const STORAGE_KEY = "unitos-docs-typing";

const prefsSchema = z.object({
  autoCapitalize: z.boolean(),
  smartQuotes: z.boolean(),
  detectLinks: z.boolean(),
  detectLists: z.boolean(),
  markdown: z.boolean(),
  correctSpelling: z.boolean(),
  substitute: z.boolean(),
  substitutions: z
    .array(z.object({ from: z.string().min(1).max(100), to: z.string().max(200), enabled: z.boolean() }))
    .max(500),
  spellingBlocklist: z.array(z.string().max(100)).max(2000),
  substitutionBlocklist: z.array(z.string().max(100)).max(2000),
  counterMetric: z.enum(["pages", "words", "characters", "charactersNoSpaces"]),
});

let current: TypingPrefs | null = null;
const listeners = new Set<() => void>();

function load(): TypingPrefs {
  try {
    const raw = typeof window === "undefined" ? null : window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = prefsSchema.partial().safeParse(JSON.parse(raw));
    return parsed.success ? { ...DEFAULT_PREFS, ...parsed.data } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

/** The preferences now (read once from the browser, then kept here). */
export function typingPrefs(): TypingPrefs {
  if (!current) current = load();
  return current;
}

export function setTypingPrefs(next: Partial<TypingPrefs>): void {
  current = { ...typingPrefs(), ...next };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage is off: the choice holds until the page closes.
  }
  for (const listener of listeners) listener();
}

/** For useSyncExternalStore. */
export function subscribeTypingPrefs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function serverTypingPrefs(): TypingPrefs {
  return DEFAULT_PREFS;
}

/** The substitution map: each enabled pair by its lower-cased key, plus the
    cascades Google builds — for a key K whose proper prefix P is itself a
    key, value(P) + the rest of K also gives value(K). So "--" then "-"
    gives "—", and "--" then ">" gives "→". */
export function substitutionMap(prefs: TypingPrefs): Map<string, string> {
  const map = new Map<string, string>();
  if (!prefs.substitute) return map;
  const pairs = prefs.substitutions.filter((s) => s.enabled && s.from);
  for (const pair of pairs) map.set(pair.from.toLowerCase(), pair.to);
  for (const pair of pairs) {
    const key = pair.from.toLowerCase();
    for (let n = key.length - 1; n > 0; n--) {
      const prefix = key.slice(0, n);
      const value = map.get(prefix);
      if (value === undefined) continue;
      const cascade = (value + key.slice(n)).toLowerCase();
      if (!map.has(cascade)) map.set(cascade, pair.to);
    }
  }
  return map;
}
