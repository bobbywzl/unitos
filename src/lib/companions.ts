import type { TKey } from "@/lib/i18n/dictionaries";

// Companions (SPEC.md §23): web apps outside Unitos, listed under Projects on
// the dashboard, for the steps around dissecting a document that Unitos does
// not do. Every one of them is a step the reader would otherwise leave the app
// for anyway; the list says where to go instead of pretending the gap is not
// there.
//
// The bar for being here: the step is real, Unitos has no specialized function
// for it, and the app is one a reader can trust with their own material. A
// step Unitos does well never appears — the reader's document translates in
// the reader (§19), a handwritten PDF converts in the project (§16), a video
// transcribes on upload (§11) — and neither does a site that would take a
// reader's private notes to make its money from them.
//
// The section is also where sponsored entries will sit: a notemaking app whose
// work sits beside Unitos' own, paid for. `sponsored` is what marks one, and
// the row says so in words — a paid entry the reader cannot tell from an
// unpaid one is worth nothing to either of them. Nothing is sponsored today.

/** Where the companion sits around the dissection: before it, getting the
    material ready; after it, taking the notes onward. */
export type CompanionStage = "before" | "after";

export type Companion = {
  id: string;
  name: string;
  href: string;
  stage: CompanionStage;
  /** One line on what it is for, and why Unitos does not do it. */
  lineKey: TKey;
  /** Paid for. The row says so beside the name. */
  sponsored?: true;
};

export const COMPANIONS: Companion[] = [
  {
    id: "mathpix",
    name: "Mathpix",
    href: "https://mathpix.com/",
    stage: "before",
    lineKey: "works.companionMathpix",
  },
  {
    id: "pdf24",
    name: "PDF24 Tools",
    href: "https://tools.pdf24.org/en/",
    stage: "before",
    lineKey: "works.companionPdf24",
  },
  {
    id: "connectedpapers",
    name: "Connected Papers",
    href: "https://www.connectedpapers.com/",
    stage: "before",
    lineKey: "works.companionConnectedPapers",
  },
  {
    id: "deepl",
    name: "DeepL",
    href: "https://www.deepl.com/translator",
    stage: "after",
    lineKey: "works.companionDeepl",
  },
  {
    id: "overleaf",
    name: "Overleaf",
    href: "https://www.overleaf.com/",
    stage: "after",
    lineKey: "works.companionOverleaf",
  },
  {
    id: "zotero",
    name: "Zotero",
    href: "https://www.zotero.org/",
    stage: "after",
    lineKey: "works.companionZotero",
  },
  {
    id: "anki",
    name: "Anki",
    href: "https://apps.ankiweb.net/",
    stage: "after",
    lineKey: "works.companionAnki",
  },
];

export function companionsAt(stage: CompanionStage): Companion[] {
  return COMPANIONS.filter((c) => c.stage === stage);
}
