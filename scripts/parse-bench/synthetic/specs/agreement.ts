/**
 * A Word-made subscription agreement: clauses numbered 1. / 1.1 / (a) / (i)
 * by Word's own numbering, defined terms in bold italics, a running header from page 2, "Page X of Y" in the
 * footer, a footnote, a ruled form with empty cells, a questionnaire with checkboxes and lettered options,
 * and a signature block laid out as a table without lines.
 */
import { b, bi, fn, h, hrow, li, li1, li2, li3, list, p, pagebreak, row, table, task, title, center, type Spec, type SpecBlock } from "../spec";

/** A defined term as the agreement prints it: in quotes, bold italic. */
const term = (word: string) => ["“", ...bi(word), "”"];

const blocks: SpecBlock[] = [
  title(b("SUBSCRIPTION AGREEMENT")),
  center(b("Harbor Point Capital Fund II, L.P.")),
  center("(a Delaware limited partnership)"),
  p(
    "This Subscription Agreement (this ",
    ...term("Agreement"),
    ") is entered into as of the date set forth on the signature page by and between Harbor Point Capital Fund II, L.P., a Delaware limited partnership (the ",
    ...term("Partnership"),
    "), and the undersigned subscriber (the ",
    ...term("Subscriber"),
    ").",
  ),
  h(2, b("Recitals")),
  p("WHEREAS, the Partnership is offering limited partnership interests to a limited number of investors in a private placement exempt from registration under the Securities Act of 1933, as amended (the ", ...term("Securities Act"), ");"),
  p("WHEREAS, the Subscriber wishes to subscribe for an interest in the Partnership on the terms and subject to the conditions of this Agreement and the Partnership’s limited partnership agreement (the ", ...term("Partnership Agreement"), ");"),
  p("NOW, THEREFORE, in consideration of the mutual covenants set forth below, the parties agree as follows:"),
  list(
    li("1.", b("Definitions")),
    li1("1.1", ...term("Accredited Investor"), " has the meaning given in Rule 501(a) of Regulation D under the Securities Act.", fn("1", "17 C.F.R. § 230.501(a).")),
    li1("1.2", ...term("Capital Commitment"), " means the amount set forth on the Subscriber’s signature page, as it may be reduced by the General Partner under Section 2.3."),
    li1("1.3", ...term("General Partner"), " means Harbor Point GP II, LLC, a Delaware limited liability company, or any successor general partner of the Partnership."),
    li("2.", b("Subscription")),
    li1("2.1", "Subject to the terms of this Agreement, the Subscriber irrevocably subscribes for a limited partnership interest in the Partnership (the ", ...term("Interest"), ") in the amount of its Capital Commitment."),
    li1("2.2", "The Subscriber shall pay its Capital Commitment in installments upon receipt of drawdown notices from the General Partner, each of which shall:"),
    li2("(a)", "specify the amount to be paid and the date on which payment is due, which shall be at least ten (10) business days after the date of the notice;"),
    li2("(b)", "state the purpose of the drawdown, including:"),
    li3("(i)", "the investment or expense to which the drawdown relates; and"),
    li3("(ii)", "the Subscriber’s pro rata share of the drawdown, expressed as a percentage of its Capital Commitment; and"),
    li2("(c)", "include wire instructions for the Partnership’s account."),
    li1("2.3", "The General Partner may accept or reject this subscription, in whole or in part, in its sole discretion. If the subscription is rejected in part, the Capital Commitment shall be reduced accordingly."),
    li("3.", b("Representations and Warranties of the Subscriber")),
    li1("3.1", b("Accredited status."), " The Subscriber is an Accredited Investor and has completed the Investor Questionnaire attached to this Agreement truthfully and completely."),
    li1("3.2", b("Investment intent."), " The Subscriber is acquiring the Interest for its own account, for investment purposes only, and not with a view to any resale or distribution of the Interest."),
    li1("3.3", b("Risk."), " The Subscriber understands that an investment in the Partnership involves a high degree of risk, including the risk of losing the entire investment, and that the Interest is not freely transferable."),
    li("4.", b("Miscellaneous")),
    li1("4.1", b("Governing law."), " This Agreement shall be governed by and construed in accordance with the laws of the State of Delaware, without regard to its conflict of laws rules."),
    li1("4.2", b("Counterparts."), " This Agreement may be executed in counterparts, each of which shall be deemed an original and all of which together shall constitute one instrument."),
    li1("4.3", b("Notices."), " All notices under this Agreement shall be in writing and delivered to the addresses set forth on the signature page."),
  ),
  pagebreak(),

  h(2, b("Subscriber Information")),
  p("Print or type. Attach additional pages if necessary."),
  table(
    { layout: { rules: "grid", widths: [2, 3] } },
    row(b("Name of Subscriber"), ""),
    row(b("Address"), ""),
    row(b("Taxpayer Identification Number"), ""),
    row(b("Telephone"), ""),
    row(b("E-mail"), ""),
  ),
  h(2, b("Investor Questionnaire")),
  p("Please complete each part. Check every box that applies."),
  h(3, b("Part A. Type of Subscriber")),
  list(task(false, "Individual"), task(true, "Limited liability company"), task(false, "Corporation"), task(false, "Trust"), task(false, "Other (specify): ______________")),
  h(3, b("Part B. Questions")),
  p(b("Question 1."), " How did the Subscriber learn of the Partnership?"),
  list(
    li("(a)", "Through an existing relationship with the General Partner"),
    li("(b)", "Through a placement agent"),
    li("(c)", "Through a financial advisor"),
    li("(d)", "Other: ______________________"),
  ),
  p(b("Question 2."), " Is the Subscriber a “benefit plan investor” as defined in Section 3(42) of ERISA?"),
  p("☐ Yes ☒ No"),
  p(b("Question 3."), " What is the source of the funds for the Capital Commitment? Check all that apply."),
  list(task(true, "Operating income"), task(false, "Sale of assets"), task(true, "Capital contributions of members"), task(false, "Loan proceeds")),
  pagebreak(),

  h(2, b("Signature Page")),
  p("IN WITNESS WHEREOF, the Subscriber has executed this Agreement as of the date set forth below."),
  table(
    { layout: { rules: "none", widths: [1, 1] } },
    hrow(b("SUBSCRIBER"), b("ACCEPTED: HARBOR POINT CAPITAL FUND II, L.P.")),
    row("By: ______________________", "By: Harbor Point GP II, LLC, its General Partner"),
    row("Name: ____________________", "By: ______________________"),
    row("Title: _____________________", "Name: Margaret Okafor"),
    row("Date: _____________________", "Title: Managing Member"),
    row("Capital Commitment: $______________", "Date: ______________________"),
  ),
];

export const agreement: Spec = {
  name: "agreement",
  title: "Subscription Agreement",
  category: "legal",
  blocks,
  renderings: {
    docx: {
      font: "Times New Roman",
      size: 11,
      headingSizes: { 0: 16, 2: 12, 3: 11 },
      after: 8,
      header: { left: "Harbor Point Capital Fund II, L.P.", right: "Subscription Agreement" },
      footer: { center: "Page {PAGE} of {PAGES}" },
      firstPage: { footer: { center: "Page {PAGE} of {PAGES}" } },
      bands: { top: 60, bottom: 60 },
    },
    // The same agreement printed from HTML: clause numbers are text in their own column, the header is the
    // page's margin boxes from page 2, and the footer reads "Page X of Y".
    html: {
      css: `
@page { size: letter; margin: 1in; @top-left { content: "Harbor Point Capital Fund II, L.P."; font: 9pt "Liberation Serif", serif; } @top-right { content: "Subscription Agreement"; font: 9pt "Liberation Serif", serif; } @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 9pt "Liberation Serif", serif; } }
@page :first { @top-left { content: none; } @top-right { content: none; } }
body { font: 11pt/1.3 "Liberation Serif", serif; }
p { margin: 0 0 9pt; }
p.title { font-size: 16pt; font-weight: bold; margin-bottom: 6pt; }
h2 { font-size: 12pt; margin: 12pt 0 6pt; }
h3 { font-size: 11pt; margin: 10pt 0 5pt; }
.list { margin: 0 0 9pt; }
.item { margin-bottom: 2pt; }
.item > .marker { min-width: 2.5em; text-align: left; padding-left: 0.25in; box-sizing: content-box; }
table { width: 100%; }
table.grid td { border: 1px solid #000; height: 18pt; }
table.none td, table.none th { text-align: left; padding: 1pt 8pt 1pt 0; }
p.footnote { font-size: 9pt; }
`,
      bands: { top: 60, bottom: 60 },
    },
  },
  notes: "In Word the clause numbers are Word numbering, so a parser reads them from the PDF's text only; in HTML they are text. The signature block is a table without lines; its first row is a header row. Blank lines to fill in are underscores. The footnote stands at the page's foot in Word and at the end in HTML.",
};
