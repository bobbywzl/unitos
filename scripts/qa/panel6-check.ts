// Round 6 PANEL6 logic (WALK6-06, WALK6-08): when Remove and Dismiss ask
// first, what the confirm says in en and zh, and which reply a link waits on.
// Run: npx tsx scripts/qa/panel6-check.ts
// Pure: it reads and writes nothing.
import assert from "node:assert/strict";
import { confirmLinkRemoval } from "@/components/collab/confirm-link-removal";
import { waitingReply, waitsForReply } from "@/lib/graph/coverage-view";
import { translate, translatorFor } from "@/lib/i18n/dictionaries";

let pass = 0;
const ok = (cond: boolean, label: string) => {
  assert.ok(cond, label);
  pass++;
  console.log(`ok  ${label}`);
};

// window.confirm, recorded; the answer is "OK".
let asked: string[] = [];
(globalThis as unknown as { window: { confirm: (m: string) => boolean } }).window = {
  confirm: (m: string) => {
    asked.push(m);
    return true;
  },
};

for (const lang of ["en", "zh"] as const) {
  const t = translatorFor(lang);
  const run = (...args: Parameters<typeof confirmLinkRemoval>) => {
    asked = [];
    const result = confirmLinkRemoval(...args);
    return { result, asked: asked[0] ?? null };
  };
  // Remove: the reader's own link
  ok(run(t, 0, "remove").asked === null, `${lang}: Remove, own link, no reply: no confirm`);
  ok(run(t, 2, "remove", undefined, false).asked === null, `${lang}: Remove, own link, only own replies: no confirm (Undo is there)`);
  const others = run(t, 1, "remove", undefined, true).asked;
  ok(others !== null, `${lang}: Remove, another person replied: asks`);
  ok(others !== null && (lang === "en" ? /History can restore it with its reply/.test(others) : /恢复/.test(others)), `${lang}: the confirm says History restores the reply — ${others}`);
  ok(others !== null && !(lang === "en" ? /and its reply\?/.test(others) : /移除此链接及其回复/.test(others)), `${lang}: the confirm no longer says the reply goes`);
  const madeBy = run(t, 0, "remove", "Linda Owner", false).asked;
  ok(madeBy !== null && madeBy.includes("Linda Owner"), `${lang}: Remove on another person's link names them — ${madeBy}`);
  // Dismiss still asks on any reply: it deletes the row with the reader's own replies.
  ok(run(t, 1, "dismiss").asked !== null, `${lang}: Dismiss with a reply asks`);
  ok(run(t, 0, "dismiss").asked === null, `${lang}: Dismiss with no reply goes at once`);
  // Waiting on you's words
  ok(translate(lang, "graphCover.noReply") === (lang === "en" ? "Waiting on you" : "待你回复"), `${lang}: the filter reads ${translate(lang, "graphCover.noReply")}`);
}

// Which reply a link waits on
const r = (userId: string, at: string, resolvedById: string | null = null) => ({ id: `${userId}-${at}`, userId, content: `${userId} asks`, createdAt: at, resolvedById });
ok(waitingReply({ replies: [] }, "me") === null, "no reply: waits on no one's question");
ok(waitsForReply({ replies: [] }, "me"), "…but the link still waits on you (no reply yet)");
ok(waitingReply({ replies: [r("mara", "2026-10-01")] }, "me")?.userId === "mara", "Mara's open reply is the question");
ok(waitingReply({ replies: [r("mara", "2026-10-01"), r("me", "2026-10-02")] }, "me") === null, "answered by me: no question");
ok(waitingReply({ replies: [r("me", "2026-10-01"), r("mara", "2026-10-02")] }, "me")?.userId === "mara", "Mara asked after my reply: her question");
ok(waitingReply({ replies: [r("mara", "2026-10-02", "me")] }, "me") === null, "a resolved question waits on no one");
ok(waitingReply({ replies: [r("mara", "2026-10-01")] }, "") === null, "no account: no question");

console.log(`\n${pass} ok, ALL PASS`);
