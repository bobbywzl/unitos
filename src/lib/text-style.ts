// The article's inline styles (Block.styles): one span per style over a range
// of a block's text. A text color is a named hue ("color-clay"), the default
// ink ("color-ink"), or any color from the color wheel ("color:#rrggbb"). A
// highlight is any color ("highlight:#rrggbb"). One color and one highlight
// per range: a new one replaces the old one on the same range, and where two
// ranges overlap the later span wins.

export const NAMED_COLORS = ["color-ink", "color-clay", "color-sage", "color-gold", "color-plum"] as const;
export type NamedColor = (typeof NAMED_COLORS)[number];
export type HexColor = `#${string}`;
export type CustomColor = `color:${HexColor}`;
export type HighlightStyle = `highlight:${HexColor}`;
export type TextColor = NamedColor | CustomColor;
/** What the edit toolbar and the style route toggle. */
export type ToggleStyle = "bold" | "italic" | "underline" | TextColor | HighlightStyle;
/** Every stored style; "code" spans come from the parser (monospace runs). */
export type TextStyle = ToggleStyle | "code";

const HEX = /^#[0-9a-f]{6}$/;
const CUSTOM = /^(color|highlight):#[0-9a-f]{6}$/;

/** The highlight a new reader starts with: a highlighter yellow. */
export const DEFAULT_HIGHLIGHT: HexColor = "#fde047";

export function isToggleStyle(style: string): style is ToggleStyle {
  return (
    style === "bold" ||
    style === "italic" ||
    style === "underline" ||
    (NAMED_COLORS as readonly string[]).includes(style) ||
    CUSTOM.test(style)
  );
}

export function isTextStyle(style: string): style is TextStyle {
  return style === "code" || isToggleStyle(style);
}

export function isColorStyle(style: string): boolean {
  return style.startsWith("color-") || style.startsWith("color:");
}

export function isHighlightStyle(style: string): boolean {
  return style.startsWith("highlight:");
}

/** The color input's value (#rrggbb, lower case) as a style. */
export function hexStyle(kind: "color" | "highlight", hex: string): CustomColor | HighlightStyle | null {
  const value = hex.toLowerCase();
  if (!HEX.test(value)) return null;
  return kind === "color" ? `color:${value as HexColor}` : `highlight:${value as HexColor}`;
}

/** Whether two styles take the same slot on a range: a color replaces a
    color, a highlight replaces a highlight. */
export function sameSlot(a: string, b: string): boolean {
  return (isColorStyle(a) && isColorStyle(b)) || (isHighlightStyle(a) && isHighlightStyle(b));
}

/** The class for a named color; null for a wheel color. */
export function colorClass(style: string): string | null {
  return style.startsWith("color-") ? `text-${style}` : null;
}

/** The inline CSS for a wheel color and a highlight covering a run of text.
    A highlight is mixed with transparency so the text reads on both themes. */
export function customCss(color: string | undefined, highlight: string | undefined): { color?: string; backgroundColor?: string } | null {
  const css: { color?: string; backgroundColor?: string } = {};
  if (color?.startsWith("color:") && CUSTOM.test(color)) css.color = color.slice(6);
  if (highlight && CUSTOM.test(highlight)) {
    css.backgroundColor = `color-mix(in srgb, ${highlight.slice(10)} 55%, transparent)`;
  }
  return css.color || css.backgroundColor ? css : null;
}

/** The same CSS as a style attribute's text, for HTML built as a string. */
export function customCssText(color: string | undefined, highlight: string | undefined): string {
  const css = customCss(color, highlight);
  if (!css) return "";
  return [css.color ? `color:${css.color}` : "", css.backgroundColor ? `background-color:${css.backgroundColor}` : ""]
    .filter(Boolean)
    .join(";");
}
