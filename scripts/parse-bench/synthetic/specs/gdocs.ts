/**
 * Meeting notes laid out the way a Google Docs PDF export looks: Arial, a title,
 * headings, bold runs, links, yellow highlights, a red run, a struck-through run, an underlined date, bullets whose
 * glyph changes with depth (● ○ ■), a checklist, a
 * table, a horizontal rule, a diagram drawn in SVG whose box labels and arrow labels are text in the PDF, and a
 * paragraph in Chinese. No header or footer, as in an export.
 */
import { b, colored, figure, h, highlight, hr, hrow, li, li1, li2, link, list, p, row, strike, table, task, title, u, type Spec, type SpecBlock } from "../spec";

const blocks: SpecBlock[] = [
  title("Project Aurora: Weekly Notes"),
  p("Week of September 21, 2026 · Owner: ", link("https://example.com/people/lena-ortiz", "Lena Ortiz"), " · Attendees: Marco, Priya, Wei, Sam"),
  h(1, "Summary"),
  p(
    "The beta opened to ",
    b("1,200 users"),
    " on Tuesday. Crash-free sessions reached ",
    ...highlight("#ffff00", b("99.2%")),
    ", above the ",
    ...link("https://example.com/aurora/slo", "service-level objective"),
    " of 99%. The main complaint in feedback was ",
    ...colored("#cc0000", "slow sync on hotel and airport Wi-Fi"),
    ", which the offline mode below addresses.",
  ),
  h(1, "Decisions"),
  list(
    li("●", "Ship the offline mode in release 2.4"),
    li1("○", "Sync conflicts resolve to the newest edit"),
    li2("■", "The older edit stays in version history for 30 days"),
    li1("○", "The app shows a banner while it is offline"),
    li("●", "Move the Android 15 fix ahead of the settings redesign"),
    li("●", "Keep the weekly beta build on ", ...strike("Tuesdays"), " ", b("Thursdays"), " until launch"),
  ),
  h(1, "Action items"),
  list(
    task(true, "Draft the release notes for 2.4 (Lena)"),
    task(false, "Fix the login loop on Android 15 (Marco)"),
    task(false, "Book the design review for ", ...u("October 2"), " (Priya)"),
    task(false, "Add sync timing to the beta dashboard (Wei)"),
  ),
  h(1, "Metrics"),
  table(
    { layout: { rules: "grid", align: "lrrr" } },
    hrow(b("Metric"), b("Last week"), b("This week"), b("Target")),
    row("Crash-free sessions", "98.7%", "99.2%", "99.0%"),
    row("Median sync time", "4.8 s", "3.1 s", "2.0 s"),
    row("Weekly active users", "860", "1,140", "1,000"),
    row("Support tickets", "37", "22", "25"),
  ),
  p("Median sync time is still above target. ", ...highlight("#ffff00", "Wei will add a breakdown by network type"), " so we can see whether the slow cases are all on public Wi-Fi."),
  hr(),
  h(1, "Architecture"),
  p("The diagram shows how an edit travels from one device to the others. The ", b("sync service"), " is the only part that talks to the database."),
  figure(
    { width: 0.9 },
    {
      kind: "diagram",
      width: 560,
      height: 230,
      boxes: [
        { id: "phone", label: "Phone app", x: 20, y: 30, w: 130, h: 44, round: true },
        { id: "sync", label: "Sync service", x: 215, y: 30, w: 140, h: 44 },
        { id: "db", label: "Database", x: 420, y: 30, w: 120, h: 44 },
        { id: "push", label: "Push notifier", x: 215, y: 150, w: 140, h: 44 },
        { id: "laptop", label: "Laptop app", x: 20, y: 150, w: 130, h: 44, round: true },
      ],
      arrows: [
        ["phone", "sync", "edit"],
        ["sync", "db", "write"],
        ["sync", "push", "fan-out"],
        ["push", "laptop", "notify"],
      ],
    },
  ),
  h(1, "Notes from the Shanghai office"),
  p("上海团队本周完成了离线模式的测试，发现了三个同步问题，其中两个已经修复。下周将重点测试弱网环境下的冲突处理，并整理一份测试报告。"),
  h(2, "Links"),
  list(
    li("●", ...link("https://example.com/aurora/beta-dashboard", "Beta dashboard")),
    li("●", ...link("https://example.com/aurora/crashes", "Crash reports"), " (filtered to release 2.3)"),
    li("●", ...link("https://example.com/aurora/design-review", "Design review agenda")),
  ),
];

export const gdocs: Spec = {
  name: "gdocs",
  title: "Project Aurora: Weekly Notes",
  category: "notes",
  blocks,
  renderings: {
    html: {
      css: `
@page { size: letter; margin: 1in; }
body { font: 11pt/1.4 Arial, "Liberation Sans", sans-serif; color: #000; }
p { margin: 0 0 8pt; }
p.title { font-size: 26pt; margin: 0 0 6pt; }
h1 { font-size: 20pt; font-weight: normal; margin: 20pt 0 6pt; }
h2 { font-size: 16pt; font-weight: normal; margin: 18pt 0 6pt; }
a { color: #1155cc; }
mark { color: inherit; }
.list { margin: 0 0 8pt; }
.item > .marker { min-width: 1.6em; text-align: left; font-size: 0.8em; line-height: 1.75; }
table.grid { width: 100%; }
table.grid th, table.grid td { border: 1px solid #000; padding: 5pt; }
hr { border: 0; border-top: 1px solid #888; margin: 14pt 0; }
figure { margin: 8pt 0; }
`,
      bands: { top: 0, bottom: 0 },
    },
    // The same notes made in Word: the bullets are Word numbering with the same glyphs, the boxes of the
    // checklist are text, and the diagram is a picture (its labels are pixels, not text).
    docx: {
      font: "Arial",
      size: 11,
      headingFont: "Arial",
      headingSizes: { 0: 26, 1: 20, 2: 16 },
      headingBold: false,
      after: 8,
      bands: { top: 0, bottom: 0 },
    },
  },
  notes: "Bullet glyphs change with depth (● ○ ■) and are text in the PDF. In HTML the diagram's box and arrow labels are text in the PDF but belong to the figure; in Word the diagram is a picture. The Chinese paragraph is set in WenQuanYi Zen Hei.",
};
