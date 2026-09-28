/**
 * A talk as a beamer deck (Madrid theme): a title slide, slide titles in a colored bar, bullets the theme draws
 * as shapes (no text glyph) nested two deep, a numbered list, a display equation, a table, a diagram whose labels
 * are text, a code listing, and a footline on every slide with the author, the title, the date, and "n / N".
 */
import { b, codeBlock, center, eq, figure, frame, hrow, i, li, li1, link, list, m, p, role, row, table, title, type Spec, type SpecBlock } from "../spec";

const blocks: SpecBlock[] = [
  title(b("Sparse Attention for Long Scientific Documents")),
  role("subtitle", "Reading a whole paper at once"),
  role("author", "Ada Lovelace"),
  role("affiliation", "Analytical Engines Ltd."),
  role("date", "September 2026"),

  frame("Why long documents are hard"),
  list(
    li("•", "A scientific article runs to 5,000–20,000 tokens"),
    li("•", "Dense attention compares every pair of tokens"),
    li1("•", "Memory grows with the square of the length"),
    li1("•", "A 16k input needs 64 times the memory of a 2k input"),
    li("•", "Most systems cut the input to the first 4,096 tokens"),
    li1("•", "The results section is often cut off"),
  ),

  frame("The pattern"),
  p("Token ", m("i"), " attends to a window and to a few global tokens:"),
  eq("\\mathcal{N}(i)=\\{j:|i-j|\\le w\\}\\cup\\mathcal{G}"),
  list(
    li("•", "Window: local context, ", m("w=256")),
    li("•", "Global tokens: 64 positions that see everything"),
    li("•", "Cost grows linearly with the length"),
  ),

  frame("The model in one picture"),
  figure(
    { width: 0.8 },
    {
      kind: "diagram",
      width: 460,
      height: 160,
      boxes: [
        { id: "doc", label: "Article", x: 10, y: 60, w: 100, h: 40 },
        { id: "enc", label: "Sparse encoder", x: 160, y: 60, w: 140, h: 40 },
        { id: "dec", label: "Decoder", x: 350, y: 60, w: 100, h: 40 },
        { id: "glob", label: "Global tokens", x: 160, y: 5, w: 140, h: 34, round: true },
      ],
      arrows: [
        ["doc", "enc"],
        ["glob", "enc"],
        ["enc", "dec"],
      ],
    },
  ),

  frame("Results"),
  table(
    { layout: { rules: "booktabs", align: "lrr" } },
    hrow("Model", "arXiv R-1", "PubMed R-1"),
    row("Dense, 4k tokens", "41.2", "42.8"),
    row("Sliding window", "43.5", "44.9"),
    row(b("Window and global"), b("46.1"), b("47.3")),
  ),
  p("The gain holds on both benchmarks and saturates near 64 global tokens."),

  frame("It fits in a few lines"),
  codeBlock(["mask = band(n, window)", "mask[global_idx, :] = True", "mask[:, global_idx] = True", "scores[~mask] = float(\"-inf\")"].join("\n")),

  frame("What we learned"),
  list(
    li("1.", "Local context carries most of the signal"),
    li("2.", "A few global tokens recover the long-range links"),
    li("3.", "Truncation, not model size, was the bottleneck"),
  ),
  p(i("Next: documents with tables and equations.")),

  frame("Questions?"),
  center("Slides and code: ", ...link("https://example.org/sparse-attention", "example.org/sparse-attention")),
];

export const slides: Spec = {
  name: "slides",
  title: "Sparse Attention for Long Scientific Documents: a talk",
  category: "slides",
  blocks,
  renderings: {
    tex: {
      documentClass: "beamer",
      classOptions: "xcolor=table",
      preamble: String.raw`
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usetheme{Madrid}
\setbeamertemplate{navigation symbols}{}
\setbeamertemplate{enumerate items}[default]
\title[Sparse Attention]{Sparse Attention for Long Scientific Documents}
\author[A. Lovelace]{Ada Lovelace}
\institute[Analytical Engines]{Analytical Engines Ltd.}
\date[September 2026]{September 2026}
`,
      headings: {},
      front: "beamer",
      smallCaps: "keep",
      drawnBullets: true,
      bands: { top: 0, bottom: 12 },
    },
  },
  notes: "One page per slide. The slide title is a level 2 heading. The theme draws the bullets as shapes, so a bullet list has no marker in the text layer; the reference names the marker •. The footline on every slide is furniture.",
};
