// Weblinks: URL-shaped text renders as a hyperlink. Anything with a scheme, a
// www. prefix, or a bare domain on a known TLD counts — "mcap.dev",
// "www.example.com", "arxiv.org/abs/2502.16982". Detection is render-time
// only: the stored block text never changes, so anchors stay stable, and
// documents parsed before this layer existed pick it up without a re-parse.

export type WeblinkSpan = { start: number; end: number; href: string };

// TLDs a bare domain may end in. Deliberately not "dot anything": file names
// (main.py, node.js, index.html) and abbreviations (et al., e.g.) must never
// link. A schemed URL links regardless of TLD.
const TLDS =
  "com|org|net|edu|gov|mil|int|io|ai|dev|app|co|me|sh|so|gg|fm|tv|to|ly|info|biz|xyz|" +
  "tech|cloud|site|online|page|news|blog|wiki|run|live|world|zone|space|plus|pro|one|" +
  "uk|us|ca|de|fr|jp|cn|in|ru|br|au|ch|nl|se|no|es|it|eu|be|at|dk|fi|ie|il|kr|nz|pl|" +
  "pt|sg|za|tr|ua|cz|gr|hu|ro|mx|ar|id";

// Start boundary: not preceded by a word char, @ (emails), dot, or hyphen —
// so user@example.com and sub-label tails never match on their own.
// URL characters: no whitespace, quotes, angle brackets — and no CJK. Chinese
// prose puts no space after a URL, so a CJK character ends the token.
const URL_CHAR = "[^\\s<>\"'\\u2e80-\\u9fff\\uf900-\\ufaff\\ufe30-\\ufe4f\\uff00-\\uffef]";

const WEBLINK_RX = new RegExp(
  "(?<![\\w@.-])(?:" +
    `https?://${URL_CHAR}+` +
    "|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:" +
    TLDS +
    `)\\b(?:/${URL_CHAR}*)?` +
    ")",
  "gi",
);

const MAX_SPANS = 50;

/** Trailing sentence punctuation is not part of the URL; a closing paren
    stays only when the token contains its opener (wiki/Foo_(bar)). */
function trimToken(raw: string): string {
  let token = raw;
  while (token.length > 0) {
    const last = token[token.length - 1];
    if (/[.,;:!?…"'»\]}。，、；：！？》」』】）”’]/.test(last)) {
      token = token.slice(0, -1);
      continue;
    }
    if (last === ")") {
      const opens = token.split("(").length - 1;
      const closes = token.split(")").length - 1;
      if (closes > opens) {
        token = token.slice(0, -1);
        continue;
      }
    }
    break;
  }
  return token;
}

export function weblinkHref(token: string): string {
  return /^https?:\/\//i.test(token) ? token : `https://${token}`;
}

/** URL-shaped spans in text, in order, non-overlapping. */
export function findWeblinks(text: string): WeblinkSpan[] {
  if (!text.includes(".")) return [];
  const spans: WeblinkSpan[] = [];
  for (const m of text.matchAll(WEBLINK_RX)) {
    const token = trimToken(m[0]);
    if (!token || !token.includes(".")) continue;
    spans.push({ start: m.index, end: m.index + token.length, href: weblinkHref(token) });
    if (spans.length >= MAX_SPANS) break;
  }
  return spans;
}
