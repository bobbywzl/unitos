// Habits (SPEC.md §7): how a reader asks, offered again under "You often
// ask". Read from the reader's own conversation notes, never stored on the
// server. The assistant writes the asks (lib/assistant/write-habits.ts): it
// reads the reader's asks of the last sixty days, this project's first, and
// writes up to three general asks that fit the open project. Where no model
// answers, the kinds below stand in: an ask of one kind made three times or
// more, on two documents or more, offered in general words for the kind.
// One ask in one document is no habit: the thresholds keep the assistant
// from reading a pattern into a single afternoon.

export type Ask = { text: string; notebookId: string; documentId: string | null; at: Date };
export type Habit = { kind: string; text: string; count: number };

export const HABIT_DAYS = 60;
export const HABIT_MIN_ASKS = 3;
export const HABIT_MIN_PLACES = 2;
export const HABIT_MAX = 3;
// The assistant writes habits from this many asks or more, and reads this
// many at most from this project and from the others.
export const HABIT_MIN_READ = 4;
export const HABIT_READ_HERE = 30;
export const HABIT_READ_ELSEWHERE = 30;
// A new set of habits is written after this many new asks, or a new week.
export const HABIT_STEP = 4;

// The kinds of ask, each by the words that name it, in English and Chinese.
// The first kind that matches names the ask; an ask that matches none is no
// habit (a question about one passage, a confirmation, a one-off).
const KINDS: [string, RegExp][] = [
  ["proofread", /\b(fix|correct|check|find)\b[^.]*\b(spelling|grammar|typos?|mistakes?|errors?)\b|\bproofread|拼写|语法|错别字/i],
  ["study guide", /\bstudy guide\b|学习指南|复习指南/i],
  ["flashcards", /\bflash ?cards?\b|闪卡|记忆卡/i],
  ["faq", /\bfaq\b|\bquestions and answers\b|常见问题/i],
  ["action items", /\baction items?\b|\bto-?dos?\b|待办|行动项/i],
  ["glossary", /\bglossary\b|\bkey terms\b|\bdefine (every|all|each)\b|术语表|名词解释/i],
  ["outline", /\boutline\b|大纲|提纲/i],
  ["summary", /\bsummar(y|ies|ize|ise|ized|ised)\b|\btl;?dr\b|\bkey points\b|\bmain points\b|总结|摘要|概括|要点/i],
  ["translate", /\btranslat(e|ion)\b|翻译|译成/i],
  ["shorten", /\bshorten|\bcondense|\btighten\b|\bmake (it|this|the \w+) shorter\b|\bcut (it|this|the \w+) (in half|by|to)\b|缩短|精简|压缩/i],
  ["plain words", /\bplain (words|english|language)\b|\bsimplif(y|ied)\b|\blayman\b|\beasier to read\b|通俗|简单的话|白话/i],
  ["formal", /\bformal\b|\bprofessional (tone|register)\b|正式|书面语/i],
  ["bullets", /\bbullet(s| points| list)\b|\bas a list\b|\binto a list\b|\bnumbered list\b|列表|要点列/i],
  ["headings", /\bheadings?\b|标题/i],
  ["highlight", /\bhighlight\b|\bmark (every|all|each)\b|高亮|标出/i],
  ["notes", /\b(make|add|write|create|take)\b[^.]*\bnotes?\b|笔记/i],
  ["contradictions", /\bcontradict|\binconsisten|矛盾|不一致/i],
  ["evidence", /\b(evidence|support|sources?)\b[^.]*\b(for|against|of)\b|证据|依据/i],
];

// The kinds a general ask is written for (assistant.habitKind* in the
// dictionary): the ask names the open document, not the place it was first
// made. The other kinds are commands on words the reader picked; they keep
// the reader's own words.
export const GENERAL_KINDS = new Set([
  "proofread",
  "study guide",
  "flashcards",
  "faq",
  "action items",
  "glossary",
  "outline",
  "summary",
  "plain words",
  "notes",
  "contradictions",
]);

/** An ask as plain words: block and note tags out, one line. */
export function plainAsk(text: string): string {
  return text
    .replace(/\[(block|note) [^\]]+\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The reader's asks the assistant reads to write habits: the asks of the
    window that are a sentence of their own (not "ok", not a pasted page),
    each once, this project's apart from the others', newest first. */
export function habitAsks(asks: Ask[], notebookId: string, now = new Date()): { here: string[]; elsewhere: string[]; total: number } {
  const since = now.getTime() - HABIT_DAYS * 86_400_000;
  const seen = new Set<string>();
  const here: string[] = [];
  const elsewhere: string[] = [];
  let total = 0;
  for (const ask of [...asks].sort((a, b) => b.at.getTime() - a.at.getTime())) {
    if (ask.at.getTime() < since || ask.at.getTime() > now.getTime() + 60_000) continue;
    const text = plainAsk(ask.text);
    if (text.length < 12 || text.length > 300) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    total++;
    const list = ask.notebookId === notebookId ? here : elsewhere;
    if (list.length < (list === here ? HABIT_READ_HERE : HABIT_READ_ELSEWHERE)) list.push(text);
  }
  return { here, elsewhere, total };
}

/** What a stored set of habits was written from: the project, the week, and
    the count of asks in steps. The panel keeps the set with its stamp and
    asks for a new one only when the stamp changes. */
export function habitStamp(notebookId: string, total: number, now = new Date()): string {
  const week = Math.floor(now.getTime() / (7 * 86_400_000));
  return `${notebookId}:${week}:${Math.floor(total / HABIT_STEP)}`;
}

/** The kind of an ask, or null when it is one of a kind the assistant does
    not offer again. Block and note tags come out first: the words are what count. */
export function askKind(text: string): string | null {
  const plain = plainAsk(text);
  if (!plain || plain.length > 400) return null;
  for (const [kind, re] of KINDS) if (re.test(plain)) return kind;
  return null;
}

// An ask that points at the place it was made ("this paragraph", "here",
// "the selected words") reads oddly offered elsewhere: another ask of the
// kind is preferred for the chip's words.
const HERE = /\b(this|these|here|above|below|selected|selection|highlighted)\b|这段|这里|这句|选中|上面|下面/i;

/** The reader's habits by kind, where no model writes them: the kinds asked
    three times or more on two documents or more within the window, the kind
    asked most in this project first, then the most asked, at most `limit`,
    each with the newest ask of its kind as its words (the route puts general
    words in their place for a kind in GENERAL_KINDS). */
export function habitsOf(asks: Ask[], now = new Date(), limit = HABIT_MAX, notebookId: string | null = null): Habit[] {
  const since = now.getTime() - HABIT_DAYS * 86_400_000;
  const kinds = new Map<string, { count: number; here: number; places: Set<string>; asks: Ask[] }>();
  for (const ask of asks) {
    if (ask.at.getTime() < since || ask.at.getTime() > now.getTime() + 60_000) continue;
    const kind = askKind(ask.text);
    if (!kind) continue;
    const entry = kinds.get(kind) ?? { count: 0, here: 0, places: new Set<string>(), asks: [] };
    entry.count++;
    if (ask.notebookId === notebookId) entry.here++;
    entry.places.add(ask.documentId ?? `notebook:${ask.notebookId}`);
    entry.asks.push(ask);
    kinds.set(kind, entry);
  }
  return [...kinds.entries()]
    .filter(([, e]) => e.count >= HABIT_MIN_ASKS && e.places.size >= HABIT_MIN_PLACES)
    .sort((a, b) => b[1].here - a[1].here || b[1].count - a[1].count || newest(b[1].asks) - newest(a[1].asks))
    .slice(0, limit)
    .map(([kind, e]) => ({ kind, text: wordsOf(e.asks), count: e.count }));
}

const newest = (asks: Ask[]) => Math.max(...asks.map((a) => a.at.getTime()));

/** The chip's words: the newest ask of the kind that names no place, else the newest. */
function wordsOf(asks: Ask[]): string {
  const sorted = [...asks].sort((a, b) => b.at.getTime() - a.at.getTime());
  const pick = sorted.find((a) => !HERE.test(a.text)) ?? sorted[0];
  const text = plainAsk(pick.text);
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
}
