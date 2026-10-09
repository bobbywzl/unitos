// The plan run on a fixture with no server (SPEC.md §7, §25): the actions
// the plan module enriched, applied the way the plan card's executor applies
// them (reader-interactions.tsx executePlan: one after another, new blocks
// after one block in the plan's order), so a check can read the document
// after the plan and what the plan made beside it.
import type { PlanContext } from "@/lib/assistant/plan";
import { withListMarkers, type BlockKind } from "@/lib/block-kind";
import type { AssistantAction } from "@/lib/types";

export type SimBlock = PlanContext["blocks"][number] & {
  // A format_block's kind, when one set it; a new block's kind.
  kind?: BlockKind;
  // Styles and links the plan put on the words.
  styles: { quote: string; style: string }[];
  links: { quote: string; to: string }[];
  // True for a block the plan added.
  fresh?: boolean;
};

export type Simulation = {
  blocks: SimBlock[];
  annotations: { kind: "highlight" | "comment"; blockId: string; quote: string; color?: string; comment?: string }[];
  notes: { section: string; content: string; sourced: boolean; quote?: string }[];
  sections: string[];
  documents: { title: string; markdown: string }[];
  speakers: { id: string; name: string }[];
  // What could not run: an action that names a block the earlier actions took away.
  failed: string[];
};

const TYPE_OF_KIND: Record<BlockKind, string> = { paragraph: "PARAGRAPH", h1: "HEADING", h2: "HEADING", h3: "HEADING", list: "LIST", numbered: "LIST" };

/** The plan's actions over the blocks. sections: the project's sections
    (id and title), so a note lands under its section's title, and a note
    whose sectionTitle names no section makes that section, as the plan
    card's executor does. */
export function simulate(
  start: PlanContext["blocks"],
  actions: AssistantAction[],
  speakers: { id: string; name: string }[] = [],
  sections: { id: string; title: string }[] = [],
): Simulation {
  const blocks: SimBlock[] = start.map((b) => ({ ...b, styles: [], links: [] }));
  const sim: Simulation = { blocks, annotations: [], notes: [], sections: [], documents: [], speakers: speakers.map((s) => ({ ...s })), failed: [] };
  const titleById = new Map(sections.map((s) => [s.id, s.title]));
  const known = new Set(sections.map((s) => s.title.toLowerCase()));
  const at = (id: string) => blocks.findIndex((b) => b.id === id);
  const lastInserted = new Map<string, string>();
  let fresh = 0;
  for (const a of actions) {
    const miss = (id: string) => {
      sim.failed.push(`${a.type}: block ${id} is not in the document`);
    };
    switch (a.type) {
      case "edit_block": {
        const i = at(a.blockId);
        if (i < 0) miss(a.blockId);
        else blocks[i] = { ...blocks[i], text: a.newText };
        break;
      }
      case "insert_paragraph": {
        const place = a.afterBlockId ?? "";
        const after = lastInserted.get(place) ?? a.afterBlockId;
        const i = after === null ? -1 : at(after);
        if (after !== null && i < 0) {
          miss(after);
          break;
        }
        const kind = a.kind ?? "paragraph";
        const id = `new-${++fresh}`;
        blocks.splice(i + 1, 0, {
          id,
          type: TYPE_OF_KIND[kind],
          text: kind === "list" || kind === "numbered" ? withListMarkers(a.text, kind) : a.text,
          html: null,
          kind,
          styles: [],
          links: [],
          fresh: true,
        });
        lastInserted.set(place, id);
        break;
      }
      case "remove_block": {
        const i = at(a.blockId);
        if (i < 0) miss(a.blockId);
        else blocks.splice(i, 1);
        break;
      }
      case "format_block": {
        const i = at(a.blockId);
        if (i < 0) miss(a.blockId);
        else {
          const b = blocks[i];
          const wasList = b.type === "LIST";
          const text = a.kind === "list" || a.kind === "numbered" ? withListMarkers(b.text, a.kind) : wasList ? b.text.replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "") : b.text;
          blocks[i] = { ...b, type: TYPE_OF_KIND[a.kind], kind: a.kind, text };
        }
        break;
      }
      case "move_block": {
        const i = at(a.blockId);
        if (i < 0) {
          miss(a.blockId);
          break;
        }
        const [moved] = blocks.splice(i, 1);
        const j = a.afterBlockId === null ? -1 : at(a.afterBlockId);
        if (a.afterBlockId !== null && j < 0) {
          blocks.splice(i, 0, moved);
          miss(a.afterBlockId);
          break;
        }
        blocks.splice(j + 1, 0, moved);
        break;
      }
      case "style": {
        const i = at(a.anchor.blockId);
        if (i < 0) miss(a.anchor.blockId);
        else blocks[i].styles.push({ quote: a.anchor.quotedText, style: a.style });
        break;
      }
      case "link": {
        const i = at(a.anchor.blockId);
        if (i < 0) miss(a.anchor.blockId);
        else blocks[i].links.push({ quote: a.anchor.quotedText, to: a.href ?? a.toDocumentId ?? "" });
        break;
      }
      case "highlight":
        sim.annotations.push({ kind: "highlight", blockId: a.anchor.blockId, quote: a.anchor.quotedText, color: a.color, comment: a.comment });
        break;
      case "comment":
        sim.annotations.push({ kind: "comment", blockId: a.anchor.blockId, quote: a.anchor.quotedText, comment: a.comment });
        break;
      case "add_section":
        sim.sections.push(a.title);
        known.add(a.title.toLowerCase());
        break;
      case "add_note": {
        const title = a.sectionId ? (titleById.get(a.sectionId) ?? a.sectionId) : (a.sectionTitle ?? "");
        if (!a.sectionId && title && !known.has(title.toLowerCase())) {
          sim.sections.push(title);
          known.add(title.toLowerCase());
        }
        sim.notes.push({ section: title, content: a.content, sourced: Boolean(a.source), quote: a.source?.quotedText });
        break;
      }
      case "join_lines": {
        const i = at(a.blockId);
        const j = at(a.nextBlockId);
        if (i < 0 || j < 0) miss(i < 0 ? a.blockId : a.nextBlockId);
        else {
          blocks[i] = { ...blocks[i], text: `${blocks[i].text} ${blocks[j].text}`.trim(), endTime: blocks[j].endTime };
          blocks.splice(j, 1);
        }
        break;
      }
      case "split_line": {
        const i = at(a.blockId);
        if (i < 0) miss(a.blockId);
        else {
          const b = blocks[i];
          const head = b.text.slice(0, a.offset).trim();
          const tail = b.text.slice(a.offset).trim();
          const share = b.startTime != null && b.endTime != null ? b.startTime + ((b.endTime - b.startTime) * a.offset) / Math.max(1, b.text.length) : null;
          blocks[i] = { ...b, text: head, endTime: share ?? b.endTime };
          blocks.splice(i + 1, 0, { ...b, id: `${b.id}-split`, text: tail, startTime: share ?? b.startTime, styles: [], links: [] });
        }
        break;
      }
      case "set_speaker": {
        const i = at(a.blockId);
        if (i < 0) miss(a.blockId);
        else blocks[i] = { ...blocks[i], speaker: a.speakerId };
        break;
      }
      case "rename_speaker": {
        const s = sim.speakers.find((v) => v.id === a.speakerId);
        if (s) s.name = a.name;
        break;
      }
      case "suggest":
      case "revise":
        // Run elsewhere: the page's suggestions, or the windows (run.ts).
        break;
    }
  }
  return sim;
}
