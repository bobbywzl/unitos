import { NextResponse } from "next/server";
import { z } from "zod";
import { notebookAccess } from "@/lib/collab";
import { db } from "@/lib/db";
import { JEV_MODEL, jevEnabled, systemOne } from "@/lib/jev";
import { parseBody } from "@/lib/validate";

// The lead tool of the selection toolbar (SPEC.md §6): Jev predicts which
// tool the reader reaches for on this selection, from the selection and
// the reader's own toolbar history, and the toolbar marks that tool as
// recommended. A choice over the kind's tools; the answer counts only at
// LEAD_MIN_CONFIDENCE or above. Every prediction lands as one ClickEvent
// (`lead-predicted:<tool>` on the ai-toolbar surface) beside the click it
// tried to predict, so the hit rate reads from the click log. No key: no
// prediction, the kind's fixed lead stands.

const LEAD_MIN_CONFIDENCE = 0.5;
const HISTORY_DAYS = 90;
const HISTORY_ROWS = 80;
const TEXT_MAX = 600;

const TOOLS = ["define", "assistant", "explain", "simplify", "visualize", "analyze", "comment", "link", "highlight", "addToNotes", "readAloud"] as const;
type Tool = (typeof TOOLS)[number];

// What each tool does, as the choice's criteria.
const TOOL_CRITERIA: Record<Tool, string> = {
  define: "Define the selected word or phrase: what it means in this sentence.",
  assistant: "Ask the assistant a question about the selection, or give it a command.",
  explain: "Explain the selection in plain words, tuned to the reader's background.",
  simplify: "Rewrite the selection in plain words, sentence by sentence.",
  visualize: "Draw the selection as a diagram, a picture, or an animation.",
  analyze: "Read a figure or table and explain what it shows.",
  comment: "Write a remark on the selection.",
  link: "Link the selection to a passage in another document.",
  highlight: "Mark the selection in a color to find it again.",
  addToNotes: "Save the selection as a quote in a section of the notes.",
  readAloud: "Hear the selection read aloud.",
};

const schema = z.object({
  notebookId: z.string().min(1),
  kind: z.enum(["text", "figure", "equation"]),
  blockType: z.string().max(40).optional(),
  text: z.string().trim().min(1).max(TEXT_MAX),
  tools: z.array(z.enum(TOOLS)).min(2).max(TOOLS.length),
});

/** The tool a toolbar click stands for, or null for a click that is not a
    tool (a section pick, a close, a prediction row). */
function toolOfControl(control: string): Tool | null {
  if (control.startsWith("highlight:")) return "highlight";
  if (control === "add-to-notes") return "addToNotes";
  if (control === "read-aloud") return "readAloud";
  if (control === "assistant" || control === "assistant-run") return "assistant";
  if (control === "comment" || control === "comment-save") return "comment";
  if (control === "define" || control === "explain" || control === "simplify" || control === "visualize" || control === "analyze" || control === "link") return control;
  return null;
}

export async function POST(req: Request) {
  const { data, error } = await parseBody(req, schema);
  if (error) return error;
  if (!jevEnabled()) return NextResponse.json({ tool: null });
  const access = await notebookAccess(data.notebookId, "viewer");
  if (access instanceof NextResponse) return access;

  const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
  const rows = await db.clickEvent.findMany({
    where: { userId: access.user.id, surface: "ai-toolbar", createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: HISTORY_ROWS,
    select: { control: true },
  });
  const uses: Record<string, number> = {};
  const last: Tool[] = [];
  for (const row of rows) {
    const tool = toolOfControl(row.control);
    if (!tool) continue;
    uses[tool] = (uses[tool] ?? 0) + 1;
    if (last.length < 8) last.push(tool);
  }

  const words = data.text.split(/\s+/).filter(Boolean).length;
  const result = await systemOne({
    state: {
      selection: {
        text: data.text,
        words,
        kind: data.kind,
        block: (data.blockType ?? "PARAGRAPH").toLowerCase(),
      },
      reader: { tool_uses_last_90_days: uses, last_tools_most_recent_first: last },
    },
    questions: {
      next_tool: {
        type: "choice",
        instructions: "The tool the reader will use on this selection next.",
        criteria: Object.fromEntries(data.tools.map((tool) => [tool, TOOL_CRITERIA[tool]])),
      },
    },
    usage: { userId: access.user.id, feature: "lead-tool", model: JEV_MODEL },
    signal: req.signal,
    label: "LEAD_TOOL",
  });
  if (!result.ok) {
    if (!req.signal.aborted) console.warn("[lead-tool] jev failed:", result.error);
    return NextResponse.json({ tool: null });
  }
  const answer = result.answers.next_tool;
  if (answer.type !== "choice" || answer.confidence < LEAD_MIN_CONFIDENCE) return NextResponse.json({ tool: null });
  const tool = (TOOLS as readonly string[]).includes(answer.choice) ? (answer.choice as Tool) : null;
  if (!tool) return NextResponse.json({ tool: null });
  void db.clickEvent
    .create({
      data: { userId: access.user.id, notebookId: data.notebookId, surface: "ai-toolbar", control: `lead-predicted:${tool}` },
    })
    .catch(() => {});
  return NextResponse.json({ tool, confidence: answer.confidence });
}
