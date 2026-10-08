// REV3-04: reply drafts and Note on this link drafts belong to the account
// that typed them (lib/note-drafts.ts). Runs on a fake localStorage:
//   npx tsx scripts/qa/reply-drafts-check.ts
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  keys() {
    return [...this.map.keys()].sort();
  }
}
const store = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = store;

let failed = 0;
const check = (ok: boolean, what: string, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
};

async function main() {
  const d = await import("../../src/lib/note-drafts");
  const DAY = 24 * 60 * 60 * 1000;

  // 1. A's draft never shows for C.
  d.writeReplyDraft("ua", "note:n1", "A's words");
  check(d.readReplyDraft("ua", "note:n1") === "A's words", "A reads A's draft");
  check(d.readReplyDraft("uc", "note:n1") === null, "C never reads A's draft");
  d.writeLinkNoteDraft("ua", "l1", "A's note", "s1");
  check(d.readLinkNoteDraft("uc", "l1") === null, "C never reads A's Note on this link draft");
  check(d.readLinkNoteDraft("ua", "l1")?.sectionId === "s1", "A reads A's Note on this link draft");

  // 2. A legacy draft goes to the account that reads it first, once.
  store.setItem("unitos-reply-draft:link:l9", JSON.stringify({ content: "old", savedAt: Date.now() }));
  check(d.readReplyDraft("ua", "link:l9") === "old", "a legacy draft opens for the signed-in account");
  check(store.getItem("unitos-reply-draft:link:l9") === null, "the legacy key is moved, not copied");
  check(d.readReplyDraft("uc", "link:l9") === null, "then another account never reads it");

  // 3. Sign out claims every legacy draft for the account signing out.
  store.setItem("unitos-reply-draft:edit:e1", JSON.stringify({ content: "edit reply", savedAt: Date.now() }));
  store.setItem("graph-link-note:l7", JSON.stringify({ content: "link note", sectionId: null }));
  d.claimLegacyDrafts("ua");
  check(store.getItem("unitos-reply-draft:ua:edit:e1") !== null, "Sign out moves a legacy reply draft to A");
  const moved = JSON.parse(store.getItem("graph-link-note:ua:l7") ?? "{}") as { savedAt?: unknown };
  check(typeof moved.savedAt === "number", "a legacy Note on this link draft gets a date when claimed");
  check(!store.keys().some((k) => k === "unitos-reply-draft:edit:e1" || k === "graph-link-note:l7"), "no legacy key is left");
  check(d.readReplyDraft("ua", "note:n1") === "A's words", "Sign out keeps A's own draft");

  // 4. A claim keeps the newer of the account's draft and a legacy one (a
  // tab from before the change still writing the old key).
  d.writeReplyDraft("ua", "note:n2", "new words");
  store.setItem("unitos-reply-draft:note:n2", JSON.stringify({ content: "older", savedAt: Date.now() - DAY }));
  check(d.readReplyDraft("ua", "note:n2") === "new words", "the account's newer draft wins over an older legacy one");
  store.setItem("unitos-reply-draft:note:n2", JSON.stringify({ content: "newest from an old tab", savedAt: Date.now() + 1000 }));
  check(d.readReplyDraft("ua", "note:n2") === "newest from an old tab", "a newer legacy draft wins over the account's older one");

  // 5. The sweep never drops a reply or Note on this link draft by age:
  // nothing replays them, so their words wait for a send or Cancel (REV4-06).
  store.setItem("unitos-reply-draft:ua:note:old", JSON.stringify({ content: "x", savedAt: Date.now() - 400 * DAY }));
  store.setItem("graph-link-note:uc:old", JSON.stringify({ content: "x", sectionId: null, savedAt: Date.now() - 400 * DAY }));
  store.setItem("graph-link-note:undated", JSON.stringify({ content: "keep me", sectionId: null }));
  store.setItem("unitos-note-draft:gone", JSON.stringify({ content: "x", savedAt: Date.now() - 31 * DAY }));
  d.sweepStaleDrafts();
  check(store.getItem("unitos-reply-draft:ua:note:old") !== null, "a 400-day-old reply draft stays");
  check(store.getItem("graph-link-note:uc:old") !== null, "a 400-day-old Note on this link draft stays");
  check(store.getItem("unitos-reply-draft:ua:note:n1") !== null, "a fresh reply draft stays");
  check(store.getItem("graph-link-note:undated") !== null, "an undated legacy Note on this link draft stays");
  check(store.getItem("unitos-note-draft:gone") === null, "a 31-day-old note draft nobody replayed is swept, as before");
  d.writeReplyDraft("ua", "note:old", "");
  check(store.getItem("unitos-reply-draft:ua:note:old") === null, "a send (empty draft written) clears the reply draft");

  // 6. A queued reply or Note on this link the server refused on replay
  // goes back into its box's draft (REV8-01), after words typed since.
  d.keepDroppedWords("ua", "/api/replies", { docLinkId: "l19", notebookId: "p", content: "typed on the train" });
  check(d.readReplyDraft("ua", "link:l19") === "typed on the train", "a dropped reply on a link opens its box on the words");
  d.writeReplyDraft("ua", "note:n9", "typed since");
  d.keepDroppedWords("ua", "/api/replies", { noteId: "n9", content: "dropped words" });
  check(d.readReplyDraft("ua", "note:n9") === "typed since\n\ndropped words", "a dropped reply lands after the words typed since");
  d.keepDroppedWords("ua", "/api/replies", { noteId: "n9", content: "dropped words" });
  check(d.readReplyDraft("ua", "note:n9") === "typed since\n\ndropped words", "a second drop of the same words adds nothing");
  d.keepDroppedWords("ua", "/api/notes", { sectionId: "s1", fromLinkId: "l19", content: "note words" });
  const dropped = d.readLinkNoteDraft("ua", "l19");
  check(dropped?.content === "note words" && dropped.sectionId === "s1", "a dropped Note on this link opens its composer on the words and the section");
  d.keepDroppedWords(null, "/api/replies", { docLinkId: "l19", content: "sign-in off" });
  check(d.readReplyDraft("", "link:l19") === "sign-in off" && d.readReplyDraft("ua", "link:l19") === "typed on the train", "with no account the words go to the local draft, not another account's");
  const before = store.keys().length;
  d.keepDroppedWords("ua", "/api/notes", { sectionId: "s1", content: "a plain note" });
  d.keepDroppedWords("ua", "/api/sections", { content: "x" });
  check(store.keys().length === before, "other writes are not put back");

  console.log(failed === 0 ? "\nall checks pass" : `\n${failed} check(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
