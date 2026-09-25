import { Node } from "@tiptap/core";
import type { DOMOutputSpec, Node as PMNode } from "@tiptap/pm/model";
import { optionColor, optionTextColor } from "@/components/docs/insert/dropdowns";

// The smart chips (SPEC.md §29): a date, a person, a project document, and
// a dropdown, each an inline atom that draws its `label`. The label is the
// chip's words: in the paragraph index (lib/docs/blocks.ts), the clipboard,
// and find.

const SVG = "http://www.w3.org/2000/svg";
const HEX6 = /^#[0-9a-fA-F]{6}$/;

function svgIcon(path: string, className: string): DOMOutputSpec {
  return [
    `${SVG} svg`,
    { viewBox: "0 0 24 24", width: "16", height: "16", class: className, "aria-hidden": "true", "data-anchor-skip": "" },
    [`${SVG} path`, { d: path, fill: "currentColor" }],
  ];
}

const DOC_PATH =
  "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z";
const CARET_PATH = "M7 10l5 5 5-5z";

function labelOf(el: HTMLElement): string {
  return el.getAttribute("data-label") ?? el.textContent ?? "";
}

const chipBase = {
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  renderText: ({ node }: { node: PMNode }) => String(node.attrs.label ?? ""),
} as const;

const DateChip = Node.create({
  name: "dateChip",
  ...chipBase,
  addAttributes() {
    return {
      date: { default: null, parseHTML: (el) => el.getAttribute("data-date"), rendered: false },
      format: { default: "mdy", parseHTML: (el) => el.getAttribute("data-format") ?? "mdy", rendered: false },
      time: { default: null, parseHTML: (el) => el.getAttribute("data-time"), rendered: false },
      label: { default: "", parseHTML: labelOf, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-date-chip]" }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-date-chip": "",
        "data-date": String(node.attrs.date ?? ""),
        "data-format": String(node.attrs.format ?? "mdy"),
        ...(node.attrs.time ? { "data-time": String(node.attrs.time) } : {}),
        "data-label": String(node.attrs.label ?? ""),
        class: "docs-chip docs-chip-date",
      },
      String(node.attrs.label ?? ""),
    ];
  },
});

const PersonChip = Node.create({
  name: "personChip",
  ...chipBase,
  addAttributes() {
    return {
      personId: { default: null, parseHTML: (el) => el.getAttribute("data-person-id"), rendered: false },
      label: { default: "", parseHTML: labelOf, rendered: false },
      color: { default: null, parseHTML: (el) => el.getAttribute("data-color"), rendered: false },
      symbol: { default: null, parseHTML: (el) => el.getAttribute("data-symbol"), rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-person-chip]" }];
  },
  renderHTML({ node }) {
    const color = typeof node.attrs.color === "string" && HEX6.test(node.attrs.color) ? node.attrs.color : "#647589";
    const symbol = typeof node.attrs.symbol === "string" && node.attrs.symbol ? [...node.attrs.symbol].slice(0, 2).join("") : "?";
    return [
      "span",
      {
        "data-person-chip": "",
        "data-person-id": String(node.attrs.personId ?? ""),
        "data-label": String(node.attrs.label ?? ""),
        "data-color": color,
        "data-symbol": symbol,
        class: "docs-chip docs-chip-person",
      },
      ["span", { class: "docs-chip-avatar", style: `background-color: ${color}`, "data-anchor-skip": "" }, symbol],
      ["span", { class: "docs-chip-text" }, String(node.attrs.label ?? "")],
    ];
  },
});

const FileChip = Node.create({
  name: "fileChip",
  ...chipBase,
  addAttributes() {
    return {
      documentId: { default: null, parseHTML: (el) => el.getAttribute("data-document-id"), rendered: false },
      href: { default: null, parseHTML: (el) => el.getAttribute("data-href"), rendered: false },
      label: { default: "", parseHTML: labelOf, rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-file-chip]" }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-file-chip": "",
        "data-document-id": String(node.attrs.documentId ?? ""),
        "data-href": String(node.attrs.href ?? ""),
        "data-label": String(node.attrs.label ?? ""),
        class: "docs-chip docs-chip-file",
      },
      svgIcon(DOC_PATH, "docs-chip-icon"),
      ["span", { class: "docs-chip-text" }, String(node.attrs.label ?? "")],
    ];
  },
});

const DropdownChip = Node.create({
  name: "dropdownChip",
  ...chipBase,
  addAttributes() {
    return {
      dropdownId: { default: null, parseHTML: (el) => el.getAttribute("data-dropdown-id"), rendered: false },
      name: { default: "", parseHTML: (el) => el.getAttribute("data-name") ?? "", rendered: false },
      dropdownOptions: { default: "[]", parseHTML: (el) => el.getAttribute("data-options") ?? "[]", rendered: false },
      label: { default: "", parseHTML: labelOf, rendered: false },
      backgroundColor: { default: null, parseHTML: (el) => el.getAttribute("data-color"), rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: "span[data-dropdown-chip]" }];
  },
  renderHTML({ node }) {
    const bg = optionColor(node.attrs.backgroundColor);
    return [
      "span",
      {
        "data-dropdown-chip": "",
        "data-dropdown-id": String(node.attrs.dropdownId ?? ""),
        "data-name": String(node.attrs.name ?? ""),
        "data-options": String(node.attrs.dropdownOptions ?? "[]"),
        "data-label": String(node.attrs.label ?? ""),
        "data-color": bg,
        class: "docs-chip docs-chip-dropdown",
        style: `background-color: ${bg}; color: ${optionTextColor(bg)}`,
      },
      ["span", { class: "docs-chip-text" }, String(node.attrs.label ?? "")],
      svgIcon(CARET_PATH, "docs-chip-caret"),
    ];
  },
});

export const CHIP_EXTENSIONS = [DateChip, PersonChip, FileChip, DropdownChip];

/** Every dropdown chip of the document that belongs to one dropdown. */
export function dropdownChips(doc: PMNode, dropdownId: string): { node: PMNode; pos: number }[] {
  const out: { node: PMNode; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "dropdownChip" && node.attrs.dropdownId === dropdownId) out.push({ node, pos });
    return true;
  });
  return out;
}

/** The dropdowns the document holds: one entry per dropdown id, in order. */
export function documentDropdowns(doc: PMNode): { id: string; name: string; options: string }[] {
  const seen = new Map<string, { id: string; name: string; options: string }>();
  doc.descendants((node) => {
    if (node.type.name !== "dropdownChip") return true;
    const id = node.attrs.dropdownId as string | null;
    if (id && !seen.has(id)) seen.set(id, { id, name: String(node.attrs.name ?? ""), options: String(node.attrs.dropdownOptions ?? "[]") });
    return false;
  });
  return [...seen.values()];
}
