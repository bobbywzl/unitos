/**
 * A table-heavy annual financial report set by LaTeX (article, Latin Modern): a highlights table with a shaded
 * header, an income statement with group rows, subtotal rules, and negative numbers in parentheses, a 48-row
 * table that runs across pages (longtable) with its shaded header repeated on each page and "Continued on next
 * page" at each break, and a fully ruled segment table with merged cells. Numbers align right. The running
 * header names the company and the report; the footer reads "Page X of Y".
 */
import { b, cell, fn, h, hrow, i, li, list, p, role, row, table, title, type Spec, type SpecBlock, type SpecRow } from "../spec";

const money = (value: number) => {
  const text = new Intl.NumberFormat("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(Math.abs(value));
  return value < 0 ? `(${text})` : text;
};
const bold = (r: SpecRow): SpecRow => ({ ...r, cells: r.cells.map((c) => ({ ...c, spans: c.spans.map((s) => ({ ...s, bold: true as const })) })) });

/** The income statement: [line, note, 2025, 2024]; a line without numbers heads a group; `total` lines are bold under a rule. */
const INCOME: { line: string; note?: string; now?: number; before?: number; total?: true }[] = [
  { line: "Revenue" },
  { line: "Electricity generation", note: "4", now: 2104.7, before: 1982.3 },
  { line: "Gas distribution", note: "4", now: 1188.2, before: 1140.9 },
  { line: "Renewables", note: "5", now: 902.4, before: 741.6 },
  { line: "Retail energy services", now: 571.9, before: 498.2 },
  { line: "Other", now: 45.4, before: 42.3 },
  { line: "Total revenue", now: 4812.6, before: 4405.3, total: true },
  { line: "Operating expenses" },
  { line: "Fuel and purchased power", now: -1893.5, before: -1712.1 },
  { line: "Operations and maintenance", note: "6", now: -1204.8, before: -1133.7 },
  { line: "Depreciation and amortization", note: "7", now: -742.3, before: -702.9 },
  { line: "Taxes other than income taxes", now: -198.6, before: -187.4 },
  { line: "Impairment charges", note: "8", now: -42.0, before: -17.2 },
  { line: "Total operating expenses", now: -4081.2, before: -3753.3, total: true },
  { line: "Operating income", now: 731.4, before: 652.0, total: true },
  { line: "Other income and expense" },
  { line: "Interest expense", note: "9", now: -187.6, before: -201.3 },
  { line: "Interest income", now: 21.8, before: 14.6 },
  { line: "Equity earnings of affiliates", now: 64.2, before: 58.7 },
  { line: "Other, net", now: -3.1, before: 7.4 },
  { line: "Income before income taxes", now: 626.7, before: 531.4, total: true },
  { line: "Income tax expense", note: "10", now: -128.0, before: -89.5 },
  { line: "Net income", now: 498.7, before: 441.9, total: true },
  { line: "Attributable to shareholders", now: 486.1, before: 430.2 },
  { line: "Attributable to non-controlling interests", now: 12.6, before: 11.7 },
];

/** The fleet: [plant, region, technology, capacity in MW]. */
const PLANTS: [string, string, string, number][] = [
  ["Aldergrove", "North", "Gas", 820], ["Bellhaven", "North", "Wind", 310], ["Cairnfield", "North", "Hydro", 145], ["Dunmore", "North", "Solar", 96],
  ["Eastwick", "North", "Gas", 640], ["Fernhill", "North", "Wind", 275], ["Glenrock", "North", "Hydro", 210], ["Harrowgate", "North", "Battery", 60],
  ["Inverleigh", "North", "Wind", 198], ["Juniper Flats", "North", "Solar", 150], ["Kestrel Point", "North", "Gas", 910], ["Larchmont", "North", "Hydro", 88],
  ["Millbrook", "Central", "Nuclear", 1180], ["Northgate", "Central", "Gas", 705], ["Oakridge", "Central", "Solar", 220], ["Pinecrest", "Central", "Wind", 340],
  ["Quarry Hill", "Central", "Gas", 455], ["Redwater", "Central", "Hydro", 132], ["Stonebridge", "Central", "Solar", 185], ["Thornbury", "Central", "Wind", 260],
  ["Upton Vale", "Central", "Battery", 80], ["Valemount", "Central", "Gas", 590], ["Westfield", "Central", "Solar", 240], ["Yarrow Creek", "Central", "Wind", 290],
  ["Ashby Downs", "South", "Solar", 310], ["Brackenridge", "South", "Gas", 760], ["Coldspring", "South", "Wind", 225], ["Deerfield", "South", "Solar", 180],
  ["Elmstead", "South", "Hydro", 120], ["Foxhollow", "South", "Gas", 530], ["Greystone", "South", "Nuclear", 1040], ["Hollins Bay", "South", "Wind", 355],
  ["Ironbridge", "South", "Battery", 100], ["Jasper Mill", "South", "Solar", 205], ["Kingsmere", "South", "Gas", 680], ["Lowther", "South", "Wind", 190],
  ["Marshgate", "West", "Wind", 410], ["Newhaven", "West", "Solar", 265], ["Orchard Lane", "West", "Gas", 520], ["Pembury", "West", "Hydro", 175],
  ["Ravensworth", "West", "Wind", 380], ["Saltmarsh", "West", "Solar", 140], ["Tidewell", "West", "Battery", 90], ["Underwood", "West", "Gas", 615],
  ["Westerly", "West", "Wind", 230], ["Whinfell", "West", "Hydro", 160], ["Yewbarrow", "West", "Solar", 125], ["Zennor Head", "West", "Wind", 305],
];
const FACTOR: Record<string, number> = { Gas: 0.52, Wind: 0.33, Hydro: 0.41, Solar: 0.23, Nuclear: 0.91, Battery: 0.09 };

const plantRows = PLANTS.map(([name, region, technology, capacity], index) => {
  const factor = FACTOR[technology] + ((index % 7) - 3) / 100;
  const output = (capacity * 8.76 * factor).toFixed(0);
  return row(name, region, technology, new Intl.NumberFormat("en-US").format(capacity), new Intl.NumberFormat("en-US").format(Number(output)), `${(factor * 100).toFixed(1)}%`);
});

const blocks: SpecBlock[] = [
  title(b("2025 Annual Financial Report")),
  role("subtitle", "Kestrel Energy Group"),
  role("date", "For the year ended December 31, 2025"),

  h(2, b("1. Financial highlights")),
  p(
    "Kestrel Energy Group grew revenue by 9.2% in 2025, helped by higher output from the renewables fleet and a full year of the Millbrook uprate. Operating income rose 12.2% and net debt fell below USD 2 billion for the first time since 2019.",
    fn("1", "All amounts are in millions of US dollars unless stated otherwise. Totals may not add because of rounding."),
  ),
  table(
    { label: "Table 1.", caption: ["Financial highlights"], layout: { rules: "booktabs", align: "lrrr", shadeHeader: "#DCE6F1" } },
    hrow(b("Measure"), b("2025"), b("2024"), b("Change")),
    row("Revenue", "4,812.6", "4,405.3", "9.2%"),
    row("Operating income", "731.4", "652.0", "12.2%"),
    row("Net income", "498.7", "441.9", "12.9%"),
    row("Earnings per share (USD)", "3.12", "2.76", "13.0%"),
    row("Free cash flow", "612.3", "540.8", "13.2%"),
    row("Net debt", "1,905.0", "2,118.4", "(10.1)%"),
  ),

  h(2, b("2. Consolidated income statement")),
  p("The income statement below follows the presentation of prior years. Notes refer to the notes to the consolidated financial statements, which are published separately."),
  table(
    { label: "Table 2.", caption: ["Consolidated income statement (USD millions)"], layout: { rules: "booktabs", align: "lrrr", shadeHeader: "#DCE6F1", widths: [5, 1, 1.4, 1.4] } },
    hrow(b("Line item"), b("Note"), b("2025"), b("2024")),
    ...INCOME.map((entry, index) => {
      if (entry.now === undefined) return row(i(entry.line), "", "", "");
      const r = row(entry.line, entry.note ?? "", money(entry.now), money(entry.before ?? 0));
      const next = INCOME[index + 1];
      const out = entry.total ? bold(r) : r;
      return next?.total ? { ...out, rule: true as const } : out;
    }),
  ),

  h(2, b("3. Generation fleet")),
  p("Table 3 lists every plant the group operated at the end of 2025, with its nameplate capacity, its output for the year, and its capacity factor, the ratio of actual output to the output at full capacity all year."),
  table(
    {
      label: "Table 3.",
      caption: ["Generation by plant, 2025"],
      layout: { rules: "booktabs", align: "lllrrr", long: true, continued: "Continued on next page", shadeHeader: "#DCE6F1" },
    },
    hrow(b("Plant"), b("Region"), b("Technology"), b("Capacity (MW)"), b("Output (GWh)"), b("Capacity factor")),
    ...plantRows,
  ),
  p("Capacity factors for batteries measure energy discharged. The Millbrook and Greystone nuclear units ran above 88% for the third year in a row."),

  h(2, b("4. Segment results")),
  p("The group reports four segments. Corporate costs and eliminations between segments are not allocated."),
  table(
    { label: "Table 4.", caption: ["Revenue and operating income by segment (USD millions)"], layout: { rules: "grid", align: "lrrrrr", shadeHeader: "#E2EFDA" } },
    hrow(cell({ rowspan: 2 }, b("Segment")), cell({ colspan: 2, align: "c" }, b("Revenue")), cell({ colspan: 2, align: "c" }, b("Operating income")), cell({ rowspan: 2, align: "r" }, b("Margin 2025"))),
    hrow(cell({ align: "r" }, b("2025")), cell({ align: "r" }, b("2024")), cell({ align: "r" }, b("2025")), cell({ align: "r" }, b("2024"))),
    row("Generation", "2,104.7", "1,982.3", "402.6", "371.9", "19.1%"),
    row("Networks", "1,188.2", "1,140.9", "231.5", "226.0", "19.5%"),
    row("Renewables", "902.4", "741.6", "168.9", "121.4", "18.7%"),
    row("Retail", "571.9", "498.2", "34.8", "27.6", "6.1%"),
    row("Corporate and eliminations", "45.4", "42.3", cell({ colspan: 3, align: "c" }, i("not allocated"))),
    bold(row("Total", "4,812.6", "4,405.3", "731.4", "652.0", "15.2%")),
  ),

  h(2, b("5. Outlook")),
  p("For 2026 the group expects:"),
  list(
    li("•", "revenue growth of 4% to 6%, with renewables output up about 15%;"),
    li("•", "capital spending of USD 1.1 billion, two thirds of it on wind and solar;"),
    li("•", "net debt of USD 1.8 billion to USD 2.0 billion at year end."),
  ),
  p("These expectations assume normal weather and gas prices near the forward curve of December 2025.", fn("2", "The forward curve is the average of the monthly Henry Hub futures settlement prices on December 31, 2025.")),
];

export const tables: Spec = {
  name: "tables",
  title: "Kestrel Energy Group: 2025 Annual Financial Report",
  category: "financial",
  blocks,
  renderings: {
    tex: {
      documentClass: "article",
      classOptions: "10pt,letterpaper",
      preamble: String.raw`
\usepackage[T1]{fontenc}
\usepackage{lmodern}
\usepackage[margin=1in,headheight=14pt]{geometry}
\usepackage[labelsep=period]{caption}
\usepackage{fancyhdr,lastpage,float}
\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{Kestrel Energy Group}
\fancyhead[R]{2025 Annual Financial Report}
\fancyfoot[C]{Page \thepage\ of \pageref{LastPage}}
\renewcommand{\headrulewidth}{0.4pt}
\setlength{\parskip}{0.5em}
\setlength{\parindent}{0pt}
`,
      headings: { 2: { command: "section", bold: true } },
      front: "block",
      smallCaps: "keep",
      float: "H",
      bands: { top: 66, bottom: 56 },
      // article's 10pt sizes in Latin Modern as pdflatex prints them.
      fonts: {
        body: { shape: "serif", size: 9.96 },
        title: { shape: "serif", size: 17.22, bold: true },
        subtitle: { shape: "serif", size: 14.35 },
        h2: { shape: "serif", size: 14.35, bold: true },
        caption: { shape: "serif", size: 9.96 },
        footnote: { shape: "serif", size: 7.97 },
      },
      centered: [],
      justified: true,
    },
    // The same report made in Word: Table 3's header row repeats on each page (Word's repeat header row).
    docx: {
      font: "Cambria",
      size: 10,
      headingFont: "Cambria",
      headingSizes: { 0: 20, 2: 14 },
      after: 6,
      header: { left: "Kestrel Energy Group", right: "2025 Annual Financial Report" },
      footer: { center: "Page {PAGE} of {PAGES}" },
      bands: { top: 60, bottom: 60 },
    },
  },
  notes: "Table 3 runs across pages: its header row repeats at the top of each page (and in LaTeX “Continued on next page” closes each broken part); the reference holds the header once. Negative numbers are in parentheses.",
};
