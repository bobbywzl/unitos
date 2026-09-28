/**
 * A quarterly business report made in Word: Heading 1–3, bullets nested two deep, a numbered list, tables with
 * shaded header rows and merged cells, a total row, footnotes, a chart as a picture, a "CONFIDENTIAL" header,
 * and a footer with the report's name and the page number.
 */
import { b, cell, figure, fn, h, hrow, i, li, li1, list, p, role, row, table, title, type Spec, type SpecBlock } from "../spec";

const blocks: SpecBlock[] = [
  title("Q3 2026 Operations Review"),
  role("subtitle", "Northwind Logistics · Operations Analytics · October 2026"),
  h(1, "1. Executive summary"),
  p(
    "Third-quarter volume grew 8.4% year over year to 12.7 million parcels, and the cost per parcel fell for the fourth quarter in a row. Service improved in every region, although the Southwest remains below its on-time target.",
    fn("1", "All figures are unaudited and exclude the Freightline subsidiary acquired in August 2026."),
  ),
  list(
    li("•", b("Volume:"), " 12.7 million parcels, up 8.4% from Q3 2025"),
    li("•", b("On-time delivery:"), " 96.1%, up from 94.8% in Q2"),
    li1("o", "Northeast region: 97.3%, the best result since 2021"),
    li1("o", "Southwest region: 94.2%, still below the 95% target"),
    li("•", b("Cost per parcel:"), " $3.42, down 2.6% from Q2"),
    li1("o", "Fuel: down 4.1% on lower diesel prices"),
    li1("o", "Labor: up 1.2% after the July wage adjustment"),
  ),
  p("The rest of this review covers regional results, costs, and the risks for the fourth quarter."),

  h(1, "2. Regional performance"),
  h(2, "2.1 Volume and service levels"),
  p("Every region grew its volume. The Southeast grew fastest, at 8.9%, helped by two new retail accounts that started shipping in July. Table 1 compares the third quarters of 2025 and 2026."),
  table(
    { label: "Table 1.", caption: ["Volume and on-time delivery by region"], layout: { rules: "grid", align: "lrrrr", shadeHeader: "#D9E2F3", widths: [2.2, 1, 1, 1, 1] } },
    hrow(cell({ rowspan: 2, align: "l" }, b("Region")), cell({ colspan: 2, align: "c" }, b("Volume (thousands)")), cell({ colspan: 2, align: "c" }, b("On-time delivery"))),
    hrow(cell({ align: "r" }, b("Q3 2025")), cell({ align: "r" }, b("Q3 2026")), cell({ align: "r" }, b("Q3 2025")), cell({ align: "r" }, b("Q3 2026"))),
    row("Northeast", "3,412", "3,705", "95.9%", "97.3%"),
    row("Southeast", "2,980", "3,244", "94.1%", "96.0%"),
    row("Midwest", "2,655", "2,861", "95.2%", "96.4%"),
    row("Southwest", "2,701", "2,893", "93.0%", "94.2%"),
    { ...row(b("Total"), b("11,748"), b("12,703"), b("94.6%"), b("96.1%")), shade: "#F2F2F2" },
  ),
  h(2, "2.2 Costs"),
  p("The cost per parcel fell to $3.42. Fuel and linehaul savings more than offset higher labor costs, as Figure 1 shows."),
  h(3, "2.2.1 Fuel"),
  p("Diesel averaged $3.71 per gallon in the quarter, 6% below Q2. The fuel surcharge passed most of the saving to customers, so the net effect on margin was small."),
  h(3, "2.2.2 Labor"),
  p("Hourly wages rose 3.5% on July 1. Overtime hours fell 11% as the new Columbus hub absorbed peak volume that had previously been handled at Indianapolis."),
  figure(
    { label: "Figure 1.", caption: ["Cost per parcel, Q4 2025 to Q3 2026 (USD)"], width: 0.8 },
    { kind: "bars", width: 520, height: 260, title: "Cost per parcel (USD)", unit: "USD", bars: [["Q4 2025", 3.61], ["Q1 2026", 3.55], ["Q2 2026", 3.51], ["Q3 2026", 3.42]] },
  ),

  h(1, "3. Risks and next steps"),
  p("Three risks could affect the fourth quarter. The register below lists each with its owner."),
  table(
    { label: "Table 2.", caption: ["Risk register for Q4 2026"], layout: { rules: "grid", shadeHeader: "#FCE4D6", widths: [3, 1, 1, 1.4] } },
    hrow(b("Risk"), b("Likelihood"), b("Impact"), b("Owner")),
    { ...row(cell({ colspan: 4 }, i("Operational risks"))), shade: "#F2F2F2" },
    row("Peak-season volume exceeds hub capacity", "Medium", "High", "J. Alvarez"),
    row("Driver shortage in the Southwest", "High", "Medium", "R. Chen"),
    { ...row(cell({ colspan: 4 }, i("Commercial risks"))), shade: "#F2F2F2" },
    row(cell({}, "Loss of a top-ten account at contract renewal", fn("2", "Two of the top ten contracts renew in November.")), "Low", "High", "S. Patel"),
  ),
  p("The operations team will take the following steps before the peak season:"),
  list(
    li("1.", "Open the temporary sort center in Phoenix by November 3."),
    li("2.", "Hire 140 seasonal drivers, 60 of them for the Southwest."),
    li("3.", "Review the capacity plan weekly from October 20, with daily reviews in December."),
  ),
  h(1, "Appendix: Definitions"),
  p(b("On-time delivery"), " is the share of parcels delivered by the date promised at the time of shipment."),
  p(b("Cost per parcel"), " is total operating cost, excluding depreciation, divided by the number of parcels delivered."),
];

export const report: Spec = {
  name: "report",
  title: "Q3 2026 Operations Review",
  category: "word",
  blocks,
  renderings: {
    docx: {
      font: "Calibri",
      size: 11,
      headingFont: "Calibri",
      headingColor: "1F3864",
      headingSizes: { 0: 24, 1: 16, 2: 13, 3: 11 },
      after: 8,
      header: { center: "CONFIDENTIAL" },
      footer: { left: "Q3 2026 Operations Review", right: "{PAGE}" },
      bands: { top: 60, bottom: 60 },
    },
  },
  notes: "Word's bullets are text glyphs (• and o). The second table's shaded rows that span all four columns name groups of risks.",
};
