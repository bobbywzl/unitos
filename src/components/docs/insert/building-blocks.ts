import type { JSONContent } from "@tiptap/core";
import type { Lang } from "@/lib/i18n/config";
import type { TFunc } from "@/lib/i18n/dictionaries";
import { dateLabel, isoOf, today } from "@/components/docs/insert/dates";
import { presetDropdowns, writeOptions } from "@/components/docs/insert/dropdowns";
import { newBlockId } from "@/lib/docs/schema";

// Google Docs' building blocks (SPEC.md §29), inserted as content: Meeting
// notes (today's date chip and a title, attendees, notes, action items),
// an Email draft (To, Cc, Bcc, Subject), and three tracker tables with a
// gray header row, light gray borders, and a Status column of dropdown
// chips.

export type BuildingBlock = "meetingNotes" | "emailDraft" | "productRoadmap" | "reviewTracker" | "taskTracker";

const LIGHT = "1 solid #dadce0";
const HEADER_FILL = "#f1f3f4";

function text(value: string, bold = false): JSONContent[] {
  if (!value) return [];
  return [bold ? { type: "text", text: value, marks: [{ type: "bold" }] } : { type: "text", text: value }];
}

function cell(content: JSONContent[], header = false): JSONContent {
  return {
    type: "tableCell",
    attrs: {
      borderTop: LIGHT,
      borderRight: LIGHT,
      borderBottom: LIGHT,
      borderLeft: LIGHT,
      ...(header ? { backgroundColor: HEADER_FILL } : {}),
    },
    content: [{ type: "paragraph", content }],
  };
}

function dropdownChip(presetIndex: number, id: string, t: TFunc): JSONContent {
  const { name, options } = presetDropdowns(t)[presetIndex];
  return {
    type: "dropdownChip",
    attrs: { dropdownId: id, name, dropdownOptions: writeOptions(options), label: options[0].label, backgroundColor: options[0].color },
  };
}

function tracker(columns: string[], statusColumn: number, preset: number, t: TFunc): JSONContent[] {
  const id = newBlockId();
  const header: JSONContent = { type: "tableRow", content: columns.map((c) => cell(text(c, true), true)) };
  const body = [0, 1].map(
    (): JSONContent => ({
      type: "tableRow",
      content: columns.map((_, i) => cell(i === statusColumn ? [dropdownChip(preset, id, t)] : [])),
    }),
  );
  return [{ type: "table", content: [header, ...body] }, { type: "paragraph" }];
}

export function buildingBlock(kind: BuildingBlock, t: TFunc, lang: Lang): JSONContent[] {
  switch (kind) {
    case "meetingNotes": {
      const iso = isoOf(today());
      return [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [
            { type: "dateChip", attrs: { date: iso, format: "mdy", time: null, label: dateLabel(iso, "mdy", null, lang) } },
            { type: "text", text: ` | ${t("docsInsert.blockMeetingTitle")}` },
          ],
        },
        { type: "paragraph", content: text(`${t("docsInsert.blockAttendees")} `, true) },
        { type: "heading", attrs: { level: 3 }, content: text(t("docsInsert.blockNotes")) },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
        { type: "heading", attrs: { level: 3 }, content: text(t("docsInsert.blockActionItems")) },
        { type: "taskList", content: [{ type: "taskItem", attrs: { checked: false }, content: [{ type: "paragraph" }] }] },
      ];
    }
    case "emailDraft": {
      const rows = ["blockTo", "blockCc", "blockBcc", "blockSubject"] as const;
      return [
        {
          type: "table",
          content: rows.map((key) => ({
            type: "tableRow",
            content: [cell(text(t(`docsInsert.${key}`), true), true), cell([])],
          })),
        },
        { type: "paragraph" },
      ];
    }
    case "productRoadmap":
      return tracker(
        [t("docsInsert.colProject"), t("docsInsert.colStatus"), t("docsInsert.colRelatedFiles"), t("docsInsert.colNotes")],
        1,
        0,
        t,
      );
    case "reviewTracker":
      return tracker([t("docsInsert.colReviewer"), t("docsInsert.colStatus"), t("docsInsert.colNotes")], 1, 1, t);
    case "taskTracker":
      return tracker(
        [t("docsInsert.colTask"), t("docsInsert.colAssignee"), t("docsInsert.colStatus"), t("docsInsert.colDueDate")],
        2,
        0,
        t,
      );
  }
}
