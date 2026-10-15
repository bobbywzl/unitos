// A command's scope (lib/docs/suggest-ops.ts scopeOf, lib/assistant/plan.ts):
// a heading in blockIds is the heading alone; a heading in sections brings
// every block under it, down to the next heading of its level or above.
// Several suggest actions join into one with their blocks and sections.
import { enrichActions, parseActionsFence, type PlanContext } from "@/lib/assistant/plan";
import { scopeOf, type BlockPlace } from "@/lib/docs/suggest-ops";
import { translatorFor } from "@/lib/i18n/dictionaries";

let failed = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`}`);
};

const rows = [
  { id: "h1", type: "HEADING", text: "Method" },
  { id: "p1", type: "PARAGRAPH", text: "A router scores the keys." },
  { id: "h2", type: "HEADING", text: "Cost" },
  { id: "p2", type: "PARAGRAPH", text: "Routing adds one pass." },
  { id: "h3", type: "HEADING", text: "Results" },
  { id: "p3", type: "PARAGRAPH", text: "It keeps 98 percent." },
];
const place = (style: BlockPlace["style"]): BlockPlace => ({ style, where: "body", container: "doc", group: null });
const places = new Map<string, BlockPlace>([
  ["h1", place("h1")],
  ["p1", place("normal")],
  ["h2", place("h2")],
  ["p2", place("normal")],
  ["h3", place("h1")],
  ["p3", place("normal")],
]);

check("a heading in blockIds is the heading alone", scopeOf(rows, places, ["h1"]), ["h1"]);
check("a heading in sections brings its section and its subsections", scopeOf(rows, places, [], ["h1"]), ["h1", "p1", "h2", "p2"]);
check("a subsection ends at the next heading of its level or above", scopeOf(rows, places, [], ["h2"]), ["h2", "p2"]);
check("blocks and sections together", scopeOf(rows, places, ["p3"], ["h2"]), ["h2", "p2", "p3"]);

const ctx: PlanContext = {
  documentId: "doc",
  edits: "suggestions",
  format: null,
  blocks: rows.map((r) => ({ ...r, html: null })),
  attachedIds: new Set(["doc"]),
  sectionIds: new Set(),
  t: translatorFor("en"),
};
const plan = (json: unknown) => enrichActions(parseActionsFence(JSON.stringify(json), "", "suggestions") ?? { actions: [], unreadable: [] }, ctx);

const sectioned = plan([{ type: "suggest", instruction: "Rewrite the Cost section in plain words.", sections: ["h2"], description: "Rewrites the Cost section." }]);
const s = sectioned.actions[0];
check("a section by its heading is kept", s?.type === "suggest" ? [s.blockIds, s.sections] : null, [undefined, ["h2"]]);

const empty = plan([{ type: "suggest", instruction: "Rewrite the Cost paragraph.", blockIds: ["p2"], sections: [], description: "Rewrites a paragraph." }]);
check("an empty sections list is left out", empty.actions.map((a) => (a.type === "suggest" ? [a.blockIds, a.sections] : null)), [[["p2"], undefined]]);

const notHeading = plan([{ type: "suggest", instruction: "Rewrite this.", sections: ["p2"], description: "Rewrites a paragraph." }]);
check("a section named by a block that is not a heading is dropped and warned", [notHeading.actions.length, notHeading.warnings.length], [0, 1]);

const joined = plan([
  { type: "suggest", instruction: "Bold the Method heading.", blockIds: ["h1"], description: "Bolds the heading." },
  { type: "suggest", instruction: "Rewrite the Results section.", sections: ["h3"], description: "Rewrites Results." },
]).actions;
check("joined actions keep their blocks and their sections", joined.map((a) => (a.type === "suggest" ? [a.blockIds, a.sections] : null)), [[["h1"], ["h3"]]]);

const wide = plan([
  { type: "suggest", instruction: "Bold the Method heading.", blockIds: ["h1"], description: "Bolds the heading." },
  { type: "suggest", instruction: "Fix the spelling everywhere.", description: "Fixes the spelling." },
]).actions;
check("one action over the whole document makes the joined one whole", wide.map((a) => (a.type === "suggest" ? [a.blockIds, a.sections] : null)), [[undefined, undefined]]);

console.log(failed === 0 ? "section-scope-check: all passed" : `section-scope-check: ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
