/**
 * A utility's field report made in Word, for the page's look: a cover set by direct formatting (its first line
 * centered, bold, navy, 19 pt; gray and blue lines from 9.5 to 15 pt), a quote with a smaller gray attribution,
 * heading styles with their own sizes and colors, justified paragraphs, a contents field Word has not filled,
 * shaded tables (a navy header row with white bold words, alternating row fills, colored grades in a centered
 * column, right-aligned number columns, 9 pt and 8 pt text), a one-cell shaded label bar, and footnotes in a
 * paragraph and in a table cell.
 */
import { b, cell, center, contents, cover, fn, h, hrow, i, justify, li, list, look as runLook, p, quote, row, table, type Spec, type SpecBlock } from "../spec";

const NAVY = "#1F3864";
const GRAY = "#595959";
const white = (text: string) => runLook("#FFFFFF", undefined, b(text));

const blocks: SpecBlock[] = [
  cover(runLook(NAVY, 19, b("HARBOR LIGHT UTILITIES"))),
  center(runLook(GRAY, 12, "OTC: HLU")),
  center(runLook("#2E75B6", 15, "A Field Review of Grid Assets")),
  center(runLook(GRAY, 11, i("Substations · Lines · Storage · Crews · Budget"))),
  quote(i("“A pole checked in spring is a pole standing in winter.”"), runLook(GRAY, 9.5, " — Saying of the line crews")),
  center(runLook(GRAY, 9.5, "Winter inspections · Amounts in thousands of dollars")),
  h(1, "Contents"),
  contents(1, 2),
  h(1, "1. Summary"),
  justify(
    b("Main finding. "),
    "The grid is sound where crews kept to the schedule, and weakest where new equipment arrived late. Poles and crews took the largest share of the spending, and storage spending rose quickest.",
  ),
  justify(
    "The storage yard doubled its budget but not its output, so the review looks at it first",
    fn("1", "Storage figures are nameplate, not measured."),
    ". The other areas met their plans within a few percent.",
  ),
  h(2, "Scorecard"),
  table(
    { layout: { rules: "grid", align: "lcl", widths: [2600, 1100, 5660], size: 9, shadeHeader: NAVY } },
    hrow(white("Area"), white("Grade"), white("Note")),
    { ...row("Substations", runLook("#00B050", undefined, b("A")), "Transformers were tested on schedule."), shade: "#F2F2F2" },
    row("Lines", runLook("#ED7D31", undefined, b("B")), "Two feeders still wait for new poles."),
    { ...row("Storage", runLook("#C00000", undefined, b("C")), "The battery yard missed its target."), shade: "#F2F2F2" },
  ),
  p(runLook(GRAY, 9.5, i("A letter shows how the area kept to its plan."))),
  h(2, "Budget"),
  table(
    { layout: { rules: "grid", align: "lrrr", widths: [3000, 2120, 2120, 2120], size: 8, shadeHeader: NAVY } },
    hrow(white("Item"), white("Plan"), white("Actual"), white("Change")),
    { ...row("Poles", "4,120", "4,480", "+8.7%"), shade: "#F2F2F2" },
    row(cell({}, "Storage", fn("2", "Storage began halfway through the year.")), "1,305", "2,210", "+69.3%"),
    { ...row("Crews", "6,940", "7,015", "+1.1%"), shade: "#F2F2F2" },
  ),
  table({ layout: { rules: "none", size: 11 } }, { ...row(white("What the crews asked for")), shade: NAVY }),
  list(li("•", "Test transformers before the summer load."), li("•", "Order long-lead parts a year ahead."), li("•", "Count storage by the energy it returns.")),
  h(1, "2. Field notes"),
  h(3, "2.1 North yard"),
  justify("The north yard replaced four breakers in the autumn. The work finished two weeks early, and no outage was longer than an hour."),
];

export const look: Spec = {
  name: "look",
  title: "A Field Review of Grid Assets",
  category: "word",
  blocks,
  renderings: {
    docx: {
      font: "Calibri",
      size: 10.5,
      headingFont: "Calibri",
      headingColor: "2E74B5",
      headingColors: { 3: "1F4D78" },
      headingBold: false,
      headingSizes: { 1: 16, 2: 13, 3: 12 },
      after: 6,
      bands: { top: 60, bottom: 60 },
    },
  },
  notes:
    "The cover's first line is the title by its size (direct formatting on a Normal paragraph). The Word file and LibreOffice's PDF both leave the contents field empty; the reference holds the entries Word draws when it fills the field, so the Word file's parse is scored against it and the PDF is there for the reference-free check.",
};
