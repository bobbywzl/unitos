import type { TKey } from "@/lib/i18n/dictionaries";

// Dropdown chips (SPEC.md §29): Google Docs' preset dropdowns and the colors
// an option can take. A chip holds its dropdown's id, name, and options; the
// chips of one dropdown share the id, and saving the dropdown's options
// rewrites every chip that has it.

export type DropdownOption = { label: string; color: string };

/** The light row, then the dark row of the option colors. */
export const DROPDOWN_COLORS = [
  "#e6e6e6",
  "#ffcfc9",
  "#ffc8aa",
  "#ffe5a0",
  "#d4edbc",
  "#bfe1f6",
  "#c6dbe1",
  "#e6cff2",
  "#3d3d3d",
  "#b10202",
  "#753800",
  "#473821",
  "#11734b",
  "#0a53a8",
  "#215a6c",
  "#5a3286",
] as const;

/** Each option color's text color. */
const TEXT_ON: Record<string, string> = {
  "#e6e6e6": "#3d3d3d",
  "#ffcfc9": "#b10202",
  "#ffc8aa": "#753800",
  "#ffe5a0": "#473821",
  "#d4edbc": "#11734b",
  "#bfe1f6": "#0a53a8",
  "#c6dbe1": "#215a6c",
  "#e6cff2": "#5a3286",
  "#3d3d3d": "#e5e5e5",
  "#b10202": "#ffcfc9",
  "#753800": "#ffc8aa",
  "#473821": "#ffe5a0",
  "#473822": "#ffe5a0",
  "#11734b": "#d4edbc",
  "#0a53a8": "#bfe0f6",
  "#215a6c": "#c6dbe1",
  "#5a3286": "#e5cff2",
};

/** An option color as the chip may draw it: one of the palette's, else gray. */
export function optionColor(color: unknown): string {
  const c = typeof color === "string" ? color.toLowerCase() : "";
  return c in TEXT_ON ? c : DROPDOWN_COLORS[0];
}

export function optionTextColor(color: unknown): string {
  return TEXT_ON[optionColor(color)];
}

export type DropdownPreset = { id: string; name: TKey; options: { label: TKey; color: string }[] };

export const DROPDOWN_PRESETS: DropdownPreset[] = [
  {
    id: "project-status",
    name: "docsInsert.presetProjectStatus",
    options: [
      { label: "docsInsert.optionNotStarted", color: "#e6e6e6" },
      { label: "docsInsert.optionBlocked", color: "#ffcfc9" },
      { label: "docsInsert.optionInProgress", color: "#ffe5a0" },
      { label: "docsInsert.optionCompleted", color: "#d4edbc" },
    ],
  },
  {
    id: "review-status",
    name: "docsInsert.presetReviewStatus",
    options: [
      { label: "docsInsert.optionNotStarted", color: "#e6e6e6" },
      { label: "docsInsert.optionInProgress", color: "#ffe5a0" },
      { label: "docsInsert.optionUnderReview", color: "#bfe1f6" },
      { label: "docsInsert.optionApproved", color: "#d4edbc" },
    ],
  },
];

/** A chip's options, read from its JSON attribute; never throws. */
export function readOptions(json: unknown): DropdownOption[] {
  if (typeof json !== "string") return [];
  try {
    const list: unknown = JSON.parse(json);
    if (!Array.isArray(list)) return [];
    return list.flatMap((o: unknown) => {
      const option = o as { label?: unknown; color?: unknown };
      return typeof option.label === "string" ? [{ label: option.label, color: optionColor(option.color) }] : [];
    });
  } catch {
    return [];
  }
}

export function writeOptions(options: DropdownOption[]): string {
  return JSON.stringify(options.map((o) => ({ label: o.label, color: optionColor(o.color) })));
}

export function newDropdownId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `dd${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
