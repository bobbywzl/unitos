// The Breakwork loop's cases (SPEC.md §32): a fixture document, the
// conversation so far, the structure on the canvas, and the reader's
// message. `expect` is what the mechanical checks hold the answer to;
// `good` is what the judge reads as the bar.

export type StructureCase = {
  id: string;
  fixture: "nietzsche-notes" | "sleep-paper" | "zh-notes" | "reading-memory";
  lang: "en" | "zh";
  history: { role: "user" | "assistant"; content: string }[];
  // A structure on the canvas before the turn, by block numbers.
  canvas?: { id: string; title: string; description?: string; parent?: string | null; blocks: string }[];
  message: string;
  expect: {
    kind: "talk" | "structure";
    // The reader asked for the whole document: most content blocks placed.
    whole?: boolean;
    // The reader asked for two levels (a dimension inside another).
    nested?: boolean;
    // The reader asked for labels on the blocks.
    labels?: boolean;
    // The reader asked for themes: no bucket may hold more than a third.
    themes?: boolean;
    // Buckets that must still exist (ids of the canvas).
    keep?: string[];
  };
  good: string;
};

export const STRUCTURE_CASES: StructureCase[] = [
  {
    id: "nz-themes-archetypes",
    fixture: "nietzsche-notes",
    lang: "en",
    history: [],
    message: "Sort FN's quotes and my commentaries by themes/ major topics and by archetypes",
    expect: { kind: "structure", whole: true, nested: true, themes: true },
    good: "Top buckets are the course's major themes (death of God, self-overcoming / style, eternal recurrence, morality / ressentiment, the Übermensch, perspectivism / will to power, the archetypes), gathering quotes and the student's critiques from every week, not one bucket per week. The archetypes (Rousseau's, Goethe's, Schopenhauer's man) are sorted too, each its own bucket, with the later critiques that compare them pulled in. A quote and the critique on it sit together. The reply says how the two dimensions were arranged.",
  },
  {
    id: "nz-retry-complaint",
    fixture: "nietzsche-notes",
    lang: "en",
    history: [{ role: "user", content: "Sort FN's quotes and my commentaries by themes/ major topics and by archetypes" }],
    message: "it doesnt work",
    expect: { kind: "structure", whole: true, nested: true, themes: true },
    good: "The complaint is read as: do the request above now. The answer is a full structure by themes and archetypes, never a question or an apology alone.",
  },
  {
    id: "nz-quotes-vs-critiques",
    fixture: "nietzsche-notes",
    lang: "en",
    history: [],
    message: "separate Nietzsche's own words from my critiques, then group each side by topic",
    expect: { kind: "structure", whole: true, nested: true },
    good: "Two top buckets — Nietzsche's words (FN lines and lecture points) and the student's critiques (My critique / My take lines) — each holding topic buckets. Every FN line is on the first side, every critique on the second.",
  },
  {
    id: "nz-how",
    fixture: "nietzsche-notes",
    lang: "en",
    history: [],
    message: "how would you sort these notes so I can study for the final?",
    expect: { kind: "talk" },
    good: "Two to four sentences naming concrete ways that fit these notes (by theme across weeks, by work, by archetype, quotes vs critiques), and no structure.",
  },
  {
    id: "nz-split-label",
    fixture: "nietzsche-notes",
    lang: "en",
    history: [],
    canvas: [
      { id: "b1", title: "Archetypes", description: "The three types of man.", blocks: "5-17" },
      { id: "b2", title: "Gay Science", description: "Weeks on The Gay Science.", blocks: "18-60" },
    ],
    message: "split Archetypes into one bucket per archetype and label every block in them",
    expect: { kind: "structure", nested: true, labels: true, keep: ["b2"] },
    good: "Archetypes becomes three buckets (Rousseau's, Goethe's, Schopenhauer's man), inside Archetypes or in its place; each archetype's lines are in its bucket, each labeled in three to eight words; Gay Science stays as it was.",
  },
  {
    id: "rm-parts",
    fixture: "reading-memory",
    lang: "en",
    history: [],
    message: "Sort the document by its parts, one bucket each",
    expect: { kind: "structure", whole: true },
    good: "One bucket per part of the article (the opening, the forgetting curve, why structure matters, three habits, limits), each holding its paragraphs in order.",
  },
  {
    id: "sp-claims-evidence",
    fixture: "sleep-paper",
    lang: "en",
    history: [],
    message: "group the paragraphs by claim and the evidence for it, and connect the evidence to the claims",
    expect: { kind: "structure", whole: true },
    good: "Buckets per claim of the paper (the nap effect, the caffeine effect, the comparison, the mechanism), each holding the intro claim, the result paragraphs with the numbers that test it, and the discussion that interprets it; methods and limitations in their own buckets; connections from result blocks to the claims they support or contradict, with labels that say which.",
  },
  {
    id: "zh-themes",
    fixture: "zh-notes",
    lang: "zh",
    history: [],
    message: "按主题归类，把原文和我的想法放在一起",
    expect: { kind: "structure", whole: true, themes: true },
    good: "Buckets per theme (仁, 礼, 学, 君子与小人, 孝) across the sessions, each holding the 原文 lines with the 讲解 and 我的想法 on them; titles and the reply in Chinese.",
  },
];
