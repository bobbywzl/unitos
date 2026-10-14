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
    // The request itself makes buckets of one block (a sub-bucket per theme).
    tinyOk?: boolean;
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
    id: "nz-keyword",
    fixture: "nietzsche-notes",
    lang: "en",
    history: [],
    message: "pull together everything about suffering and pessimism, and everything about art and style, and leave the rest in a third bucket",
    expect: { kind: "structure", whole: true },
    good: "Exactly three top buckets: suffering and pessimism (Schopenhauer's pessimism, tragedy, amor fati as the answer to suffering, the camel and bearing weight, recurrence as the test of suffering, the critiques on these), art and style (gay science as joyful wisdom, we artists, giving style to one's character, appearance), and the rest. A block that is about both goes where its main point is. The rest bucket may hold topic buckets inside it, but nothing about the two named topics is left in it.",
  },
  {
    id: "nz-rework",
    fixture: "nietzsche-notes",
    lang: "en",
    history: [],
    canvas: [
      { id: "b1", title: "Archetypes", description: "The three types of man FN respects.", blocks: "5, 23-24, 154, 200" },
      { id: "b2", title: "Rousseau's man", parent: "b1", blocks: "6-9, 78, 125" },
      { id: "b3", title: "Goethe's man", parent: "b1", blocks: "10-13, 34, 153" },
      { id: "b4", title: "Schopenhauer's man", parent: "b1", blocks: "14-18, 25, 104, 133, 203" },
      { id: "b5", title: "Education and the genius", blocks: "20-21, 27-33" },
      { id: "b6", title: "Self-overcoming", blocks: "19, 22, 95-97, 165-167, 196, 204" },
      { id: "b7", title: "Gay science and truthfulness", blocks: "37-48, 60-61, 69" },
      { id: "b8", title: "Art and style", blocks: "50-59, 88-94, 197" },
      { id: "b9", title: "Death of God", blocks: "64-68, 71-77, 79-85, 143-144, 195" },
      { id: "b10", title: "Eternal recurrence and amor fati", blocks: "99-103, 105-110, 168-170, 186-192, 199, 202" },
      { id: "b11", title: "Morality and the Genealogy", blocks: "113-124, 127-132, 134-139, 198" },
      { id: "b12", title: "Übermensch, last man, metamorphoses", blocks: "142, 145-152, 156-164, 201" },
      { id: "b13", title: "Perspectivism and will to power", blocks: "173-179, 181-185" },
      { id: "b14", title: "Course and exam lines", blocks: "3, 35, 62, 86, 111, 140, 171, 193-194, 205-206" },
    ],
    message: "merge Gay science and Art and style into one bucket, split Morality and the Genealogy into master/slave morality and guilt/ascetic priest, and inside every theme bucket put my critiques in their own sub-bucket",
    expect: { kind: "structure", nested: true, keep: ["b1", "b9", "b14"], tinyOk: true },
    good: "Gay science and Art and style become one bucket (one id kept or a new one), with all their blocks; Morality and the Genealogy becomes two buckets, master/slave morality (good and bad, good and evil, ressentiment) and guilt / bad conscience / the ascetic priest; every theme bucket gets a sub-bucket holding exactly its My critique / My take lines, the rest staying in the theme bucket; buckets the reader did not mention keep their ids, titles, and blocks; nothing else moves.",
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
