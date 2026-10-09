// Backslashes in a model's JSON (SPEC.md §7, §29). A TeX command written
// unescaped inside a JSON string either breaks the parse (`\mathrm` is no
// JSON escape) or silently turns into a control character: `\text` reads as
// a tab and "ext", `\beta` as a backspace, `\frac` as a form feed, `\nu` as a
// newline, `\rho` as a carriage return. The words are then "not found" or
// the new TeX cannot draw, and the suggestion is dropped. These helpers read
// the backslash back. Client-safe: no imports.

/** The JSON escape letters that read as control characters. */
const CONTROL_OF: Record<string, string> = { "\t": "t", "\b": "b", "\f": "f", "\n": "n", "\r": "r" };

/** A control character that a TeX command's first letter became, followed
    by the command's other letters: the backslash and the letter it stood for. */
const CONTROL_LETTER = /[\t\b\f\n\r](?=[A-Za-z])/g;

/** Every control character standing where a TeX command's backslash was,
    read back as the backslash and its letter. For words to find in the
    document when the direct search failed: a tab followed by a letter inside
    a find is almost surely TeX. */
export function restoreControlEscapes(s: string): string {
  return s.replace(CONTROL_LETTER, (c) => `\\${CONTROL_OF[c]}`);
}

/** The same, inside the `$…$` spans of a text only, so a tab between a
    table's cells or a newline between a list's lines stays what it is. */
export function restoreTexEscapes(s: string): string {
  if (!s.includes("$") || !/[\t\b\f\n\r][A-Za-z]/.test(s)) return s;
  return s.replace(/\$[^$]*\$/g, (span) => restoreControlEscapes(span));
}

/** Every string of a parsed JSON value, its `$…$` spans read back. */
export function restoreTexEscapesDeep<T>(value: T): T {
  if (typeof value === "string") return restoreTexEscapes(value) as T;
  if (Array.isArray(value)) return value.map((v) => restoreTexEscapesDeep(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = restoreTexEscapesDeep(v);
    return out as T;
  }
  return value;
}

/** JSON text with every escape that is no JSON escape doubled, so `\mathrm`
    parses as a backslash and the letters. A `\u` not followed by four hex
    digits is one too (`\upsilon`). Escape pairs are read as units, so an
    escaped backslash stays one. */
export function repairJsonEscapes(text: string): string {
  return text.replace(/\\([\s\S])/g, (pair, c: string, at: number) => {
    if (c === "u") return /^[0-9a-fA-F]{4}$/.test(text.slice(at + 2, at + 6)) ? pair : `\\\\u`;
    return '"\\/bfnrt'.includes(c) ? pair : `\\\\${c}`;
  });
}
