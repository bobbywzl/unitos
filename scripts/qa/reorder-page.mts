// The order pass's moves in the page editor (components/docs/suggest/
// assistant.ts move_blocks), checked in a headless editor with the page
// editor's own extensions: the moves land as one suggestion per run, the
// paragraph index reads the document as it was until they are accepted,
// Accept all gives the new order with every block's words, and Reject all
// gives the document back as it was. A block whose words the same command
// changed moves with the new words, and every moved block keeps its id.
// The page editor's code is ESM with CSS imports, so it runs bundled:
//   npx esbuild scripts/qa/reorder-page.mts --bundle --platform=node --format=esm \
//     --loader:.css=empty --external:jsdom --external:@prisma/client \
//     --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
//     --outfile=node_modules/.cache/reorder-page.mjs && node node_modules/.cache/reorder-page.mjs
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const g = globalThis as unknown as Record<string, unknown>;
for (const key of ["window", "document", "navigator", "Node", "HTMLElement", "Element", "DocumentFragment", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "DOMParser", "Text", "Range", "Selection", "CustomEvent", "Event", "KeyboardEvent", "ClipboardEvent", "InputEvent"]) {
  if (!(key in g) || key === "window" || key === "document") {
    try {
      g[key] = (dom.window as unknown as Record<string, unknown>)[key];
    } catch {
      /* read-only in this Node */
    }
  }
}
(dom.window.document as unknown as { getSelection: () => null }).getSelection ??= () => null;
// The page's layout watchers have nothing to measure here.
g.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
g.IntersectionObserver ??= g.ResizeObserver;
Object.defineProperty(dom.window.document, "fonts", { value: { addEventListener() {}, removeEventListener() {}, ready: Promise.resolve() } });

async function main() {
  const { Editor } = await import("@tiptap/core");
  const { docsExtensions } = await import("@/components/docs/extensions");
  const { applyAssistantOps } = await import("@/components/docs/suggest/assistant");
  const { settleSuggestions, readSuggestions } = await import("@/components/docs/ext/suggest");
  const { deriveBlocks } = await import("@/lib/docs/blocks");
  const { planOrder } = await import("@/lib/assistant/reorder");
  const { orderSuggestOps, richTextUnits } = await import("@/lib/assistant/reorder-run");
  const { assistantAuthor } = await import("@/lib/docs/assistant-suggestions");
  type RichNode = import("@/lib/docs/schema").RichNode;

  const p = (id: string, text: string): RichNode => ({ type: "paragraph", attrs: { blockId: id }, content: [{ type: "text", text }] });
  const h = (id: string, text: string): RichNode => ({ type: "heading", attrs: { blockId: id, level: 2 }, content: [{ type: "text", text }] });
  const list = (items: [string, string][]): RichNode => ({
    type: "bulletList",
    content: items.map(([id, text]) => ({ type: "listItem", content: [p(id, text)] })),
  });
  const start: RichNode = {
    type: "doc",
    content: [
      h("h1", "Notes"),
      p("q1", "“Cats sleep sixteen hours a day.”"),
      p("c1", "This seems high to me, but plausible."),
      p("q2", "“Rivers carve canyons over millions of years.”"),
      p("c2", "Geology is slow."),
      list([
        ["l1", "Cats purr"],
        ["l2", "Cats climb"],
      ]),
      p("q3", "“Dogs were domesticated from wolves.”"),
    ],
  };
  const userId = "user1";
  const author = assistantAuthor(userId);
  let failures = 0;
  const check = (ok: boolean, what: string) => {
    if (!ok) failures++;
    console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  };
  const words = (doc: RichNode) => deriveBlocks(doc).map((b) => b.text);
  const before = words(start);

  const make = () => new Editor({ element: document.createElement("div"), extensions: docsExtensions(), content: start, injectCSS: false });
  const rows = deriveBlocks(start).map((b) => ({ id: b.id, type: b.type, text: b.text }));
  const units = richTextUnits(start, rows);
  check(units.length === 8 && units[5].rowIds.join() === "l1" && units[6].rowIds.join() === "l2", "each item of a list is a unit");
  // Group by theme: animals, then geology.
  const plan = planOrder(units, units.map((_, u) => u), {
    order: [
      { heading: "Animals", level: 2 },
      { blockId: "q1" },
      { blockId: "c1" },
      { blockId: "l1" },
      { blockId: "q3" },
      { heading: "Geology", level: 2 },
      { blockId: "q2" },
      { blockId: "c2" },
    ],
    removeHeadings: ["h1"],
  })!;
  const ops = orderSuggestOps(units, units.map((_, u) => u), plan, rows, "Group the notes by theme.");

  // 1. The moves alone.
  {
    const editor = make();
    const landed = applyAssistantOps(editor, ops, author);
    check(landed.skipped.length === 0, `every op lands (skipped: ${JSON.stringify(landed.skipped)})`);
    const doc = editor.getJSON() as RichNode;
    check(JSON.stringify(words(doc)) === JSON.stringify(before), "the paragraph index reads the document as it was while the moves are pending");
    check(readSuggestions(editor.state.doc).length > 0, "the moves are suggestions");
    settleSuggestions(editor, true);
    const accepted = words(editor.getJSON() as RichNode);
    const want = ["Animals", before[1], before[2], "Cats purr", "Cats climb", before[7], "Geology", before[3], before[4]];
    check(JSON.stringify(accepted) === JSON.stringify(want), `Accept all gives the new order\n     got  ${JSON.stringify(accepted)}\n     want ${JSON.stringify(want)}`);
    // Every moved block keeps its id, so the anchors on it stay.
    const ids = deriveBlocks(editor.getJSON() as RichNode).map((b) => b.id);
    const wantIds = ["q1", "c1", "l1", "l2", "q3", "q2", "c2"];
    check(JSON.stringify(ids.filter((id) => wantIds.includes(id))) === JSON.stringify(wantIds) && ids.length === 9, `every block keeps its id (${ids.join(" ")})`);
    editor.destroy();
  }
  {
    const editor = make();
    applyAssistantOps(editor, ops, author);
    settleSuggestions(editor, false);
    check(JSON.stringify(words(editor.getJSON() as RichNode)) === JSON.stringify(before), "Reject all gives the document back");
    editor.destroy();
  }
  // 2. The same command shortened a comment first (a window's op), then the moves land.
  {
    const editor = make();
    applyAssistantOps(editor, [{ i: 0, op: "rewrite_block", blockId: "c2", base: "Geology is slow.", text: "Slow.", why: "Shorter." }], author);
    const landed = applyAssistantOps(editor, ops, author);
    check(landed.skipped.length === 0, `the moves land over the window's change (skipped: ${JSON.stringify(landed.skipped)})`);
    const pending = words(editor.getJSON() as RichNode);
    check(JSON.stringify(pending) === JSON.stringify(before), "the index still reads the document as it was");
    settleSuggestions(editor, true);
    const accepted = words(editor.getJSON() as RichNode);
    check(accepted[accepted.length - 1] === "Slow." && !accepted.includes("Geology is slow."), `the moved block carries the new words (${JSON.stringify(accepted)})`);
    const last = deriveBlocks(editor.getJSON() as RichNode).at(-1);
    check(last?.id === "c2", `the rewritten, moved block keeps its id (${last?.id})`);
    editor.destroy();
  }
  {
    const editor = make();
    applyAssistantOps(editor, [{ i: 0, op: "rewrite_block", blockId: "c2", base: "Geology is slow.", text: "Slow.", why: "Shorter." }], author);
    applyAssistantOps(editor, ops, author);
    settleSuggestions(editor, false);
    check(JSON.stringify(words(editor.getJSON() as RichNode)) === JSON.stringify(before), "Reject all gives the document back, the old words too");
    editor.destroy();
  }
  // 3. The one pass (lib/assistant/one-pass.ts): a recorded answer to "group
  // by themes, keep the quotes, erase the commentary", with one made-up
  // number in a rewrite, read, grounded, and landed.
  {
    const { onePassAnswerSchema, readOnePass, orderOf } = await import("@/lib/assistant/one-pass");
    const { groundingOf } = await import("@/lib/docs/grounding");
    const { blockPlaces } = await import("@/lib/docs/suggest-ops");
    const answer = onePassAnswerSchema.parse({
      summary: "Grouped the quotes by theme and erased the commentary.",
      why: "Group by theme; keep the quotes.",
      document: [
        { new: "## Animals" },
        "q1",
        "l1",
        "q3",
        { new: "## Geology" },
        { id: "q2", text: "\u201cRivers carve canyons over 5 million years.\u201d" },
        "nope",
      ],
      remove: ["c1", "c2", "h1"],
      formats: [],
    });
    const scope = units.map((_, u) => u);
    const t = ((key: string, vars?: Record<string, unknown>) => `${key} ${JSON.stringify(vars ?? {})}`) as unknown as import("@/lib/i18n/dictionaries").TFunc;
    const read = readOnePass(answer, {
      rows,
      units,
      places: blockPlaces(start),
      scope,
      grounding: groundingOf([...rows.map((r) => r.text), "group by themes, keep the quotes, erase the commentary"]),
      t,
    });
    check(read.warnings.some((w) => w.includes("suggestSkipUnsupported") && w.includes("5")), `the made-up number is skipped (${read.warnings.join(" | ")})`);
    const order = orderOf(units, scope, read, new Set());
    const first = Math.max(-1, ...read.ops.map((op) => op.i)) + 1;
    const ops2 = [...read.ops, ...(order ? orderSuggestOps(units, scope, { ...order, removed: [] }, rows, read.why, first) : [])];
    const editor = make();
    const landed = applyAssistantOps(editor, ops2, author);
    check(landed.skipped.length === 0, `the one pass lands (skipped: ${JSON.stringify(landed.skipped)})`);
    settleSuggestions(editor, true);
    const accepted = words(editor.getJSON() as RichNode);
    const want = ["Animals", before[1], "Cats purr", "Cats climb", before[7], "Geology", before[3]];
    check(JSON.stringify(accepted) === JSON.stringify(want), `Accept all: grouped, commentary gone, quotes word for word\n     got  ${JSON.stringify(accepted)}\n     want ${JSON.stringify(want)}`);
    editor.destroy();
    const again = make();
    applyAssistantOps(again, ops2, author);
    settleSuggestions(again, false);
    check(JSON.stringify(words(again.getJSON() as RichNode)) === JSON.stringify(before), "Reject all gives the document back");
    again.destroy();
  }
  // 4. List lines (lib/assistant/reorder-run.ts richTextUnits: each item of
  // a top-level list is a unit): a line moves within its list, out of it,
  // into another list, and a block put after a line splits the list.
  const lists = (doc: RichNode) => (doc.content ?? []).filter((n) => n.type === "bulletList").map((n) => (n.content ?? []).length);
  const run = (
    what: string,
    doc: RichNode,
    order: { blockId: string }[],
    want: string[],
    wantLists: number[],
  ) => {
    const rows2 = deriveBlocks(doc).map((b) => ({ id: b.id, type: b.type, text: b.text }));
    const units2 = richTextUnits(doc, rows2);
    const scope2 = units2.map((_, u) => u);
    const plan2 = planOrder(units2, scope2, { order, removeHeadings: [] });
    check(plan2 !== null, `${what}: the order plans`);
    if (!plan2) return;
    const ops3 = orderSuggestOps(units2, scope2, plan2, rows2, what);
    const before2 = words(doc);
    const editor = new Editor({ element: document.createElement("div"), extensions: docsExtensions(), content: doc, injectCSS: false });
    const landed = applyAssistantOps(editor, ops3, author);
    check(landed.skipped.length === 0, `${what}: every op lands (skipped: ${JSON.stringify(landed.skipped)})`);
    let valid = true;
    try {
      editor.state.doc.check();
    } catch {
      valid = false;
    }
    check(valid, `${what}: the document is valid while the move is pending`);
    if (process.env.DEBUG_MOVE && what.includes(process.env.DEBUG_MOVE)) console.log("OPS " + JSON.stringify(ops3) + "\n" + JSON.stringify(editor.getJSON(), null, 1));
    check(JSON.stringify(words(editor.getJSON() as RichNode)) === JSON.stringify(before2), `${what}: the index reads the document as it was while the move is pending`);
    settleSuggestions(editor, true);
    const accepted = words(editor.getJSON() as RichNode);
    check(JSON.stringify(accepted) === JSON.stringify(want), `${what}: Accept all gives the new order\n     got  ${JSON.stringify(accepted)}\n     want ${JSON.stringify(want)}`);
    const got = lists(editor.getJSON() as RichNode);
    check(JSON.stringify(got) === JSON.stringify(wantLists), `${what}: the lists after Accept all are ${JSON.stringify(got)} (want ${JSON.stringify(wantLists)})`);
    editor.destroy();
    const again = new Editor({ element: document.createElement("div"), extensions: docsExtensions(), content: doc, injectCSS: false });
    applyAssistantOps(again, ops3, author);
    settleSuggestions(again, false);
    check(JSON.stringify(words(again.getJSON() as RichNode)) === JSON.stringify(before2) && JSON.stringify(lists(again.getJSON() as RichNode)) === JSON.stringify(lists(doc)), `${what}: Reject all gives the document back`);
    again.destroy();
  };
  const id = (blockId: string) => ({ blockId });
  run("a line moves within its list", start, ["h1", "q1", "c1", "q2", "c2", "l2", "l1", "q3"].map(id), [before[0], before[1], before[2], before[3], before[4], "Cats climb", "Cats purr", before[7]], [2]);
  run("a line moves out of its list to the end", start, ["h1", "q1", "c1", "q2", "c2", "l2", "q3", "l1"].map(id), [before[0], before[1], before[2], before[3], before[4], "Cats climb", before[7], "Cats purr"], [1, 1]);
  // A block between two lines: the lines move around it (lib/assistant/reorder.ts moveRuns prefers to move an item), so the list splits in two.
  run("a block between two lines", start, ["h1", "q1", "c1", "q2", "l1", "c2", "l2", "q3"].map(id), [before[0], before[1], before[2], before[3], "Cats purr", before[4], "Cats climb", before[7]], [1, 1]);
  {
    // A new block cannot go between the lines of a list: that move is skipped and nothing changes.
    const order: import("@/lib/assistant/reorder").OrderEntry[] = [id("h1"), id("q1"), id("c1"), id("q2"), id("c2"), id("l1"), { heading: "Between", level: 2 }, id("l2"), id("q3")];
    const plan2 = planOrder(units, units.map((_, u) => u), { order, removeHeadings: [] })!;
    const ops3 = orderSuggestOps(units, units.map((_, u) => u), plan2, rows, "A heading between two lines.");
    const editor = make();
    const landed = applyAssistantOps(editor, ops3, author);
    check(landed.skipped.length === 1 && landed.skipped[0].reason === "notText" && JSON.stringify(words(editor.getJSON() as RichNode)) === JSON.stringify(before), `a new block put between the lines of a list is skipped (${JSON.stringify(landed.skipped)})`);
    editor.destroy();
  }
  const two: RichNode = {
    type: "doc",
    content: [
      h("h1", "Two lists"),
      list([
        ["a1", "Apples"],
        ["a2", "Apricots"],
      ]),
      p("p1", "Between the lists."),
      list([
        ["b1", "Beans"],
        ["b2", "Beets"],
      ]),
    ],
  };
  run("a line moves into another list", two, ["h1", "a1", "p1", "b1", "a2", "b2"].map(id), ["Two lists", "Apples", "Between the lists.", "Beans", "Apricots", "Beets"], [1, 3]);
  run("a list every line of which moves goes with them", two, ["h1", "p1", "b1", "b2", "a1", "a2"].map(id), ["Two lists", "Between the lists.", "Beans", "Beets", "Apples", "Apricots"], [4]);
  run("a line moves to the start of the next list", two, ["h1", "a1", "p1", "a2", "b1", "b2"].map(id), ["Two lists", "Apples", "Between the lists.", "Apricots", "Beans", "Beets"], [1, 3]);
  console.log(failures === 0 ? "reorder-page: all passed" : `reorder-page: ${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
