/**
 * A community newsletter printed from HTML: a masthead, articles flowing in two CSS columns, a pull quote across
 * both columns that repeats a sentence of its article, photos with captions, a boxed sidebar of dates, bylines,
 * and a running foot with the issue's name and the page number.
 */
import { b, box, figure, h, i, li, list, p, quote, role, title, type Spec, type SpecBlock } from "../spec";

const pull = (text: string): SpecBlock => ({ kind: "quote", spans: [{ text }], pull: true });

const blocks: SpecBlock[] = [
  title("The Riverside Ledger"),
  role("subtitle", "News from the Riverside Community Garden · Autumn 2026 · Issue 14"),
  box(
    "columns",
    h(2, "Harvest festival draws a record crowd"),
    p(i("By Tomás Reyes")),
    p(
      "More than 900 neighbors came to the garden on September 13 for the eighth harvest festival, almost twice last year’s count. Volunteers weighed 1,340 pounds of produce at the market table, and the soup kitchen on Alder Street took home everything that was left at closing.",
    ),
    p(
      "The busiest stall was the seed library, where children traded bean seeds for stickers. “We grew more food this year than in the garden’s first five years combined,” said coordinator Joan Whitfield. She credited the new drip lines on the east beds, which kept the tomatoes alive through a dry August.",
    ),
    figure({ caption: ["Volunteers sort winter squash at the market table."], width: 1 }, { kind: "photo", width: 480, height: 300, seed: 7 }),
    p("The festival also raised $4,210 for next year’s greenhouse. The board will choose a builder in November and hopes to plant the first seedlings in March."),
    pull("“We grew more food this year than in the garden’s first five years combined.”"),
    h(2, "New rain gardens cut runoff"),
    p(i("By Dana Okonkwo")),
    p(
      "Two rain gardens planted along the north fence in May are now soaking up the runoff that used to flood the tool shed. Each garden is a shallow basin of native plants, deep-rooted asters, sedges, and swamp milkweed, that holds water after a storm and lets it sink into the ground over a day or two.",
    ),
    p(
      "City engineers measured the flow at the storm drain on Pine Street after the heavy rain of August 21. It carried about 40% less water than after a storm of the same size last year. The city has offered to fund two more basins if the garden’s volunteers will maintain them.",
    ),
    box(
      "sidebar",
      h(3, "Dates to remember"),
      list(
        li("•", b("October 12:"), " Seed swap, 10 a.m. to noon"),
        li("•", b("October 26:"), " Bulb planting and cider, 1 p.m."),
        li("•", b("November 9:"), " Annual meeting and board election, 7 p.m."),
        li("•", b("November 16:"), " Garden closes for the winter"),
      ),
    ),
    h(2, "From the compost desk"),
    p(i("By Ruth Albers")),
    p(
      "Our three compost bays turned out 6 cubic yards of finished compost this season. The trick, as always, is balance: roughly two parts brown material, such as dry leaves and straw, to one part green material, such as kitchen scraps and fresh clippings. Too much green and the pile smells; too much brown and it barely heats up.",
    ),
    figure({ caption: ["The new three-bay compost system, built from reclaimed pallets."], width: 1 }, { kind: "photo", width: 480, height: 280, seed: 23 }),
    p("Please keep meat, dairy, and oily food out of the bins. They attract rats, and the neighbors on Birch Lane have noticed. Coffee grounds, eggshells, and tea leaves are all welcome."),
    quote(i("“The garden is the only place in the city where I know every neighbor by name.” — a note left in the suggestion box")),
  ),
];

export const newsletter: Spec = {
  name: "newsletter",
  title: "The Riverside Ledger, Autumn 2026",
  category: "newsletter",
  blocks,
  renderings: {
    html: {
      css: `
@page { size: letter; margin: 0.7in 0.7in 0.8in; @bottom-left { content: "The Riverside Ledger · Autumn 2026"; font: 8.5pt "Liberation Sans", sans-serif; color: #555; } @bottom-right { content: "Page " counter(page); font: 8.5pt "Liberation Sans", sans-serif; color: #555; } }
body { font: 10.5pt/1.42 "Liberation Serif", serif; color: #111; }
p.title { font: bold 34pt/1.1 "Liberation Serif", serif; text-align: center; margin: 0; letter-spacing: 0.5pt; }
p.role-subtitle { font: 10pt "Liberation Sans", sans-serif; text-align: center; border-top: 2px solid #000; border-bottom: 1px solid #000; padding: 4pt 0; margin: 6pt 0 14pt; }
.box-columns { columns: 2; column-gap: 0.3in; }
h2 { font: bold 15pt/1.2 "Liberation Sans", sans-serif; margin: 0 0 3pt; break-after: avoid; }
h3 { font: bold 11pt "Liberation Sans", sans-serif; margin: 0 0 4pt; }
p { text-align: justify; margin: 0 0 7pt; }
figure { margin: 4pt 0 10pt; }
figure img { width: 100%; height: auto; display: block; }
.caption { font: italic 8.5pt "Liberation Sans", sans-serif; text-align: left; }
blockquote.pull { column-span: all; font: italic 16pt/1.3 "Liberation Serif", serif; text-align: center; border-top: 1px solid #000; border-bottom: 1px solid #000; margin: 8pt 0.6in 12pt; padding: 8pt 0; }
blockquote { margin: 8pt 0 8pt 12pt; }
.box-sidebar { border: 1.5px solid #333; background: #f1f4ea; padding: 6pt 8pt; margin: 4pt 0 10pt; break-inside: avoid; }
.box-sidebar .item > .marker { min-width: 1em; }
`,
      bands: { top: 40, bottom: 44 },
    },
  },
  notes: "The pull quote repeats a sentence of its article, as pull quotes do; both stand in the reference. The photos are pixels with no words. The sidebar's list sits inside the second column.",
};
