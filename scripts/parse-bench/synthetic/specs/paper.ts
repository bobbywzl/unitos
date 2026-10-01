/**
 * A two-column journal paper set by IEEEtran: a title, authors with unmarked footnotes for the affiliations, a
 * bold abstract and index terms, a drop cap, roman-numbered sections in small caps, italic lettered subsections,
 * a run-in numbered subsubsection, numbered equations, a code listing, a figure with its labels drawn as text,
 * a table across both columns with merged header cells (booktabs, multirow, multicolumn), a fully ruled table,
 * footnotes, and a numbered reference list; running heads alternate the journal's name and the authors'.
 */
import { b, bi, cell, codeBlock, eq, figure, fn, h, hrow, i, li, list, m, p, pi, role, row, runIn, sc, table, title, type Spec, type SpecBlock, type SpecSpan } from "../spec";

const cite = (...numbers: number[]) => `[${numbers.join("], [")}]`;
const dropCap = (word: string): SpecSpan => ({ text: word, dropCap: true });

const blocks: SpecBlock[] = [
  title("Sparse Attention for Long Scientific Documents"),
  role(
    "author",
    "Ada Lovelace, Charles Babbage, and Mary Somerville",
    fn("", "Manuscript received June 1, 2026; revised August 3, 2026."),
    fn("", "A. Lovelace and C. Babbage are with the Department of Computing, Analytical Engines Ltd., London, UK (e-mail: ada@example.org)."),
    fn("", "M. Somerville is with the School of Mathematics, Northfield University, Northfield, UK."),
  ),
  role(
    "abstract",
    bi("Abstract—"),
    b(
      "Transformers read long documents slowly because attention compares every pair of tokens. We study a sparse pattern in which each token attends to a window of its neighbors and to a small set of global tokens. On two benchmarks of scientific articles the model matches or exceeds dense attention while using a quarter of the memory, and an ablation shows that 64 global tokens capture most of the gain.",
    ),
  ),
  role("keywords", bi("Index Terms—"), b("Attention, long documents, sparsity, summarization, transformers.")),

  h(2, "I. ", sc("Introduction")),
  pi(
    dropCap("SCIENTIFIC"),
    " articles run to thousands of tokens, and their key results often sit far from the questions they answer. A model that summarizes an article has to connect a claim in the abstract with the table that supports it on page nine. Dense attention ",
    cite(1),
    " does this directly, but its cost grows with the square of the length, so most systems truncate the input to a few thousand tokens.",
  ),
  pi(
    "Sparse attention lowers the cost by letting each token attend to only some positions ",
    cite(2, 3),
    ". The pattern matters: a window captures local context, and a few global tokens carry information across the whole document.",
    fn("1", "Code and trained models will be released with the camera-ready version."),
    " This paper measures how far such a pattern goes on scientific text, where long-range references are common.",
  ),
  pi("Our contributions are threefold. First, we describe a window-and-global pattern with a simple implementation. Second, we evaluate it on two benchmarks of long articles. Third, we show which parts of the pattern account for the gain."),

  h(2, "II. ", sc("Related Work")),
  h(3, i("A. Efficient attention")),
  pi(
    "Several families of methods reduce the cost of attention. Kernel methods approximate the softmax with random features, low-rank methods project the keys to a shorter sequence, and sparse methods restrict the pairs that interact ",
    cite(2),
    "–",
    cite(4),
    ". We follow the last family, since it keeps exact attention within the chosen pairs.",
  ),
  h(3, i("B. Long-document summarization")),
  pi("Benchmarks built from arXiv and PubMed articles pair each paper with its abstract ", cite(5), ". Their inputs average more than 5,000 tokens, which makes them a natural test for long-context models."),

  h(2, "III. ", sc("Method")),
  pi("Given queries ", m("Q"), ", keys ", m("K"), ", and values ", m("V"), " for a sequence of length ", m("n"), ", dense attention computes"),
  eq("\\operatorname{Attn}(Q,K,V)=\\operatorname{softmax}\\left(\\frac{QK^{\\top}}{\\sqrt{d}}\\right)V,", "(1)"),
  p("where ", m("d"), " is the head dimension. Sparse attention replaces the score matrix with"),
  eq("S_{ij}=\\begin{cases}q_i^{\\top}k_j/\\sqrt{d}, & j\\in\\mathcal{N}(i),\\\\ -\\infty, & \\text{otherwise},\\end{cases}", "(2)"),
  p("so that token ", m("i"), " attends only to its neighborhood"),
  eq("\\mathcal{N}(i)=\\{j:|i-j|\\le w\\}\\cup\\mathcal{G},", "(3)"),
  p("a window of half-width ", m("w"), " together with the set ", m("\\mathcal{G}"), " of global positions. Global tokens attend to every position in both directions."),
  runIn(4, i("1) Implementation:")),
  p("The pattern needs no custom kernel. Listing 1 builds the mask from a band and a set of global rows and columns, and applies it before the softmax."),
  codeBlock(
    [
      "def sparse_attention(q, k, v, window, global_idx):",
      "    scores = q @ k.T / q.shape[-1] ** 0.5",
      "    mask = band(len(q), window)",
      "    mask[global_idx, :] = True",
      "    mask[:, global_idx] = True",
      "    scores[~mask] = float(\"-inf\")",
      "    return softmax(scores) @ v",
    ].join("\n"),
  ),
  runIn(4, i("2) Training objective:")),
  p("We train with the usual token-level cross-entropy,"),
  eq("\\mathcal{L}=-\\sum_{t=1}^{T}\\log p_\\theta(y_t\\mid y_{<t},x),", "(4)"),
  p("where ", m("x"), " is the article and ", m("y"), " its abstract. Fig. 1 shows the whole model."),
  figure(
    { label: "Fig. 1.", caption: ["Overview of the model. Global tokens attend to every position; all other tokens attend within a window."], width: 1 },
    {
      kind: "diagram",
      width: 340,
      height: 210,
      boxes: [
        { id: "doc", label: "Article", x: 20, y: 20, w: 110, h: 36 },
        { id: "chunk", label: "Tokenizer", x: 20, y: 90, w: 110, h: 36 },
        { id: "global", label: "Global tokens", x: 200, y: 20, w: 120, h: 36, round: true },
        { id: "enc", label: "Sparse encoder", x: 200, y: 90, w: 120, h: 36 },
        { id: "dec", label: "Decoder", x: 200, y: 160, w: 120, h: 36 },
        { id: "out", label: "Abstract", x: 20, y: 160, w: 110, h: 36, round: true },
      ],
      arrows: [
        ["doc", "chunk"],
        ["chunk", "enc", "tokens"],
        ["global", "enc"],
        ["enc", "dec"],
        ["dec", "out"],
      ],
    },
  ),

  h(2, "IV. ", sc("Experiments")),
  h(3, i("A. Setup")),
  pi(
    "We train all models for 100,000 steps with a batch of 32 articles, a learning rate of ",
    m("3\\times 10^{-4}"),
    ", and inputs truncated to 16,384 tokens. The window has half-width ",
    m("w=256"),
    " and there are 64 global tokens unless stated otherwise.",
  ),
  table(
    { label: "TABLE I", caption: [sc("Results on the Long-Document Benchmarks")], layout: { rules: "booktabs", align: "llrrrr", wide: true } },
    hrow(cell({ rowspan: 2 }, "Model"), cell({ rowspan: 2 }, "Parameters"), cell({ colspan: 2, align: "c" }, "arXiv"), cell({ colspan: 2, align: "c" }, "PubMed")),
    hrow(cell({ align: "r" }, "R-1"), cell({ align: "r" }, "R-L"), cell({ align: "r" }, "R-1"), cell({ align: "r" }, "R-L")),
    row("Dense, 4k tokens", "140M", "41.2", "36.9", "42.8", "38.1"),
    row("Sliding window", "140M", "43.5", "38.8", "44.9", "40.2"),
    row("Window and global (ours)", "142M", b("46.1"), b("41.7"), b("47.3"), b("42.9")),
  ),
  h(3, i("B. Results")),
  pi(
    "Table I compares the models on both benchmarks. The window-and-global model improves ROUGE-1 by 4.9 points on arXiv and 4.5 points on PubMed over dense attention truncated to 4,096 tokens, which it outperforms while reading four times as much text.",
    fn("2", "ROUGE-1 and ROUGE-L are computed with stemming and without stop-word removal."),
  ),
  pi("Table II varies the number of global tokens. The gain saturates near 64 tokens, while memory keeps growing, so we use 64 in all other experiments."),
  table(
    { label: "TABLE II", caption: [sc("Ablation of the Global Tokens on arXiv")], layout: { rules: "grid", align: "rrr" } },
    hrow("Global tokens", "R-1", "Memory (GB)"),
    row("0", "43.5", "11.2"),
    row("16", "45.0", "11.4"),
    row("64", "46.1", "11.9"),
    row("256", "46.2", "13.8"),
  ),

  h(2, "V. ", sc("Conclusion")),
  pi("A window of local attention and a few global tokens are enough to read long scientific articles. The pattern is easy to implement, fits in the memory of a single accelerator, and beats dense attention on truncated inputs. Future work will test it on documents with tables and equations, where references across pages are denser still."),
  h(2, sc("Acknowledgment")),
  pi("The authors thank the reviewers for their comments."),
  h(2, sc("References")),
  list(
    li("[1]", "A. Vaswani ", i("et al."), ", “Attention is all you need,” in ", i("Proc. Adv. Neural Inf. Process. Syst."), ", 2017, pp. 5998–6008."),
    li("[2]", "R. Child, S. Gray, A. Radford, and I. Sutskever, “Generating long sequences with sparse transformers,” 2019, ", i("arXiv:1904.10509"), "."),
    li("[3]", "I. Beltagy, M. E. Peters, and A. Cohan, “Longformer: The long-document transformer,” 2020, ", i("arXiv:2004.05150"), "."),
    li("[4]", "M. Zaheer ", i("et al."), ", “Big Bird: Transformers for longer sequences,” in ", i("Proc. Adv. Neural Inf. Process. Syst."), ", 2020, pp. 17283–17297."),
    li("[5]", "A. Cohan ", i("et al."), ", “A discourse-aware attention model for abstractive summarization of long documents,” in ", i("Proc. NAACL-HLT"), ", 2018, pp. 615–621."),
  ),
];

export const paper: Spec = {
  name: "paper",
  title: "Sparse Attention for Long Scientific Documents",
  category: "paper",
  blocks,
  renderings: {
    tex: {
      documentClass: "IEEEtran",
      classOptions: "journal",
      preamble: "\\usepackage[T1]{fontenc}",
      start: "\\markboth{Journal of Synthetic Benchmarks, Vol.~3, No.~2, September~2026}{Lovelace \\MakeLowercase{\\textit{et al.}}: Sparse Attention for Long Scientific Documents}",
      headings: {
        2: { command: "section", smallCaps: true },
        3: { command: "subsection", italic: true },
        4: { command: "subsubsection", italic: true },
      },
      front: "ieee",
      smallCaps: "upper",
      float: "!t",
      bands: { top: 50, bottom: 40 },
      // IEEEtran's journal sizes as pdflatex prints them in Times (NimbusRomNo9L).
      fonts: {
        body: { shape: "serif", size: 9.96 },
        title: { shape: "serif", size: 23.91 },
        author: { shape: "serif", size: 10.96 },
        h2: { shape: "serif", size: 9.96 },
        h3: { shape: "serif", size: 9.96 },
        h4: { shape: "serif", size: 9.96 },
        caption: { shape: "serif", size: 7.97 },
        footnote: { shape: "serif", size: 7.97 },
      },
      centered: [2],
      justified: true,
    },
    // The same paper printed from HTML in two CSS columns: the front matter and Table I span both columns,
    // small caps are synthesized by Chromium (the text layer keeps the letters' case), math is KaTeX.
    html: {
      css: `
@page { size: letter; margin: 0.75in 0.65in 0.8in; @top-left { content: "Journal of Synthetic Benchmarks, Vol. 3, No. 2, September 2026"; font: 7.5pt "Liberation Serif", serif; } @top-right { content: counter(page); font: 7.5pt "Liberation Serif", serif; } }
body { font: 9.5pt/1.3 "Liberation Serif", serif; columns: 2; column-gap: 0.25in; text-align: justify; }
p { margin: 0; }
p.indent-first { text-indent: 1em; }
p.title { column-span: all; font-size: 22pt; text-align: center; margin: 0 0 0.12in; }
p.role-author { column-span: all; font-size: 11pt; margin-bottom: 0.2in; }
p.role-abstract, p.role-keywords { text-align: justify; font-size: 8.8pt; margin-bottom: 0.08in; }
h2 { font-size: 9.5pt; font-weight: normal; text-align: center; margin: 0.12in 0 0.05in; }
h3 { font-size: 9.5pt; font-weight: normal; margin: 0.08in 0 0.03in; }
h3 i { font-style: italic; }
.run-in i { font-style: italic; }
.display { margin: 0.05in 0; }
pre { font-size: 7.5pt; border: 0.5pt solid #000; padding: 3pt; }
figure { margin: 0.1in 0; }
.caption { font-size: 8pt; text-align: left; }
.table-wrap { margin: 0.1in 0; font-size: 8.5pt; }
.table-wrap .caption { text-align: center; }
p.footnote { font-size: 7.5pt; }
.item > .marker { min-width: 2em; }
`,
      bands: { top: 45, bottom: 40 },
    },
  },
  notes:
    "In LaTeX, IEEEtran's small caps in Times are capitals at the body's size, so the text layer and the reference hold capitals and no small caps; in HTML they keep their letters' case and their small caps. The affiliations are footnotes with no mark (label \"\"). The paragraph after I. INTRODUCTION opens with a drop cap. Table I spans both columns.",
};
