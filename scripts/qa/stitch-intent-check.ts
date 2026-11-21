// Stitch (SPEC.md §22): it answers in its reply, makes links or a page only
// when the command asks for them, and reads and links only the documents
// picked. Run against the local database and the stand-in model, whose
// answer always carries a link and a page whatever the command asks, so
// what is stored is the route's own decision.
//
//   node scripts/qa/mock-kimi.mjs &            # :3399
//   MOONSHOT_API_KEY=mock MOONSHOT_BASE_URL=http://localhost:3399/v1 \
//     npx tsx scripts/qa/stitch-intent-check.ts [notebookId]
//
// The project needs three text documents (scripts/qa/seed.mjs makes them).
// The check removes the links and the pages it made.
import { db } from "@/lib/db";
import { commandNamesLinks, namesLinks, replyWithIds, stitch, type StitchTurn } from "@/lib/graph/stitch";
import { translate } from "@/lib/i18n/dictionaries";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

async function main() {
  // ── The words that ask for links ─────────────────────────────────────────
  const asks = ["Link the passages that answer this", "connect the sections on pricing", "Cross-reference the two reports", "tie these calls together", "链接回答这个问题的片段", "把这些段落关联起来"];
  const doesNot = [
    "Extract the points where the CEO talks about customer experience and user-centric innovation",
    "Find where these documents contradict each other",
    "Summarize what they say related to machine learning",
    "What is the relationship between ads and revenue?",
    "List every number on LinkedIn growth",
    "提取关于用户体验的要点",
  ];
  check("a command to link names links", asks.every(namesLinks), asks.filter((c) => !namesLinks(c)).join(" | "));
  check("a command to extract, find, or summarise names none", !doesNot.some(namesLinks), doesNot.filter(namesLinks).join(" | "));
  const held = translate("en", "stitch.stitchLinksHeld");
  const before: StitchTurn[] = [
    { role: "user", content: "Extract the points on defaults" },
    { role: "assistant", content: `**Memo**\n- A point.\n\n${held}` },
  ];
  check("a short yes after the held line asks for links", commandNamesLinks("yes", before));
  check("a short yes after a plain answer does not", !commandNamesLinks("yes", [before[0], { role: "assistant", content: "**Memo**\n- A point." }]));
  check("a long command is read on its own words", !commandNamesLinks("Extract every point the reports make about customer experience, by quarter", before));

  // ── A reply's tags ───────────────────────────────────────────────────────
  const block = (id: string, alias: string, documentId: string) => ({ id, alias, type: "PARAGRAPH", text: "x", documentId });
  const refs = new Map(
    [block("idA1", "A1", "docA"), block("idA2", "A2", "docA"), block("idA3", "A3", "docA"), block("idB7", "B7", "docB")].flatMap((b) => [
      [b.alias, b] as const,
      [b.id, b] as const,
    ]),
  );
  const tagged = replyWithIds("One [block A1]. Two [block A2, B7]. Three [block A1-A3]. Four [block ZZ999]. Five [block idB7].", refs);
  check(
    "a reply's tags become stored ids; a tag naming no block is taken out",
    tagged.reply === "One [block idA1]. Two [block idA2] [block idB7]. Three [block idA1] [block idA2] [block idA3]. Four. Five [block idB7].",
    tagged.reply,
  );
  check("each cited block carries its document", JSON.stringify(tagged.cited) === JSON.stringify({ idA1: "docA", idA2: "docA", idB7: "docB", idA3: "docA" }), JSON.stringify(tagged.cited));
  check("text with no tag is left as it is", replyWithIds("Le prix : 3 € ! Vraiment ?", refs).reply === "Le prix : 3 € ! Vraiment ?");

  // ── The project ──────────────────────────────────────────────────────────
  const wanted = process.argv[2];
  const notebook = await db.notebook.findFirst({
    where: wanted ? { id: wanted } : { title: "QA Analyst" },
    select: { id: true, documents: { select: { documentId: true, document: { select: { title: true, generatedCommand: true, handwritten: true, richText: true, blocks: { where: { type: "PARAGRAPH" }, select: { id: true }, take: 1 } } } } } },
  });
  if (!notebook) throw new Error("No project: run scripts/qa/seed.mjs, or pass a notebook id.");
  const text = notebook.documents.filter((d) => !d.document.generatedCommand && !d.document.handwritten && d.document.richText === null && d.document.blocks.length > 0);
  if (text.length < 3) throw new Error("The project needs three text documents.");
  const [a, b, c] = text.map((d) => d.documentId);
  const pick = [a, b];
  const outsideBlock = text[2].document.blocks[0].id;

  const made: { links: string[]; documents: string[] } = { links: [], documents: [] };
  const run = async (command: string, documentIds: string[] | null, history: StitchTurn[] = []) => {
    const since = new Date();
    const result = await stitch({
      notebookId: notebook.id,
      documentIds,
      userId: null,
      lang: "en",
      command,
      history,
      onFailure: (reason) => new Error(reason),
    });
    const links = await db.docLink.findMany({
      where: { createdAt: { gte: since }, OR: [{ fromDocumentId: { in: text.map((d) => d.documentId) } }, ...(result.document ? [{ fromDocumentId: result.document.id }] : [])] },
      select: { id: true, recommended: true, fromDocumentId: true, toDocumentId: true },
    });
    made.links.push(...links.map((l) => l.id));
    if (result.document) made.documents.push(result.document.id);
    return { result, links, recommended: links.filter((l) => l.recommended) };
  };
  const clearLinks = async () => {
    await db.docLink.deleteMany({ where: { id: { in: made.links } } });
    made.links = [];
  };

  try {
    // 1. A command to extract: an answer, and nothing stored.
    let r = await run("Extract the points where the memo talks about customer experience and user-centric innovation", pick);
    check("extract: the reply is the answer", r.result.reply.includes("Mock point one"), r.result.reply.slice(0, 80));
    check("extract: no link is made", r.result.linkCount === 0 && r.recommended.length === 0, `${r.recommended.length} stored`);
    check("extract: no page is written", r.result.document === null);
    check("extract: only the picked documents are read", JSON.stringify(r.result.documents.map((d) => d.id).sort()) === JSON.stringify([...pick].sort()), r.result.documents.map((d) => d.title).join(" | "));
    const citedDocs = new Set(Object.values(r.result.cited ?? {}));
    check("extract: the reply cites blocks of the picked documents, by stored id", citedDocs.size === 2 && [...citedDocs].every((id) => pick.includes(id)) && !/\[block [A-Z]+\d+\]/.test(r.result.reply), r.result.reply);
    check("extract: the tag that names no block is gone", !r.result.reply.includes("ZZ999"));
    check("extract: no held line under a plain answer", !r.result.reply.includes(held));

    // 2. A command to link: links, recommended, between the picked documents only.
    r = await run(`Link the passages that make the same claim MOCK-OUTSIDE:${outsideBlock}`, pick);
    check("link: one link is proposed", r.result.linkCount === 1 && r.recommended.length === 1, `${r.recommended.length} stored`);
    check("link: both ends are picked documents", r.recommended.every((l) => pick.includes(l.fromDocumentId) && pick.includes(l.toDocumentId)));
    check("link: a link to a block of a document that was not picked is dropped", !r.links.some((l) => l.toDocumentId === c || l.fromDocumentId === c));
    check("link: no page is written", r.result.document === null);
    await clearLinks();

    // 3. The model says links were asked for; the reader's words name none.
    r = await run("Extract the key points MOCK-CLAIMS-L", pick);
    check("held: no link is made", r.result.linkCount === 0 && r.recommended.length === 0);
    check("held: the reply says so and how to ask", r.result.reply.endsWith(held), r.result.reply.slice(-90));

    // 4. "yes" after the held line: now the links are made.
    r = await run("yes MOCK-CLAIMS-L", pick, [
      { role: "user", content: "Extract the key points" },
      { role: "assistant", content: r.result.reply },
    ]);
    check("yes after the held line: the link is made", r.result.linkCount === 1 && r.recommended.length === 1);
    await clearLinks();

    // 5. A command for a page: a page, and no link.
    r = await run("Write one page that gathers these passages", pick);
    check("page: a page is written", r.result.document !== null);
    check("page: no link is proposed", r.result.linkCount === 0 && r.recommended.length === 0);
    check("page: every source link of the page goes to a picked document", r.links.length > 0 && r.links.every((l) => !l.recommended && pick.includes(l.toDocumentId)), `${r.links.length} source links`);
    await clearLinks();

    // 6. An answer that does not say what was asked: nothing is stored.
    r = await run("Link these and write a page MOCK-NO-ASKED", pick);
    check("no asked in the answer: nothing is stored", r.result.linkCount === 0 && r.result.document === null && r.links.length === 0);

    // 7. No pick: every document of the project is read.
    r = await run("Extract the points on defaults", null);
    const all = await db.notebookDocument.count({ where: { notebookId: notebook.id } });
    check("no pick: every document of the project is listed", r.result.documents.length === all, `${r.result.documents.length} of ${all}`);
    check("no pick, extract: nothing is stored", r.result.linkCount === 0 && r.result.document === null && r.links.length === 0);
  } finally {
    // The check's own rows: the links it made, and the pages it wrote.
    await clearLinks();
    for (const id of made.documents) {
      await db.docLink.deleteMany({ where: { OR: [{ fromDocumentId: id }, { toDocumentId: id }] } });
      await db.notebookDocument.deleteMany({ where: { documentId: id } });
      await db.block.deleteMany({ where: { documentId: id } });
      await db.document.delete({ where: { id } }).catch(() => {});
    }
  }

  console.log(failed === 0 ? "\nAll checks pass." : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
