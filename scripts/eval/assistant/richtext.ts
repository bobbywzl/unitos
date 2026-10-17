// A suggestion fixture as the page holds it (SPEC.md §29): rich text whose
// paragraph index is the rows the prompts and the passes read — one row per
// paragraph, heading, and list line, as lib/docs/blocks.ts derives them. A
// list's first line keeps the fixture block's id; the others take
// `<id>-l2`, `<id>-l3`, … so the rows are the same on every run.
import type { PlanContext } from "@/lib/assistant/plan";
import { deriveBlocks } from "@/lib/docs/blocks";
import type { Fixture } from "../lib";

export type RichNode = { type: string; attrs?: Record<string, unknown>; content?: RichNode[]; text?: string; marks?: unknown[] };

const words = (s: string): RichNode[] => (s ? [{ type: "text", text: s }] : []);

export function fixtureRichText(f: Fixture): RichNode {
  const content: RichNode[] = [];
  for (const b of f.blocks) {
    switch (b.type as string) {
      case "HEADING": {
        const level = Number(/^<h([1-6])/.exec(b.html ?? "")?.[1] ?? 2);
        content.push({ type: "heading", attrs: { level, blockId: b.id }, content: words(b.text) });
        break;
      }
      case "LIST": {
        const lines = b.text.split("\n").filter((l) => l.trim());
        const ordered = /^\s*\d{1,3}[.)]\s/.test(lines[0] ?? "");
        content.push({
          type: ordered ? "orderedList" : "bulletList",
          content: (lines.length > 0 ? lines : [""]).map((line, i) => ({
            type: "listItem",
            content: [
              {
                type: "paragraph",
                attrs: { blockId: i === 0 ? b.id : `${b.id}-l${i + 1}` },
                content: words(line.replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/, "")),
              },
            ],
          })),
        });
        break;
      }
      case "CODE":
        content.push({ type: "codeBlock", attrs: { blockId: b.id }, content: words(b.text) });
        break;
      case "SEPARATOR":
        content.push({ type: "horizontalRule", attrs: { blockId: b.id } });
        break;
      case "EQUATION":
        content.push({ type: "blockMath", attrs: { blockId: b.id, latex: b.text } });
        break;
      default:
        content.push({ type: "paragraph", attrs: { blockId: b.id }, content: words(b.text) });
    }
  }
  return { type: "doc", content };
}

/** The paragraph index of the fixture's rich text, as PlanContext blocks. */
export function suggestionRows(f: Fixture): PlanContext["blocks"] {
  return deriveBlocks(fixtureRichText(f) as never).map((b) => ({
    id: b.id,
    type: b.type,
    text: b.text,
    html: b.html ?? null,
    startTime: null,
    endTime: null,
    speaker: null,
  }));
}
