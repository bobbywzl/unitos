import type { ParsedBlock, ParsedDocument } from "@/lib/parse/types";
import {
  attr,
  boolAttr,
  child,
  children,
  cleanText,
  cssValue,
  descendants,
  EMU_PER_PT,
  escapeHtml,
  fontFamilyCss,
  intAttr,
  modifyColor,
  num,
  parseHexColor,
  parseTheme,
  parseXmlPart,
  partRels,
  relsOfType,
  rgbCss,
  textGap,
  unzipOffice,
  type OfficeZip,
  type Relationship,
  type Rgb,
  type ThemeColors,
} from "@/lib/parse/office";

// The slides parser (SPEC.md §27): a .pptx — an upload, or a Google Slides
// file Drive exported — read part by part into one SLIDE block per slide.
// The block's html is a replica of the slide: every shape at its place and
// size, in percent of the slide, its fill and outline, its text in the
// slide's fonts, sizes, and colors (sizes in cqw, so the replica scales
// with the reader's column), its pictures stored as images of the
// document, its tables as tables. The block's text is the slide's words in
// reading order — the title first, then the shapes top to bottom, left to
// right, then the speaker notes after "Speaker notes:" — and the replica's
// DOM text is exactly that text (SPEC.md §5): text pieces are joined by
// invisible gaps, and what is not the slide's own words (the layout's and
// the master's decoration, the slide number) is marked data-anchor-skip.
// Placeholders inherit their place, fonts, and bullets from the layout and
// the master, as PowerPoint draws them.

/** Where a slide's pictures go: the bytes stored as an image of the
    document, the URL the html points at; null = not stored (the picture
    shows as a labeled box). */
export type SlideImageStore = (bytes: Uint8Array, mimeType: string) => Promise<string | null>;

export type SlidesParseOptions = {
  storeImage: SlideImageStore;
  // The slides come with pictures of their own (a Drive import's PDF
  // export rendered per slide): the html says so, and the reader draws the
  // picture over the replica once it loads.
  picture?: boolean;
};

/** The line that opens a slide's speaker notes in its block text. Stored
    data stays English (SPEC.md §2). */
export const SLIDE_NOTES_LABEL = "Speaker notes:";

const DEFAULT_SLIDE_W = 9144000;
const DEFAULT_SLIDE_H = 6858000;
const DEFAULT_FONT_PT = 18;
const DEFAULT_INSET_LR = 91440;
const DEFAULT_INSET_TB = 45720;
const MAX_SLIDES = 500;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  webp: "image/webp",
  svg: "image/svg+xml",
};

// ── Types ────────────────────────────────────────────────────────────────────

type Theme = { colors: ThemeColors; major: string; minor: string; lineWidths: number[] };

type Box = { x: number; y: number; w: number; h: number; rot: number; flipH: boolean; flipV: boolean };

// Maps a child's EMU box into slide EMU: a group's own box against its
// child coordinate space.
type Transform = { ox: number; oy: number; sx: number; sy: number; cx: number; cy: number };
const IDENTITY: Transform = { ox: 0, oy: 0, sx: 1, sy: 1, cx: 0, cy: 0 };

type Bullet =
  | { kind: "none" }
  | { kind: "char"; char: string; font: string | null; color: Element | null; sizePct: number | null }
  | { kind: "auto"; scheme: string; startAt: number; color: Element | null; sizePct: number | null };

// One level of a list style (lvlNpPr): what a paragraph and its runs inherit.
type LevelProps = {
  sz?: number; // hundredths of a point
  bold?: boolean;
  italic?: boolean;
  color?: Element; // the color element, resolved against the palette at render
  font?: string;
  algn?: string;
  marL?: number;
  indent?: number;
  bullet?: Bullet;
  lnSpcPct?: number; // 100 = single
  lnSpcPts?: number;
  spcBef?: number; // points
  spcAft?: number;
};

type ListStyle = LevelProps[]; // index 0 = level 1

type PlaceholderShape = { el: Element; type: string; idx: string | null };

type Part = {
  path: string;
  doc: XMLDocument;
  rels: Map<string, Relationship>;
};

type MasterCtx = {
  master: Part;
  theme: Theme;
  clrMap: Record<string, string>;
  titleStyle: ListStyle;
  bodyStyle: ListStyle;
  otherStyle: ListStyle;
  placeholders: PlaceholderShape[];
};

type LayoutCtx = {
  layout: Part;
  placeholders: PlaceholderShape[];
  showMasterShapes: boolean;
};

type Ctx = {
  zip: OfficeZip;
  slideW: number;
  slideH: number;
  storeImage: SlideImageStore;
  imageUrls: Map<string, Promise<string | null>>;
  masters: Map<string, MasterCtx>;
  layouts: Map<string, LayoutCtx>;
};

// A shape laid out on the slide, ready to render in reading order.
type Placed = {
  html: string; // the shape's markup without its z-index and gaps
  text: string | null; // the shape's words, null when it has none or they are decoration
  box: Box;
  z: number;
  title: boolean;
};

// ── Entry ────────────────────────────────────────────────────────────────────

export async function parseSlides(
  bytes: Uint8Array,
  filename: string,
  opts: SlidesParseOptions,
): Promise<ParsedDocument> {
  const zip = unzipOffice(bytes);
  const presentationPath = officeDocumentPath(zip) ?? "ppt/presentation.xml";
  const presentation = loadPart(zip, presentationPath);
  if (!presentation) throw new Error("Not a presentation: ppt/presentation.xml is missing");

  const sldSz = descendants(presentation.doc, "sldSz")[0];
  const slideW = intAttr(sldSz, "cx") ?? DEFAULT_SLIDE_W;
  const slideH = intAttr(sldSz, "cy") ?? DEFAULT_SLIDE_H;
  const ctx: Ctx = {
    zip,
    slideW: slideW > 0 ? slideW : DEFAULT_SLIDE_W,
    slideH: slideH > 0 ? slideH : DEFAULT_SLIDE_H,
    storeImage: opts.storeImage,
    imageUrls: new Map(),
    masters: new Map(),
    layouts: new Map(),
  };

  const slideIds = descendants(presentation.doc, "sldId");
  const slidePaths: string[] = [];
  for (const sldId of slideIds) {
    const rid = attr(sldId, "id");
    const rel = rid ? presentation.rels.get(rid) : undefined;
    if (rel && !rel.external) slidePaths.push(rel.target);
  }
  if (slidePaths.length === 0) {
    // No slide list: every slide part in name order.
    slidePaths.push(
      ...[...zip.keys()]
        .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
        .sort((a, b) => slideNumberOf(a) - slideNumberOf(b)),
    );
  }

  const blocks: ParsedBlock[] = [];
  const total = Math.min(slidePaths.length, MAX_SLIDES);
  for (let i = 0; i < total; i++) {
    const slide = loadPart(zip, slidePaths[i]);
    const n = i + 1;
    if (!slide) {
      blocks.push(emptySlideBlock(ctx, n, opts.picture));
      continue;
    }
    blocks.push(await parseSlide(ctx, slide, n, opts.picture === true));
  }
  if (slidePaths.length > MAX_SLIDES) {
    blocks.push({
      type: "PARAGRAPH",
      text: `Cut at slide ${MAX_SLIDES} of ${slidePaths.length}.`,
    });
  }

  const title = presentationTitle(zip) ?? filename.replace(/\.pptx$/i, "");
  return { title, blocks, format: "slides", slideAspect: ctx.slideW / ctx.slideH };
}

function slideNumberOf(path: string): number {
  return Number(/slide(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

function officeDocumentPath(zip: OfficeZip): string | null {
  const rels = partRels(zip, "");
  const main = relsOfType(rels, "officeDocument")[0];
  return main && !main.external ? main.target : null;
}

/** The document title from docProps/core.xml, when the file has one. */
function presentationTitle(zip: OfficeZip): string | null {
  const core = parseXmlPart(zip, "docProps/core.xml");
  const title = core ? descendants(core, "title")[0]?.textContent?.trim() : "";
  return title ? cleanText(title) : null;
}

function loadPart(zip: OfficeZip, path: string): Part | null {
  const doc = parseXmlPart(zip, path);
  if (!doc) return null;
  return { path, doc, rels: partRels(zip, path) };
}

function emptySlideBlock(ctx: Ctx, n: number, picture: boolean | undefined): ParsedBlock {
  return {
    type: "SLIDE",
    text: "",
    html: slideShell(ctx, n, "", "", picture === true),
    page: n,
  };
}

// ── Masters and layouts ──────────────────────────────────────────────────────

function masterOf(ctx: Ctx, path: string): MasterCtx | null {
  const cached = ctx.masters.get(path);
  if (cached) return cached;
  const master = loadPart(ctx.zip, path);
  if (!master) return null;
  const themeRel = relsOfType(master.rels, "theme")[0];
  const themeBase = themeRel && !themeRel.external ? parseTheme(ctx.zip, themeRel.target) : { colors: {}, major: "", minor: "" };
  const theme: Theme = { ...themeBase, lineWidths: themeLineWidths(ctx.zip, themeRel?.target ?? null) };
  const clrMap: Record<string, string> = {};
  const map = descendants(master.doc, "clrMap")[0];
  if (map) for (const a of Array.from(map.attributes)) clrMap[a.localName] = a.value;
  const txStyles = descendants(master.doc, "txStyles")[0];
  const built: MasterCtx = {
    master,
    theme,
    clrMap,
    titleStyle: parseListStyle(child(txStyles, "titleStyle")),
    bodyStyle: parseListStyle(child(txStyles, "bodyStyle")),
    otherStyle: parseListStyle(child(txStyles, "otherStyle")),
    placeholders: placeholdersOf(master.doc),
  };
  ctx.masters.set(path, built);
  return built;
}

function themeLineWidths(zip: OfficeZip, themePath: string | null): number[] {
  if (!themePath) return [];
  const doc = parseXmlPart(zip, themePath);
  const list = doc ? descendants(doc, "lnStyleLst")[0] : null;
  return children(list, "ln").map((ln) => intAttr(ln, "w") ?? 9525);
}

function layoutOf(ctx: Ctx, path: string): { layout: LayoutCtx; master: MasterCtx } | null {
  let layout = ctx.layouts.get(path);
  if (!layout) {
    const part = loadPart(ctx.zip, path);
    if (!part) return null;
    const root = part.doc.documentElement;
    layout = {
      layout: part,
      placeholders: placeholdersOf(part.doc),
      showMasterShapes: boolAttr(root, "showMasterSp", true),
    };
    ctx.layouts.set(path, layout);
  }
  const masterRel = relsOfType(layout.layout.rels, "slideMaster")[0];
  const master = masterRel && !masterRel.external ? masterOf(ctx, masterRel.target) : null;
  if (!master) return null;
  return { layout, master };
}

/** The placeholder shapes of a layout or master, by type and index. */
function placeholdersOf(doc: XMLDocument): PlaceholderShape[] {
  const out: PlaceholderShape[] = [];
  const tree = descendants(doc, "spTree")[0];
  for (const sp of descendants(tree, "sp")) {
    const ph = descendants(child(sp, "nvSpPr"), "ph")[0];
    if (!ph) continue;
    out.push({ el: sp, type: normalizePhType(attr(ph, "type")), idx: attr(ph, "idx") });
  }
  return out;
}

// Placeholder types as they match across slide, layout, and master: the
// centered title is a title, a subtitle and an object are body.
function normalizePhType(type: string | null): string {
  if (type === null || type === "obj") return "body";
  if (type === "ctrTitle") return "title";
  if (type === "subTitle") return "body";
  return type;
}

function findPlaceholder(list: PlaceholderShape[], type: string, idx: string | null): Element | null {
  if (idx !== null) {
    const byIdx = list.find((p) => p.idx === idx && p.type === type) ?? list.find((p) => p.idx === idx);
    if (byIdx) return byIdx.el;
  }
  return list.find((p) => p.type === type)?.el ?? null;
}

// ── List styles ──────────────────────────────────────────────────────────────

function parseListStyle(el: Element | null): ListStyle {
  const style: ListStyle = [];
  if (!el) return style;
  for (let level = 1; level <= 9; level++) {
    const pPr = child(el, `lvl${level}pPr`);
    style[level - 1] = pPr ? parseParagraphProps(pPr) : {};
  }
  return style;
}

function parseParagraphProps(pPr: Element | null): LevelProps {
  const props: LevelProps = {};
  if (!pPr) return props;
  const algn = attr(pPr, "algn");
  if (algn) props.algn = algn;
  const marL = intAttr(pPr, "marL");
  if (marL !== null) props.marL = marL;
  const indent = intAttr(pPr, "indent");
  if (indent !== null) props.indent = indent;
  const bullet = parseBullet(pPr);
  if (bullet) props.bullet = bullet;
  const lnSpc = child(pPr, "lnSpc");
  const pct = intAttr(child(lnSpc, "spcPct"), "val");
  const pts = intAttr(child(lnSpc, "spcPts"), "val");
  if (pct !== null) props.lnSpcPct = pct / 1000;
  else if (pts !== null) props.lnSpcPts = pts / 100;
  const bef = intAttr(child(pPr, "spcBef", "spcPts"), "val");
  if (bef !== null) props.spcBef = bef / 100;
  const aft = intAttr(child(pPr, "spcAft", "spcPts"), "val");
  if (aft !== null) props.spcAft = aft / 100;
  const defRPr = child(pPr, "defRPr");
  if (defRPr) Object.assign(props, parseRunProps(defRPr));
  return props;
}

function parseRunProps(rPr: Element): Pick<LevelProps, "sz" | "bold" | "italic" | "color" | "font"> {
  const out: Pick<LevelProps, "sz" | "bold" | "italic" | "color" | "font"> = {};
  const sz = intAttr(rPr, "sz");
  if (sz !== null) out.sz = sz;
  const b = attr(rPr, "b");
  if (b !== null) out.bold = b === "1" || b === "true";
  const i = attr(rPr, "i");
  if (i !== null) out.italic = i === "1" || i === "true";
  const latin = attr(child(rPr, "latin"), "typeface");
  if (latin) out.font = latin;
  const color = colorElementIn(child(rPr, "solidFill"));
  if (color) out.color = color;
  return out;
}

function parseBullet(pPr: Element): Bullet | null {
  if (child(pPr, "buNone")) return { kind: "none" };
  const color = colorElementIn(child(pPr, "buClr"));
  const sizePct = intAttr(child(pPr, "buSzPct"), "val");
  const buChar = child(pPr, "buChar");
  if (buChar) {
    return {
      kind: "char",
      char: attr(buChar, "char") ?? "•",
      font: attr(child(pPr, "buFont"), "typeface"),
      color,
      sizePct: sizePct !== null ? sizePct / 1000 : null,
    };
  }
  const buAuto = child(pPr, "buAutoNum");
  if (buAuto) {
    return {
      kind: "auto",
      scheme: attr(buAuto, "type") ?? "arabicPeriod",
      startAt: intAttr(buAuto, "startAt") ?? 1,
      color,
      sizePct: sizePct !== null ? sizePct / 1000 : null,
    };
  }
  return null;
}

// The first color element under a fill-like element (solidFill, buClr,
// fontRef): srgbClr, schemeClr, sysClr, prstClr, scrgbClr.
function colorElementIn(el: Element | null): Element | null {
  if (!el) return null;
  for (const c of Array.from(el.children)) {
    if (["srgbClr", "schemeClr", "sysClr", "prstClr", "scrgbClr", "hslClr"].includes(c.localName)) return c;
  }
  return null;
}

// ── Colors ───────────────────────────────────────────────────────────────────

const PRESET_COLORS: Record<string, string> = {
  black: "000000",
  white: "FFFFFF",
  red: "FF0000",
  green: "008000",
  blue: "0000FF",
  yellow: "FFFF00",
  gray: "808080",
  grey: "808080",
  darkGray: "A9A9A9",
  lightGray: "D3D3D3",
  orange: "FFA500",
  purple: "800080",
  navy: "000080",
  silver: "C0C0C0",
  lime: "00FF00",
  teal: "008080",
  maroon: "800000",
  olive: "808000",
  aqua: "00FFFF",
  cyan: "00FFFF",
  magenta: "FF00FF",
  fuchsia: "FF00FF",
};

type Palette = { theme: ThemeColors; clrMap: Record<string, string>; phClr: Rgb | null };

/** A color element resolved through the theme, with its modifiers; the
    alpha rides separately. Null when the color cannot be read. */
function resolveColor(el: Element | null, palette: Palette): { rgb: Rgb; alpha: number } | null {
  if (!el) return null;
  let rgb: Rgb | null = null;
  switch (el.localName) {
    case "srgbClr":
      rgb = parseHexColor(attr(el, "val"));
      break;
    case "sysClr":
      rgb = parseHexColor(attr(el, "lastClr")) ?? (attr(el, "val") === "windowText" ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 });
      break;
    case "prstClr":
      rgb = parseHexColor(PRESET_COLORS[attr(el, "val") ?? ""] ?? null);
      break;
    case "scrgbClr": {
      const pct = (name: string) => ((intAttr(el, name) ?? 0) / 100000) * 255;
      rgb = { r: pct("r"), g: pct("g"), b: pct("b") };
      break;
    }
    case "schemeClr": {
      const name = attr(el, "val") ?? "";
      if (name === "phClr") rgb = palette.phClr;
      else {
        const mapped = palette.clrMap[name] ?? name;
        rgb = palette.theme[mapped] ?? palette.theme[name] ?? null;
      }
      break;
    }
    default:
      rgb = null;
  }
  if (!rgb) return null;
  const mods: Parameters<typeof modifyColor>[1] = {};
  let alpha = 1;
  for (const mod of Array.from(el.children)) {
    const val = intAttr(mod, "val");
    if (val === null) continue;
    switch (mod.localName) {
      case "lumMod":
        mods.lumMod = val / 100000;
        break;
      case "lumOff":
        mods.lumOff = val / 100000;
        break;
      case "tint":
        mods.tint = val / 100000;
        break;
      case "shade":
        mods.shade = val / 100000;
        break;
      case "alpha":
        alpha = val / 100000;
        break;
    }
  }
  return { rgb: modifyColor(rgb, mods), alpha };
}

function colorCss(el: Element | null, palette: Palette): string | null {
  const c = resolveColor(el, palette);
  return c ? rgbCss(c.rgb, c.alpha) : null;
}

// ── Fills and lines ──────────────────────────────────────────────────────────

/** The CSS background of a fill container (spPr, bgPr, tcPr, rPr): a solid
    color, a gradient, or a picture. "none" = the file says no fill; null =
    no fill given here (inherit). */
async function fillCss(
  container: Element | null,
  palette: Palette,
  ctx: Ctx,
  rels: Map<string, Relationship>,
): Promise<string | "none" | null> {
  if (!container) return null;
  for (const c of Array.from(container.children)) {
    switch (c.localName) {
      case "noFill":
        return "none";
      case "solidFill": {
        const css = colorCss(colorElementIn(c), palette);
        return css ? `background-color:${css}` : null;
      }
      case "gradFill": {
        const stops = children(child(c, "gsLst"), "gs")
          .map((gs) => {
            const pos = (intAttr(gs, "pos") ?? 0) / 1000;
            const css = colorCss(colorElementIn(gs), palette);
            return css ? `${css} ${num(pos)}%` : null;
          })
          .filter((s): s is string => s !== null);
        if (stops.length === 0) return null;
        if (stops.length === 1) return `background-color:${stops[0].split(" ")[0]}`;
        const lin = child(c, "lin");
        const ang = lin ? (intAttr(lin, "ang") ?? 0) / 60000 : 90;
        // OOXML measures the angle clockwise from left-to-right; CSS from
        // bottom-to-top clockwise, so left-to-right is 90deg.
        return `background-image:linear-gradient(${num(ang + 90)}deg, ${stops.join(", ")})`;
      }
      case "blipFill": {
        const url = await blipUrl(c, ctx, rels);
        // The URL is the app's own image route: no quoting needed, and a
        // quote would end the style attribute.
        return url ? `background-image:url(${url});background-size:cover;background-position:center` : null;
      }
      case "pattFill": {
        const css = colorCss(colorElementIn(child(c, "fgClr")), palette);
        return css ? `background-color:${css}` : null;
      }
    }
  }
  return null;
}

/** The CSS border of a line element (a:ln). "none" = no line; null = no
    line given here. width in EMU. */
function lineCss(ln: Element | null, palette: Palette, slideW: number, fallbackWidth?: number): string | "none" | null {
  if (!ln) return null;
  if (child(ln, "noFill")) return "none";
  const w = intAttr(ln, "w") ?? fallbackWidth ?? 9525;
  const color = colorCss(colorElementIn(child(ln, "solidFill")), palette);
  if (!color) return null;
  const dash = attr(child(ln, "prstDash"), "val");
  const style = dash && dash !== "solid" ? (dash.includes("dot") ? "dotted" : "dashed") : "solid";
  return `${cqw(w, slideW)} ${style} ${color}`;
}

/** An EMU length as a share of the slide's width, in container query
    width units, so it scales with the replica. */
function cqw(emu: number, slideW: number): string {
  return `${num((emu / slideW) * 100)}cqw`;
}

function pct(part: number, whole: number): string {
  return `${num((part / whole) * 100)}%`;
}

// ── Pictures ─────────────────────────────────────────────────────────────────

/** The stored URL of a blip's picture (r:embed → the media part), stored
    once per part. Null when the media is missing, an unsupported format
    (emf, wmf, tiff), or the store declined. */
async function blipUrl(blipFill: Element, ctx: Ctx, rels: Map<string, Relationship>): Promise<string | null> {
  const blip = child(blipFill, "blip");
  if (!blip) return null;
  // An SVG beside the raster (asvg:svgBlip) is the crisper copy.
  const svgBlip = descendants(blip, "svgBlip")[0];
  const svgId = svgBlip ? attr(svgBlip, "embed") : null;
  const rasterId = attr(blip, "embed") ?? attr(blip, "link");
  for (const rid of [svgId, rasterId]) {
    if (!rid) continue;
    const rel = rels.get(rid);
    if (!rel || rel.external) continue;
    const url = await storedImage(ctx, rel.target);
    if (url) return url;
  }
  return null;
}

function storedImage(ctx: Ctx, path: string): Promise<string | null> {
  const cached = ctx.imageUrls.get(path);
  if (cached) return cached;
  const promise = (async () => {
    const bytes = ctx.zip.get(path);
    if (!bytes) return null;
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const mime = IMAGE_MIME_BY_EXT[ext];
    if (!mime) return null;
    try {
      return await ctx.storeImage(bytes, mime);
    } catch (err) {
      console.warn("[slides] picture not stored:", err);
      return null;
    }
  })();
  ctx.imageUrls.set(path, promise);
  return promise;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

function parseXfrm(xfrm: Element | null): Box | null {
  if (!xfrm) return null;
  const off = child(xfrm, "off");
  const ext = child(xfrm, "ext");
  if (!off || !ext) return null;
  return {
    x: intAttr(off, "x") ?? 0,
    y: intAttr(off, "y") ?? 0,
    w: intAttr(ext, "cx") ?? 0,
    h: intAttr(ext, "cy") ?? 0,
    rot: (intAttr(xfrm, "rot") ?? 0) / 60000,
    flipH: boolAttr(xfrm, "flipH"),
    flipV: boolAttr(xfrm, "flipV"),
  };
}

function applyTransform(box: Box, t: Transform): Box {
  return {
    ...box,
    x: t.ox + (box.x - t.cx) * t.sx,
    y: t.oy + (box.y - t.cy) * t.sy,
    w: box.w * t.sx,
    h: box.h * t.sy,
  };
}

function groupTransform(grpSpPr: Element | null, parent: Transform): Transform {
  const xfrm = child(grpSpPr, "xfrm");
  const box = parseXfrm(xfrm);
  const chOff = child(xfrm, "chOff");
  const chExt = child(xfrm, "chExt");
  if (!box || !chOff || !chExt) return parent;
  const outer = applyTransform(box, parent);
  const chW = intAttr(chExt, "cx") || box.w || 1;
  const chH = intAttr(chExt, "cy") || box.h || 1;
  return {
    ox: outer.x,
    oy: outer.y,
    sx: outer.w / chW,
    sy: outer.h / chH,
    cx: intAttr(chOff, "x") ?? 0,
    cy: intAttr(chOff, "y") ?? 0,
  };
}

function boxStyle(box: Box, ctx: Ctx): string {
  const parts = [
    `left:${pct(box.x, ctx.slideW)}`,
    `top:${pct(box.y, ctx.slideH)}`,
    `width:${pct(box.w, ctx.slideW)}`,
    `height:${pct(box.h, ctx.slideH)}`,
  ];
  const transforms: string[] = [];
  if (box.rot) transforms.push(`rotate(${num(box.rot)}deg)`);
  if (box.flipH) transforms.push("scaleX(-1)");
  if (box.flipV) transforms.push("scaleY(-1)");
  if (transforms.length > 0) parts.push(`transform:${transforms.join(" ")}`);
  return parts.join(";");
}

// Preset geometries drawn as clip paths; anything else is a rectangle.
const GEOMETRY_CLIP: Record<string, string> = {
  triangle: "polygon(50% 0, 100% 100%, 0 100%)",
  rtTriangle: "polygon(0 0, 100% 100%, 0 100%)",
  diamond: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
  parallelogram: "polygon(20% 0, 100% 0, 80% 100%, 0 100%)",
  trapezoid: "polygon(20% 0, 80% 0, 100% 100%, 0 100%)",
  hexagon: "polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%)",
  pentagon: "polygon(50% 0, 100% 38%, 82% 100%, 18% 100%, 0 38%)",
  octagon: "polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%)",
  chevron: "polygon(0 0, 75% 0, 100% 50%, 75% 100%, 0 100%, 25% 50%)",
  homePlate: "polygon(0 0, 75% 0, 100% 50%, 75% 100%, 0 100%)",
  rightArrow: "polygon(0 25%, 60% 25%, 60% 0, 100% 50%, 60% 100%, 60% 75%, 0 75%)",
  leftArrow: "polygon(100% 25%, 40% 25%, 40% 0, 0 50%, 40% 100%, 40% 75%, 100% 75%)",
  upArrow: "polygon(25% 100%, 25% 40%, 0 40%, 50% 0, 100% 40%, 75% 40%, 75% 100%)",
  downArrow: "polygon(25% 0, 25% 60%, 0 60%, 50% 100%, 100% 60%, 75% 60%, 75% 0)",
  flowChartDecision: "polygon(50% 0, 100% 50%, 50% 100%, 0 50%)",
  star5: "polygon(50% 0, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)",
};
const LINE_GEOMETRIES = new Set(["line", "straightConnector1", "bentConnector2", "bentConnector3", "curvedConnector2", "curvedConnector3"]);

/** The fill layer's shape: rounded corners, an ellipse, a clip path. */
function geometryStyle(prstGeom: Element | null, box: Box, ctx: Ctx): string {
  const name = attr(prstGeom, "prst") ?? "rect";
  if (name === "ellipse" || name === "flowChartConnector") return "border-radius:50%";
  if (name === "roundRect" || name === "flowChartAlternateProcess" || name === "round2SameRect") {
    const fmla = attr(descendants(prstGeom, "gd")[0], "fmla") ?? "";
    const m = /val (\d+)/.exec(fmla);
    const share = m ? Number(m[1]) / 100000 : 0.16667;
    const radius = Math.min(box.w, box.h) * share;
    return `border-radius:${cqw(radius, ctx.slideW)}`;
  }
  const clip = GEOMETRY_CLIP[name];
  return clip ? `clip-path:${clip}` : "";
}

// ── Text ─────────────────────────────────────────────────────────────────────

type TextSettings = {
  palette: Palette;
  chain: ListStyle[]; // the list styles a paragraph inherits from, nearest first
  fontScale: number; // normAutofit fontScale, 1 = none
  lnSpcReduction: number; // percent points off the line spacing
  defaultColor: string | null; // the style's fontRef color
  defaultFont: string | null;
  major: string;
  minor: string;
  slideW: number;
  rels: Map<string, Relationship>; // the part's relationships, for hyperlinks
};

type RenderedText = { html: string; text: string };

function levelProp<K extends keyof LevelProps>(
  chain: ListStyle[],
  level: number,
  key: K,
  own: LevelProps | null,
): LevelProps[K] | undefined {
  if (own && own[key] !== undefined) return own[key];
  for (const style of chain) {
    const props = style[level];
    if (props && props[key] !== undefined) return props[key];
  }
  // No style rules this level: the first level's rule stands in.
  if (level > 0) {
    for (const style of chain) {
      const props = style[0];
      if (props && props[key] !== undefined) return props[key];
    }
  }
  return undefined;
}

function themeFont(name: string | undefined, s: TextSettings): string | null {
  if (!name) return null;
  if (name.startsWith("+mj")) return s.major || null;
  if (name.startsWith("+mn")) return s.minor || null;
  return name;
}

/** Every paragraph of a text body rendered: <p> rows joined by gaps, and
    the words joined by newlines. Empty when the body has no words. */
function renderTextBody(txBody: Element | null, s: TextSettings): RenderedText {
  if (!txBody) return { html: "", text: "" };
  const paragraphs = children(txBody, "p");
  const counters = new Map<number, number>();
  const rows: RenderedText[] = [];
  for (const p of paragraphs) {
    const pPr = child(p, "pPr");
    const own = parseParagraphProps(pPr);
    const level = Math.max(0, Math.min(8, intAttr(pPr, "lvl") ?? 0));
    // A numbered paragraph counts on from the last at its level; a paragraph
    // at a shallower level restarts the deeper counters.
    for (const key of [...counters.keys()]) if (key > level) counters.delete(key);
    const runs = renderRuns(p, own, level, s);
    const bullet = levelProp(s.chain, level, "bullet", own);
    const hasWords = runs.text.trim().length > 0;
    let bulletHtml = "";
    let bulletText = "";
    if (bullet && bullet.kind !== "none" && hasWords) {
      const label =
        bullet.kind === "char"
          ? bullet.char
          : autoNumberLabel(bullet.scheme, (counters.get(level) ?? bullet.startAt - 1) + 1);
      if (bullet.kind === "auto") counters.set(level, (counters.get(level) ?? bullet.startAt - 1) + 1);
      bulletText = `${label} `;
      const size = runs.firstSize * (bullet.sizePct ?? 1);
      const color = (bullet.color ? colorCss(bullet.color, s.palette) : null) ?? runs.firstColor;
      const font = bullet.kind === "char" && bullet.font ? fontFamilyCss(bullet.font) : "";
      bulletHtml = `<span class="sb" style="font-size:${cqw(size, s.slideW)}${color ? `;color:${color}` : ""}${font ? `;font-family:${font}` : ""}">${escapeHtml(bulletText)}</span>`;
    }
    const algn = levelProp(s.chain, level, "algn", own);
    const marL = levelProp(s.chain, level, "marL", own) ?? (bulletText ? 342900 * (level + 1) : 0);
    const indent = levelProp(s.chain, level, "indent", own) ?? (bulletText ? -342900 : 0);
    const lnPct = levelProp(s.chain, level, "lnSpcPct", own);
    const lnPts = levelProp(s.chain, level, "lnSpcPts", own);
    const spcBef = levelProp(s.chain, level, "spcBef", own);
    const spcAft = levelProp(s.chain, level, "spcAft", own);
    const styles: string[] = [];
    if (algn) styles.push(`text-align:${ALIGN[algn] ?? "left"}`);
    if (marL) styles.push(`padding-left:${cqw(marL, s.slideW)}`);
    if (indent) styles.push(`text-indent:${cqw(indent, s.slideW)}`);
    if (lnPts !== undefined) styles.push(`line-height:${cqw(lnPts * EMU_PER_PT, s.slideW)}`);
    else {
      const pctValue = ((lnPct ?? 100) - s.lnSpcReduction) / 100;
      styles.push(`line-height:${num(Math.max(0.8, 1.2 * pctValue))}`);
    }
    if (spcBef) styles.push(`margin-top:${cqw(spcBef * EMU_PER_PT, s.slideW)}`);
    if (spcAft) styles.push(`margin-bottom:${cqw(spcAft * EMU_PER_PT, s.slideW)}`);
    styles.push(`font-size:${cqw(runs.firstSize, s.slideW)}`);
    const cls = hasWords || runs.text.length > 0 ? "sp" : "sp sp-empty";
    // The bullet hangs in the indent: it takes the indent's width, so the
    // words start at the margin, as PowerPoint lays them out.
    const html = `<p class="${cls}" style="${styles.join(";")}">${bulletHtml}${runs.html}</p>`;
    rows.push({ html, text: bulletText + runs.text });
  }
  // Empty paragraphs at either end are padding, not words.
  while (rows.length > 0 && rows[0].text.trim().length === 0) rows.shift();
  while (rows.length > 0 && rows[rows.length - 1].text.trim().length === 0) rows.pop();
  if (rows.length === 0) return { html: "", text: "" };
  return { html: rows.map((r) => r.html).join(textGap("\n")), text: rows.map((r) => r.text).join("\n") };
}

const ALIGN: Record<string, string> = { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" };

function renderRuns(
  p: Element,
  own: LevelProps,
  level: number,
  s: TextSettings,
): RenderedText & { firstSize: number; firstColor: string | null } {
  const parts: string[] = [];
  let text = "";
  let firstSize: number | null = null;
  let firstColor: string | null = null;
  const inherited = (rPr: Element | null): { size: number; color: string | null; css: string } => {
    const runProps = rPr ? parseRunProps(rPr) : {};
    const sz = runProps.sz ?? levelProp(s.chain, level, "sz", own) ?? DEFAULT_FONT_PT * 100;
    const size = (sz / 100) * EMU_PER_PT * s.fontScale;
    const bold = runProps.bold ?? levelProp(s.chain, level, "bold", own) ?? false;
    const italic = runProps.italic ?? levelProp(s.chain, level, "italic", own) ?? false;
    const font = themeFont(runProps.font ?? levelProp(s.chain, level, "font", own) ?? s.defaultFont ?? undefined, s);
    const runColor = runProps.color ? colorCss(runProps.color, s.palette) : null;
    const levelColor = levelProp(s.chain, level, "color", own);
    const color = runColor ?? (levelColor ? colorCss(levelColor, s.palette) : null) ?? s.defaultColor;
    const styles = [`font-size:${cqw(size, s.slideW)}`];
    if (bold) styles.push("font-weight:700");
    if (italic) styles.push("font-style:italic");
    if (font) styles.push(`font-family:${fontFamilyCss(font)}`);
    if (color) styles.push(`color:${color}`);
    const u = attr(rPr, "u");
    const strike = attr(rPr, "strike");
    const decorations = [u && u !== "none" ? "underline" : "", strike && strike !== "noStrike" ? "line-through" : ""].filter(Boolean);
    if (decorations.length > 0) styles.push(`text-decoration:${decorations.join(" ")}`);
    const baseline = intAttr(rPr, "baseline");
    if (baseline && baseline > 0) styles.push("vertical-align:super;font-size:0.65em");
    else if (baseline && baseline < 0) styles.push("vertical-align:sub;font-size:0.65em");
    const highlight = rPr ? colorCss(colorElementIn(child(rPr, "highlight")), s.palette) : null;
    if (highlight) styles.push(`background-color:${highlight}`);
    return { size, color, css: styles.join(";") };
  };
  for (const node of Array.from(p.children)) {
    if (node.localName === "r" || node.localName === "fld") {
      const rPr = child(node, "rPr");
      const t = cleanText(child(node, "t")?.textContent ?? "");
      if (t.length === 0) continue;
      const run = inherited(rPr);
      if (firstSize === null) {
        firstSize = run.size;
        firstColor = run.color;
      }
      const href = hyperlinkOf(rPr, s);
      const inner = escapeHtml(t);
      parts.push(href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="${run.css}">${inner}</a>` : `<span style="${run.css}">${inner}</span>`);
      text += t;
    } else if (node.localName === "br") {
      parts.push("<br>");
      // The break is a line break inside the paragraph; the DOM has no text
      // node for <br>, so a gap carries the newline.
      parts.push(textGap("\n"));
      text += "\n";
    }
  }
  if (firstSize === null) {
    // No runs: the paragraph's end mark sets the empty line's height.
    const end = inherited(child(p, "endParaRPr"));
    firstSize = end.size;
    firstColor = end.color;
  }
  return { html: parts.join(""), text, firstSize, firstColor };
}

function hyperlinkOf(rPr: Element | null, s: TextSettings): string | null {
  const link = child(rPr, "hlinkClick");
  const rid = link ? attr(link, "id") : null;
  if (!rid) return null;
  const rel = s.rels.get(rid);
  if (!rel || !rel.external) return null;
  return /^https?:\/\//i.test(rel.target) ? rel.target : null;
}

function autoNumberLabel(scheme: string, n: number): string {
  const roman = (value: number): string => {
    const table: [number, string][] = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
    let out = "";
    let left = value;
    for (const [v, sym] of table) while (left >= v) { out += sym; left -= v; }
    return out;
  };
  const alpha = (value: number): string => {
    let out = "";
    let left = value;
    while (left > 0) {
      left -= 1;
      out = String.fromCharCode(97 + (left % 26)) + out;
      left = Math.floor(left / 26);
    }
    return out;
  };
  let core: string;
  if (scheme.startsWith("alphaLc")) core = alpha(n);
  else if (scheme.startsWith("alphaUc")) core = alpha(n).toUpperCase();
  else if (scheme.startsWith("romanLc")) core = roman(n).toLowerCase();
  else if (scheme.startsWith("romanUc")) core = roman(n);
  else core = String(n);
  if (scheme.endsWith("ParenBoth")) return `(${core})`;
  if (scheme.endsWith("ParenR")) return `${core})`;
  if (scheme.endsWith("Period")) return `${core}.`;
  return core;
}

/** The body's insets and vertical anchor as CSS on the text layer. */
function bodyStyle(bodyPr: Element | null, slideW: number, hasFill: boolean): string {
  const l = intAttr(bodyPr, "lIns") ?? DEFAULT_INSET_LR;
  const r = intAttr(bodyPr, "rIns") ?? DEFAULT_INSET_LR;
  const t = intAttr(bodyPr, "tIns") ?? DEFAULT_INSET_TB;
  const b = intAttr(bodyPr, "bIns") ?? DEFAULT_INSET_TB;
  const anchor = attr(bodyPr, "anchor") ?? "t";
  const styles = [`padding:${cqw(t, slideW)} ${cqw(r, slideW)} ${cqw(b, slideW)} ${cqw(l, slideW)}`];
  styles.push(`justify-content:${anchor === "ctr" ? "center" : anchor === "b" ? "flex-end" : "flex-start"}`);
  if (attr(bodyPr, "wrap") === "none") styles.push("white-space:nowrap");
  const vert = attr(bodyPr, "vert");
  if (vert === "vert" || vert === "eaVert") styles.push("writing-mode:vertical-rl");
  else if (vert === "vert270") styles.push("writing-mode:vertical-rl;transform:rotate(180deg)");
  if (hasFill) styles.push("overflow:hidden");
  return styles.join(";");
}

function autofitOf(bodyPr: Element | null): { fontScale: number; lnSpcReduction: number } {
  const norm = child(bodyPr, "normAutofit");
  if (!norm) return { fontScale: 1, lnSpcReduction: 0 };
  return {
    fontScale: (intAttr(norm, "fontScale") ?? 100000) / 100000,
    lnSpcReduction: (intAttr(norm, "lnSpcReduction") ?? 0) / 1000,
  };
}

// ── Shapes ───────────────────────────────────────────────────────────────────

type SlideScope = {
  ctx: Ctx;
  part: Part; // the part the shapes come from (slide, layout, or master)
  master: MasterCtx;
  layout: LayoutCtx | null;
  palette: Palette;
  decoration: boolean; // layout or master shapes: drawn, words skipped
  zBase: number;
};

async function collectShapes(scope: SlideScope, tree: Element | null, transform: Transform, out: Placed[]): Promise<void> {
  if (!tree) return;
  for (const node of Array.from(tree.children)) {
    switch (node.localName) {
      case "sp":
        await placeShape(scope, node, transform, out);
        break;
      case "pic":
        await placePicture(scope, node, transform, out);
        break;
      case "cxnSp":
        placeConnector(scope, node, transform, out);
        break;
      case "grpSp":
        await collectShapes(scope, node, groupTransform(child(node, "grpSpPr"), transform), out);
        break;
      case "graphicFrame":
        await placeGraphicFrame(scope, node, transform, out);
        break;
      case "AlternateContent": {
        const choice = child(node, "Choice") ?? child(node, "Fallback");
        await collectShapes(scope, choice, transform, out);
        break;
      }
    }
  }
}

function placeholderOf(sp: Element): { type: string; idx: string | null; raw: string | null } | null {
  const ph = descendants(child(sp, "nvSpPr") ?? child(sp, "nvPicPr"), "ph")[0];
  if (!ph) return null;
  return { type: normalizePhType(attr(ph, "type")), idx: attr(ph, "idx"), raw: attr(ph, "type") };
}

// Placeholders whose words are the slide's furniture, not its content.
const FURNITURE_PH = new Set(["sldNum", "ftr", "dt", "hdr"]);

/** The layout's and the master's shapes this placeholder inherits from,
    nearest first. */
function inheritanceOf(scope: SlideScope, ph: { type: string; idx: string | null } | null): Element[] {
  if (!ph) return [];
  const chain: Element[] = [];
  if (scope.layout && !scope.decoration) {
    const fromLayout = findPlaceholder(scope.layout.placeholders, ph.type, ph.idx);
    if (fromLayout) chain.push(fromLayout);
  }
  if (scope.part !== scope.master.master) {
    const fromMaster = findPlaceholder(scope.master.placeholders, ph.type, null);
    if (fromMaster) chain.push(fromMaster);
  }
  return chain;
}

function shapeBox(sp: Element, inherited: Element[], transform: Transform): Box | null {
  const candidates = [sp, ...inherited];
  for (const el of candidates) {
    const box = parseXfrm(child(el, "spPr", "xfrm"));
    if (box) return applyTransform(box, el === sp ? transform : IDENTITY);
  }
  return null;
}

async function placeShape(scope: SlideScope, sp: Element, transform: Transform, out: Placed[]): Promise<void> {
  const { ctx, palette } = scope;
  const ph = placeholderOf(sp);
  // A layout's or master's placeholder is a prompt ("Click to add title"),
  // not a shape the slide shows.
  if (ph && scope.decoration) return;
  const inherited = inheritanceOf(scope, ph);
  const box = shapeBox(sp, inherited, transform);
  if (!box) return;
  const spPr = child(sp, "spPr");
  const style = child(sp, "style");
  const stylePalette = { ...palette };
  const fillRefColor = resolveColor(colorElementIn(child(style, "fillRef")), palette);
  const lnRefColor = resolveColor(colorElementIn(child(style, "lnRef")), palette);
  const fontRefColor = resolveColor(colorElementIn(child(style, "fontRef")), palette);
  // Placeholders on the slide inherit the fill and line of their layout
  // and master counterparts when they set none.
  let fill: string | "none" | null = null;
  let line: string | "none" | null = null;
  for (const el of [sp, ...inherited]) {
    const pr = child(el, "spPr");
    if (fill === null) fill = await fillCss(pr, { ...stylePalette, phClr: fillRefColor?.rgb ?? null }, ctx, scope.part.rels);
    if (line === null) line = lineCss(child(pr, "ln"), { ...stylePalette, phClr: lnRefColor?.rgb ?? null }, ctx.slideW);
    if (fill !== null && line !== null) break;
  }
  const fillIdx = intAttr(child(style, "fillRef"), "idx") ?? 0;
  if (fill === null && fillIdx > 0 && fillRefColor) fill = `background-color:${rgbCss(fillRefColor.rgb, fillRefColor.alpha)}`;
  const lnIdx = intAttr(child(style, "lnRef"), "idx") ?? 0;
  if (line === null && lnIdx > 0 && lnRefColor) {
    const width = scope.master.theme.lineWidths[lnIdx - 1] ?? 9525;
    line = `${cqw(width, ctx.slideW)} solid ${rgbCss(lnRefColor.rgb, lnRefColor.alpha)}`;
  }
  const prstGeom = child(spPr, "prstGeom");
  const geometry = attr(prstGeom, "prst") ?? "rect";
  if (LINE_GEOMETRIES.has(geometry)) {
    out.push({ html: lineHtml(box, line, ctx), text: null, box, z: out.length + scope.zBase, title: false });
    return;
  }
  const fillStyles = [fill && fill !== "none" ? fill : "", line && line !== "none" ? `border:${line}` : "", geometryStyle(prstGeom, box, ctx)]
    .filter(Boolean)
    .join(";");
  const fillLayer = fillStyles ? `<div class="sf" style="${fillStyles}"></div>` : "";

  // The text: the shape's own list style, then its placeholder chain's, then
  // the master's text styles for its kind.
  const txBody = child(sp, "txBody");
  const chain: ListStyle[] = [];
  for (const el of [sp, ...inherited]) {
    const lst = child(el, "txBody", "lstStyle");
    if (lst) chain.push(parseListStyle(lst));
  }
  const isTitle = ph?.type === "title";
  chain.push(ph ? (isTitle ? scope.master.titleStyle : scope.master.bodyStyle) : scope.master.otherStyle);
  const bodyPr = child(txBody, "bodyPr") ?? child(inherited[0], "txBody", "bodyPr") ?? child(inherited[1], "txBody", "bodyPr");
  const autofit = autofitOf(child(txBody, "bodyPr"));
  const settings: TextSettings = {
    palette: { ...palette, phClr: fontRefColor?.rgb ?? null },
    chain,
    fontScale: autofit.fontScale,
    lnSpcReduction: autofit.lnSpcReduction,
    defaultColor: fontRefColor ? rgbCss(fontRefColor.rgb, fontRefColor.alpha) : ph ? null : defaultTextColor(palette),
    defaultFont: themeFontName(child(style, "fontRef")),
    major: scope.master.theme.major,
    minor: scope.master.theme.minor,
    slideW: ctx.slideW,
    rels: scope.part.rels,
  };
  const rendered = renderTextBody(txBody, settings);
  const furniture = ph !== null && FURNITURE_PH.has(ph.raw ?? "");
  const decoration = scope.decoration || furniture;
  const textLayer = rendered.html
    ? `<div class="st" style="${bodyStyle(bodyPr, ctx.slideW, false)}"${decoration ? " data-anchor-skip" : ""}>${rendered.html}</div>`
    : "";
  if (!fillLayer && !textLayer) return;
  out.push({
    html: `<div class="sh" style="${boxStyle(box, ctx)}">${fillLayer}${textLayer}</div>`,
    text: rendered.text && !decoration ? rendered.text : null,
    box,
    z: out.length + scope.zBase,
    title: isTitle && !decoration,
  });
}

function defaultTextColor(palette: Palette): string | null {
  const tx1 = palette.clrMap.tx1 ?? "dk1";
  const rgb = palette.theme[tx1];
  return rgb ? rgbCss(rgb) : null;
}

function themeFontName(fontRef: Element | null): string | null {
  const idx = attr(fontRef, "idx");
  if (idx === "major") return "+mj-lt";
  if (idx === "minor") return "+mn-lt";
  return null;
}

// A line's stroke is drawn in screen pixels (non-scaling), sized for the
// reader's column: the slide's width at this many pixels.
const LINE_REFERENCE_PX = 960;

function lineHtml(box: Box, line: string | "none" | null, ctx: Ctx): string {
  const stroke = line && line !== "none" ? line : `${cqw(9525, ctx.slideW)} solid #000000`;
  const [cqwWidth, style, ...rest] = stroke.split(" ");
  const color = rest.join(" ") || "#000000";
  const width = `${num(Math.max(1, (parseFloat(cqwWidth) / 100) * LINE_REFERENCE_PX))}px`;
  const dash = style === "dashed" ? 'stroke-dasharray="6 4"' : style === "dotted" ? 'stroke-dasharray="2 3"' : "";
  // A line runs corner to corner of its box; a flip picks which corners.
  // The box itself may have no height (a horizontal line): the svg keeps a
  // minimum so the stroke shows.
  const y1 = box.flipV ? 100 : 0;
  const y2 = box.flipV ? 0 : 100;
  const x1 = box.flipH ? 100 : 0;
  const x2 = box.flipH ? 0 : 100;
  const flat = box.h < 1 ? "50" : null;
  const tall = box.w < 1 ? "50" : null;
  const styles = boxStyle({ ...box, flipH: false, flipV: false }, ctx);
  return `<div class="sh sl" style="${styles}"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="${tall ?? x1}" y1="${flat ?? y1}" x2="${tall ?? x2}" y2="${flat ?? y2}" vector-effect="non-scaling-stroke" style="stroke:${color};stroke-width:${width}" ${dash}/></svg></div>`;
}

function placeConnector(scope: SlideScope, cxn: Element, transform: Transform, out: Placed[]): void {
  const box = parseXfrm(child(cxn, "spPr", "xfrm"));
  if (!box) return;
  const placed = applyTransform(box, transform);
  const style = child(cxn, "style");
  const lnRefColor = resolveColor(colorElementIn(child(style, "lnRef")), scope.palette);
  let line = lineCss(child(cxn, "spPr", "ln"), { ...scope.palette, phClr: lnRefColor?.rgb ?? null }, scope.ctx.slideW);
  const lnIdx = intAttr(child(style, "lnRef"), "idx") ?? 0;
  if (line === null && lnIdx > 0 && lnRefColor) {
    const width = scope.master.theme.lineWidths[lnIdx - 1] ?? 9525;
    line = `${cqw(width, scope.ctx.slideW)} solid ${rgbCss(lnRefColor.rgb, lnRefColor.alpha)}`;
  }
  out.push({ html: lineHtml(placed, line, scope.ctx), text: null, box: placed, z: out.length + scope.zBase, title: false });
}

async function placePicture(scope: SlideScope, pic: Element, transform: Transform, out: Placed[]): Promise<void> {
  const { ctx } = scope;
  const ph = placeholderOf(pic);
  if (ph && scope.decoration) return;
  const inherited = inheritanceOf(scope, ph);
  const box = shapeBox(pic, inherited, transform);
  if (!box) return;
  const blipFill = child(pic, "blipFill");
  const url = blipFill ? await blipUrl(blipFill, ctx, scope.part.rels) : null;
  const line = lineCss(child(pic, "spPr", "ln"), scope.palette, ctx.slideW);
  const border = line && line !== "none" ? `border:${line};` : "";
  const geometry = geometryStyle(child(pic, "spPr", "prstGeom"), box, ctx);
  let inner: string;
  if (url) {
    // A crop (srcRect, in thousandths of a percent) shows part of the picture:
    // the image is scaled up and shifted so the box shows the kept part.
    const src = child(blipFill, "srcRect");
    const l = (intAttr(src, "l") ?? 0) / 100000;
    const r = (intAttr(src, "r") ?? 0) / 100000;
    const t = (intAttr(src, "t") ?? 0) / 100000;
    const b = (intAttr(src, "b") ?? 0) / 100000;
    const wShare = Math.max(0.01, 1 - l - r);
    const hShare = Math.max(0.01, 1 - t - b);
    const imgStyle =
      l || r || t || b
        ? `width:${num(100 / wShare)}%;height:${num(100 / hShare)}%;left:${num((-l / wShare) * 100)}%;top:${num((-t / hShare) * 100)}%`
        : "width:100%;height:100%";
    inner = `<img src="${escapeHtml(url)}" alt="" loading="lazy" draggable="false" style="${imgStyle}">`;
  } else {
    const name = cleanText(attr(child(pic, "nvPicPr", "cNvPr"), "descr") ?? attr(child(pic, "nvPicPr", "cNvPr"), "name") ?? "");
    inner = `<div class="sf sf-missing" data-anchor-skip>${escapeHtml(name)}</div>`;
  }
  out.push({
    html: `<div class="sh si" style="${boxStyle(box, ctx)};${border}${geometry}">${inner}</div>`,
    text: null,
    box,
    z: out.length + scope.zBase,
    title: false,
  });
}

async function placeGraphicFrame(scope: SlideScope, frame: Element, transform: Transform, out: Placed[]): Promise<void> {
  const box = parseXfrm(child(frame, "xfrm"));
  if (!box) return;
  const placed = applyTransform(box, transform);
  const data = child(frame, "graphic", "graphicData");
  const tbl = child(data, "tbl");
  if (tbl) {
    const table = await renderTable(scope, tbl, placed);
    out.push({
      html: `<div class="sh sg" style="${boxStyle(placed, scope.ctx)}">${table.html}</div>`,
      text: scope.decoration || !table.text ? null : table.text,
      box: placed,
      z: out.length + scope.zBase,
      title: false,
    });
    return;
  }
  const chart = child(data, "chart");
  if (chart) {
    const rid = attr(chart, "id");
    const rel = rid ? scope.part.rels.get(rid) : undefined;
    const rendered = rel && !rel.external ? renderChart(scope, rel.target) : null;
    if (rendered) {
      out.push({
        html: `<div class="sh sc" style="${boxStyle(placed, scope.ctx)}">${rendered.html}</div>`,
        text: scope.decoration || !rendered.text ? null : rendered.text,
        box: placed,
        z: out.length + scope.zBase,
        title: false,
      });
    }
    return;
  }
  // Another embedded object (a diagram, an OLE object): its picture, when
  // the frame carries one as a fallback.
  const fallbackBlip = descendants(frame, "blipFill")[0];
  if (fallbackBlip) {
    const url = await blipUrl(fallbackBlip, scope.ctx, scope.part.rels);
    if (url) {
      out.push({
        html: `<div class="sh si" style="${boxStyle(placed, scope.ctx)}"><img src="${escapeHtml(url)}" alt="" loading="lazy" draggable="false" style="width:100%;height:100%"></div>`,
        text: null,
        box: placed,
        z: out.length + scope.zBase,
        title: false,
      });
    }
  }
}

// ── Tables ───────────────────────────────────────────────────────────────────

async function renderTable(scope: SlideScope, tbl: Element, box: Box): Promise<RenderedText> {
  const { ctx } = scope;
  const cols = children(child(tbl, "tblGrid"), "gridCol").map((c) => intAttr(c, "w") ?? 0);
  const totalW = cols.reduce((a, b) => a + b, 0) || box.w || 1;
  const rows = children(tbl, "tr");
  const settings: TextSettings = {
    palette: scope.palette,
    chain: [scope.master.otherStyle],
    fontScale: 1,
    lnSpcReduction: 0,
    defaultColor: defaultTextColor(scope.palette),
    defaultFont: "+mn-lt",
    major: scope.master.theme.major,
    minor: scope.master.theme.minor,
    slideW: ctx.slideW,
    rels: scope.part.rels,
  };
  const colgroup = cols.length > 0 ? `<colgroup>${cols.map((w) => `<col style="width:${pct(w, totalW)}">`).join("")}</colgroup>` : "";
  const rowHtml: string[] = [];
  const rowText: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const tr = rows[r];
    const cells = children(tr, "tc");
    const height = intAttr(tr, "h");
    const cellHtml: string[] = [];
    const cellText: string[] = [];
    let pendingGaps = "";
    for (let c = 0; c < cells.length; c++) {
      const tc = cells[c];
      const last = c === cells.length - 1;
      const sep = last ? (r === rows.length - 1 ? "" : textGap("\n")) : textGap("\t");
      // A merged-away cell keeps its place in the text (its tab) inside
      // the cell that covers it, so the rows stay aligned.
      if (boolAttr(tc, "hMerge") || boolAttr(tc, "vMerge")) {
        cellText.push("");
        pendingGaps += sep;
        continue;
      }
      const rendered = renderTextBody(child(tc, "txBody"), settings);
      const tcPr = child(tc, "tcPr");
      const fill = await fillCss(tcPr, scope.palette, ctx, scope.part.rels);
      const styles: string[] = [];
      if (fill && fill !== "none") styles.push(fill);
      const l = intAttr(tcPr, "marL") ?? 91440;
      const rr = intAttr(tcPr, "marR") ?? 91440;
      const t = intAttr(tcPr, "marT") ?? 45720;
      const b = intAttr(tcPr, "marB") ?? 45720;
      styles.push(`padding:${cqw(t, ctx.slideW)} ${cqw(rr, ctx.slideW)} ${cqw(b, ctx.slideW)} ${cqw(l, ctx.slideW)}`);
      const anchor = attr(tcPr, "anchor");
      if (anchor === "ctr") styles.push("vertical-align:middle");
      else if (anchor === "b") styles.push("vertical-align:bottom");
      for (const side of ["lnL", "lnR", "lnT", "lnB"] as const) {
        const ln = lineCss(child(tcPr, side), scope.palette, ctx.slideW);
        if (ln && ln !== "none") styles.push(`border-${side === "lnL" ? "left" : side === "lnR" ? "right" : side === "lnT" ? "top" : "bottom"}:${ln}`);
      }
      const span = [intAttr(tc, "gridSpan") ? ` colspan="${intAttr(tc, "gridSpan")}"` : "", intAttr(tc, "rowSpan") ? ` rowspan="${intAttr(tc, "rowSpan")}"` : ""].join("");
      cellHtml.push(`<td${span} style="${styles.join(";")}">${pendingGaps}${rendered.html}${sep}</td>`);
      pendingGaps = "";
      cellText.push(rendered.text);
    }
    if (pendingGaps && cellHtml.length > 0) {
      cellHtml[cellHtml.length - 1] = cellHtml[cellHtml.length - 1].replace(/<\/td>$/, `${pendingGaps}</td>`);
    }
    rowHtml.push(`<tr${height ? ` style="height:${cqw(height, ctx.slideW)}"` : ""}>${cellHtml.join("")}</tr>`);
    rowText.push(cellText.join("\t"));
  }
  const text = rowText.join("\n");
  if (text.trim().length === 0) return { html: "", text: "" };
  return { html: `<table class="stbl">${colgroup}<tbody>${rowHtml.join("")}</tbody></table>`, text };
}

// ── Charts ───────────────────────────────────────────────────────────────────

/** A chart's data as a small table with its title: the categories down the
    first column, one column per series. Its picture, when the slide has
    one, is the stored slide picture. */
function renderChart(scope: SlideScope, chartPath: string): RenderedText | null {
  const doc = parseXmlPart(scope.ctx.zip, chartPath);
  if (!doc) return null;
  const chart = descendants(doc, "chart")[0];
  const titleText = cleanText(
    descendants(child(chart, "title"), "t")
      .map((t) => t.textContent ?? "")
      .join(""),
  ).trim();
  const series: { name: string; cats: string[]; vals: string[] }[] = [];
  for (const ser of descendants(chart, "ser")) {
    const name = cleanText(descendants(child(ser, "tx"), "v")[0]?.textContent ?? descendants(child(ser, "tx"), "t").map((t) => t.textContent ?? "").join("")).trim();
    const cats = descendants(child(ser, "cat"), "pt").map((pt) => cleanText(child(pt, "v")?.textContent ?? ""));
    const vals = descendants(child(ser, "val"), "pt").map((pt) => cleanText(child(pt, "v")?.textContent ?? ""));
    series.push({ name, cats, vals });
  }
  const rows: string[][] = [];
  const categories = series.find((s) => s.cats.length > 0)?.cats ?? [];
  if (categories.length > 0) {
    rows.push(["", ...series.map((s) => s.name)]);
    categories.forEach((cat, i) => rows.push([cat, ...series.map((s) => s.vals[i] ?? "")]));
  } else if (series.length > 0) {
    rows.push(series.map((s) => s.name));
    const longest = Math.max(...series.map((s) => s.vals.length));
    for (let i = 0; i < longest; i++) rows.push(series.map((s) => s.vals[i] ?? ""));
  }
  const pieces: RenderedText[] = [];
  if (titleText) pieces.push({ html: `<div class="sct">${escapeHtml(titleText)}</div>`, text: titleText });
  if (rows.length > 0) {
    const html = `<table class="stbl scd"><tbody>${rows
      .map((row, r) => `<tr>${row.map((cell, c) => {
        const last = c === row.length - 1;
        const gap = last ? (r === rows.length - 1 ? "" : textGap("\n")) : textGap("\t");
        return `<td>${escapeHtml(cell)}${gap}</td>`;
      }).join("")}</tr>`)
      .join("")}</tbody></table>`;
    pieces.push({ html, text: rows.map((r) => r.join("\t")).join("\n") });
  }
  if (pieces.length === 0) return null;
  return { html: pieces.map((p) => p.html).join(textGap("\n")), text: pieces.map((p) => p.text).join("\n") };
}

// ── The slide ────────────────────────────────────────────────────────────────

async function backgroundCss(scope: SlideScope, cSld: Element | null): Promise<string | null> {
  const bg = child(cSld, "bg");
  if (!bg) return null;
  const bgPr = child(bg, "bgPr");
  if (bgPr) {
    const fill = await fillCss(bgPr, scope.palette, scope.ctx, scope.part.rels);
    return fill && fill !== "none" ? fill : null;
  }
  const bgRef = child(bg, "bgRef");
  if (bgRef) {
    const css = colorCss(colorElementIn(bgRef), scope.palette);
    return css ? `background-color:${css}` : null;
  }
  return null;
}

async function parseSlide(ctx: Ctx, slide: Part, n: number, picture: boolean): Promise<ParsedBlock> {
  const layoutRel = relsOfType(slide.rels, "slideLayout")[0];
  const found = layoutRel && !layoutRel.external ? layoutOf(ctx, layoutRel.target) : null;
  // A slide with no layout still renders: a bare master gives defaults.
  const master: MasterCtx = found?.master ?? {
    master: slide,
    theme: { colors: {}, major: "", minor: "", lineWidths: [] },
    clrMap: {},
    titleStyle: [],
    bodyStyle: [],
    otherStyle: [],
    placeholders: [],
  };
  const layout = found?.layout ?? null;
  const clrMap = { ...master.clrMap };
  const override = layout ? descendants(layout.layout.doc, "clrMapOvr")[0] : null;
  const overrideMap = child(override, "overrideClrMapping");
  if (overrideMap) for (const a of Array.from(overrideMap.attributes)) clrMap[a.localName] = a.value;
  const palette: Palette = { theme: master.theme.colors, clrMap, phClr: null };

  const root = slide.doc.documentElement;
  const cSld = child(root, "cSld");
  const showMaster = boolAttr(root, "showMasterSp", true);

  const placed: Placed[] = [];
  const scopeFor = (part: Part, decoration: boolean, zBase: number): SlideScope => ({
    ctx,
    part,
    master,
    layout,
    palette,
    decoration,
    zBase,
  });
  // The master's and the layout's own shapes draw under the slide's, their
  // words skipped: they are the deck's furniture.
  if (showMaster && found) {
    if (layout?.showMasterShapes !== false) {
      const masterTree = child(child(master.master.doc.documentElement, "cSld"), "spTree");
      await collectShapes(scopeFor(master.master, true, 0), masterTree, IDENTITY, placed);
    }
    if (layout) {
      const layoutTree = child(child(layout.layout.doc.documentElement, "cSld"), "spTree");
      await collectShapes(scopeFor(layout.layout, true, 1000), layoutTree, IDENTITY, placed);
    }
  }
  const decorationCount = placed.length;
  await collectShapes(scopeFor(slide, false, 2000), child(cSld, "spTree"), IDENTITY, placed);

  // The background: the slide's, else the layout's, else the master's.
  let background = await backgroundCss(scopeFor(slide, false, 0), cSld);
  if (!background && layout) background = await backgroundCss(scopeFor(layout.layout, true, 0), child(layout.layout.doc.documentElement, "cSld"));
  if (!background && found) background = await backgroundCss(scopeFor(master.master, true, 0), child(master.master.doc.documentElement, "cSld"));

  // Reading order: the decoration first (it has no words), then the title,
  // then the rest top to bottom, left to right. The z-index keeps the
  // slide's own stacking whatever the order.
  const decoration = placed.slice(0, decorationCount);
  const own = placed.slice(decorationCount);
  const band = ctx.slideH * 0.04;
  const ordered = [...own].sort((a, b) => {
    if (a.title !== b.title) return a.title ? -1 : 1;
    const ay = Math.round(a.box.y / band);
    const by = Math.round(b.box.y / band);
    if (ay !== by) return ay - by;
    return a.box.x - b.box.x;
  });

  const pieces: string[] = [];
  const htmlParts: string[] = [];
  for (const shape of [...decoration, ...ordered]) {
    const withZ = shape.html.replace(/^<div class="([^"]*)" style="/, `<div class="$1" style="z-index:${shape.z};`);
    if (shape.text !== null && shape.text.length > 0) {
      if (pieces.length > 0) htmlParts.push(textGap("\n"));
      pieces.push(shape.text);
    }
    htmlParts.push(withZ);
  }

  // Speaker notes: the notes slide's body placeholder.
  const notesRel = relsOfType(slide.rels, "notesSlide")[0];
  const notes = notesRel && !notesRel.external ? notesText(ctx, notesRel.target, master, palette) : null;
  let notesHtml = "";
  if (notes && notes.text.trim().length > 0) {
    const label = SLIDE_NOTES_LABEL;
    const gapBefore = pieces.length > 0 ? textGap("\n") : "";
    pieces.push(label, notes.text);
    notesHtml = `${gapBefore}<div class="slide-notes"><span class="slide-notes-label">${escapeHtml(label)}</span>${textGap("\n")}<div class="slide-notes-body">${notes.html}</div></div>`;
  }

  const text = pieces.join("\n");
  return {
    type: "SLIDE",
    text,
    html: slideShell(ctx, n, htmlParts.join(""), notesHtml, picture, background),
    page: n,
  };
}

function notesText(ctx: Ctx, path: string, master: MasterCtx, palette: Palette): RenderedText | null {
  const part = loadPart(ctx.zip, path);
  if (!part) return null;
  const tree = descendants(part.doc, "spTree")[0];
  const rows: RenderedText[] = [];
  const settings: TextSettings = {
    palette,
    chain: [],
    fontScale: 1,
    lnSpcReduction: 0,
    defaultColor: null,
    defaultFont: null,
    major: master.theme.major,
    minor: master.theme.minor,
    slideW: ctx.slideW,
    rels: part.rels,
  };
  for (const sp of descendants(tree, "sp")) {
    const ph = placeholderOf(sp);
    if (!ph || ph.type !== "body") continue;
    // Notes read at the reader's size, not the slide's: the sizes are
    // dropped, the words and their weight kept.
    const rendered = renderTextBody(child(sp, "txBody"), settings);
    if (rendered.text.trim().length > 0) rows.push(rendered);
  }
  if (rows.length === 0) return null;
  return {
    html: rows.map((r) => r.html.replace(/font-size:[^;"]*;?/g, "").replace(/line-height:[^;"]*;?/g, "")).join(textGap("\n")),
    text: rows.map((r) => r.text).join("\n"),
  };
}

/** The slide's markup: the frame that scales, the slide with its number
    label, and the notes under it. */
function slideShell(ctx: Ctx, n: number, shapes: string, notes: string, picture: boolean, background?: string | null): string {
  const ratio = `${ctx.slideW} / ${ctx.slideH}`;
  const bg = background ? `${background};` : "";
  return (
    `<div class="slide-frame" data-slide="${n}"${picture ? ' data-picture="1"' : ""}>` +
    `<div class="slide" style="aspect-ratio:${cssValue(ratio)};${bg}">` +
    `<span class="slide-number" data-anchor-skip>${n}</span>` +
    shapes +
    `</div>${notes}</div>`
  );
}
