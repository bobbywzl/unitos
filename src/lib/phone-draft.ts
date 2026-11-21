import { tabAccount } from "@/lib/tab-account";

// The phone page's note box (SPEC.md §33) keeps what is typed or spoken in
// it, per account and per section, until the server confirms the note: a
// reload, a closed app, or a lost network loses no word (CLAUDE.md rule
// zero, 6). The draft also keeps the id the note will take once a send has
// started (createId), so a send tried again makes the same note and never a
// second one. Its own key: the notes tray's composer keeps its drafts
// elsewhere (lib/note-drafts.ts) and never reads these.

export type PhoneDraft = { content: string; createId?: string };

function key(sectionId: string): string {
  return `unitos-phone-draft:${tabAccount() ?? "local"}:${sectionId}`;
}

export function readPhoneDraft(sectionId: string): PhoneDraft | null {
  try {
    const raw = localStorage.getItem(key(sectionId));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<PhoneDraft>;
    if (typeof draft.content !== "string") return null;
    return { content: draft.content, ...(typeof draft.createId === "string" ? { createId: draft.createId } : {}) };
  } catch {
    return null;
  }
}

export function writePhoneDraft(sectionId: string, draft: PhoneDraft): void {
  try {
    if (draft.content.trim() === "" && !draft.createId) localStorage.removeItem(key(sectionId));
    else localStorage.setItem(key(sectionId), JSON.stringify(draft));
  } catch {
    // Storage is off or full: the words stay in the box while the page is open.
  }
}

export function clearPhoneDraft(sectionId: string): void {
  try {
    localStorage.removeItem(key(sectionId));
  } catch {
    // Nothing was stored.
  }
}

const SECTION_KEY = "unitos-phone-section";

/** The section the account last wrote in, per project. */
export function readPhoneSection(projectId: string): string | null {
  try {
    return localStorage.getItem(`${SECTION_KEY}:${projectId}`);
  } catch {
    return null;
  }
}

export function writePhoneSection(projectId: string, sectionId: string): void {
  try {
    localStorage.setItem(`${SECTION_KEY}:${projectId}`, sectionId);
  } catch {
    // The first section opens next time.
  }
}
