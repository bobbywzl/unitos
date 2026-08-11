// QA autoloop seed: Google-DD-flavored fixture documents plus one notebook per
// persona, each with sections and a pending queue so the accept/reject keyboard
// flow is exercisable from the first minute.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const DOCS = [
  {
    title: "Bought or Earned? — Google defaults memo (QA)",
    blocks: [
      ["HEADING", "<h1>", "Bought or Earned? Google's defaults and core strength"],
      ["PARAGRAPH", null, "Google pays roughly $42 billion a year to be the search engine that is already switched on. This briefing answers one question: is Google's dominance a product of core strength — better algorithms, more user data, a stronger ecosystem — or a product of those payments? The evidence comes from the US search trial record, Google's own internal models, and every natural experiment where the default changed hands."],
      ["HEADING", "<h2>", "The monetization gap"],
      ["PARAGRAPH", null, "Google's internal Alice study calculated that for Microsoft to match Google's payment to Apple — then just 33.75% of revenue — Microsoft would have to pay 122% of Bing's revenue. More than everything Bing makes. Google's conclusion: it will not be possible for Alice to match our payments profitably. Events proved it exactly right: Microsoft offered 100% and lost."],
      ["PARAGRAPH", null, "Why this matters: the default slot is an auction, and the auction is won by whoever earns most per query. Google earns roughly three times more per search than Bing. That monetization edge is core strength — better ad systems, more advertisers, better targeting. So the payments are not an external subsidy propping up a weak product."],
      ["HEADING", "<h2>", "When Google loses the default, users claw it back"],
      ["PARAGRAPH", null, "Every natural experiment shows the same pattern: a meaningful minority follows the default; the majority finds its way back to Google. Firefox and Yahoo, 2014 to 2017: Mozilla made Yahoo the default. Google's share of Firefox queries fell from 80-90% to 60-70% — and then partially recovered while Yahoo was still the default. Two-thirds of the volume went back to Google anyway."],
      ["PARAGRAPH", null, "One-line answer: the floor is earned; the top ten to twenty points are bought; and the money that buys them is itself a product of the earned part."],
      ["LIST", null, "- Default payments: ~$42B/yr\n- Alice study threshold: 122% of Bing revenue\n- Per-query gap: ~3x vs Bing\n- Firefox recovery: two-thirds of volume returned"],
    ],
  },
  {
    title: "TikTok's Revenue Dynamics (QA)",
    blocks: [
      ["HEADING", "<h1>", "TikTok's Revenue Dynamics: Exploring Income Streams"],
      ["PARAGRAPH", null, "Social media has emerged as the predominant mode of global digital communication, captivating a vast and varied spectrum of users with its inventive and swift content. This article thoroughly analyzes TikTok's business model with a focus on advertising, virtual gifts, and e-commerce."],
      ["PARAGRAPH", null, "TikTok's core advertising revenues, which amount to £10 billion annually, are obtained through various channels, such as recommended videos, app opening screens, and search ads. However, virtual gifts represent a significant income source for TikTok, with users making substantial contributions through rewards."],
      ["HEADING", "<h2>", "The three-lens framing"],
      ["PARAGRAPH", null, "The three categories — advertising, virtual gifts, e-commerce — represent a deliberate progression from passive monetization (ads served to users) to active monetization (users voluntarily spending money on gifts) to transactional monetization (users buying physical goods). That arc is analytically useful for understanding how TikTok has diversified beyond the ad-dependency that makes most social platforms financially fragile."],
      ["PARAGRAPH", null, "Regarding e-commerce, TikTok has excelled in cross-border trading, experiencing a growth of over 80 percent in gross merchandise value year over year, driven primarily by Southeast Asian markets."],
    ],
  },
  {
    title: "Search Market Primer (QA)",
    blocks: [
      ["HEADING", "<h1>", "Search Market Primer"],
      ["PARAGRAPH", null, "General search is a scale business twice over: quality scales with query volume, and monetization scales with advertiser density. A new entrant faces both gaps at once, which is why no general search engine built after 2010 has crossed five percent share in any major market."],
      ["PARAGRAPH", null, "Distribution is the third moat. Defaults on browsers and phones decide the first query; habit decides the rest. The economics of default payments only close for bidders who already monetize queries near the frontier."],
      ["PARAGRAPH", null, "The remedy debate therefore splits into conduct remedies (ban payments) and structural remedies (divest distribution assets). Each has a different theory of where the harm lives."],
    ],
  },
];

const PERSONAS = ["Analyst", "Student", "Skimmer"];

async function main() {
  const docIds = [];
  for (const doc of DOCS) {
    const created = await db.document.create({
      data: {
        title: doc.title,
        blocks: {
          create: doc.blocks.map(([type, html, text], i) => ({
            order: i,
            type,
            text,
            html,
          })),
        },
      },
      include: { blocks: { orderBy: { order: "asc" } } },
    });
    docIds.push(created);
  }

  for (const persona of PERSONAS) {
    const notebook = await db.notebook.create({
      data: {
        title: `QA ${persona}`,
        documents: { create: docIds.map((d) => ({ documentId: d.id })) },
        sections: {
          create: [
            { title: "Thesis", order: 0 },
            { title: "Risks", order: 1 },
          ],
        },
      },
      include: { sections: true },
    });
    // A pending queue from the start: two AI-style notes awaiting triage.
    const thesis = notebook.sections.find((s) => s.title === "Thesis");
    const doc = docIds[0];
    const block = doc.blocks[1];
    await db.note.create({
      data: {
        sectionId: thesis.id,
        content: "Pending: the $42B default payment question frames the whole memo.",
        status: "PENDING",
        derivationType: "EXTRACT",
        order: 0,
        sources: {
          create: {
            documentId: doc.id,
            blockId: block.id,
            startOffset: 0,
            endOffset: 60,
            quotedText: block.text.slice(0, 60),
            prefix: "",
            suffix: block.text.slice(60, 92),
          },
        },
      },
    });
    await db.note.create({
      data: {
        sectionId: thesis.id,
        content: "Pending: per-query monetization gap (~3x) is the load-bearing fact.",
        status: "PENDING",
        derivationType: "EXTRACT",
        order: 1,
      },
    });
    console.log(`${notebook.title}: ${notebook.id}`);
  }
  await db.readerProfile.upsert({
    where: { userId: "user-1" },
    update: {},
    create: {
      userId: "user-1",
      background: "Analyst with finance background",
      purpose: "due diligence",
      application: "internal QA of the reading workflow",
    },
  });
  console.log("documents:", docIds.map((d) => d.id).join(", "));
}

main().finally(() => db.$disconnect());
