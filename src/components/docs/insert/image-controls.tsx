"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { CheckIcon, DropDownIcon, MoreVertIcon } from "@/components/docs/icons";
import { Swatches } from "@/components/docs/insert/colors";
import { onInsert, type InsertContext } from "@/components/docs/insert/context";
import {
  AltTextIcon,
  BehindTextIcon,
  BorderColorIcon,
  BorderDashIcon,
  BorderWeightIcon,
  BreakTextIcon,
  CropIcon,
  ImageOptionsIcon,
  InFrontIcon,
  InLineIcon,
  RefreshIcon,
  ResetIcon,
  RotateIcon,
  WrapTextIcon,
} from "@/components/docs/insert/icons";
import {
  imageAttrs,
  imageViewAt,
  replaceImage,
  resetImage,
  selectedImage,
  textWidthPx,
  type Dash,
  type Recolor,
  type Wrap,
  type WrapSide,
} from "@/components/docs/insert/image";
import { FloatingBox, PanelSection, SidePanel, useEditorTick, useViewportTick, type Anchor } from "@/components/docs/insert/ui";
import type { TKey } from "@/lib/i18n/dictionaries";

// The image's own controls (SPEC.md §29), Google Docs' way: under a
// selected image a floating toolbar — In line, Wrap text, Break text,
// Behind text, In front of text, the margin from the text, and (the main
// toolbar's image buttons, here beside them) Crop, Border color, Border
// weight, Border dash, Replace image, Reset image, and More — and the Image
// options panel: Size & rotation, Text wrapping, Recolor, Adjustments, Alt
// text (Ctrl+Alt+Y opens it at the description).

const MODES: { wrap: Wrap; label: TKey; Icon: (p: { size?: number }) => ReactNode }[] = [
  { wrap: "inline", label: "docsInsert.inLine", Icon: InLineIcon },
  { wrap: "wrap", label: "docsInsert.wrapText", Icon: WrapTextIcon },
  { wrap: "break", label: "docsInsert.breakText", Icon: BreakTextIcon },
  { wrap: "behind", label: "docsInsert.behindText", Icon: BehindTextIcon },
  { wrap: "front", label: "docsInsert.inFrontOfText", Icon: InFrontIcon },
];

/** Margins from the text, in points: 0", 1/16", 1/8", 1/4", 3/8", 1/2", 3/4", 1". */
const MARGINS: [number, string][] = [
  [0, '0"'],
  [4.5, '1/16"'],
  [9, '1/8"'],
  [18, '1/4"'],
  [27, '3/8"'],
  [36, '1/2"'],
  [54, '3/4"'],
  [72, '1"'],
];

export const BORDER_WEIGHTS = [0, 0.5, 1, 1.5, 2, 3, 4, 6];
export const DASHES: { dash: Dash; label: TKey }[] = [
  { dash: "solid", label: "docsInsert.dashSolid" },
  { dash: "dotted", label: "docsInsert.dashDotted" },
  { dash: "dashed", label: "docsInsert.dashDashed" },
];

type Section = "size" | "wrap" | "recolor" | "adjust" | "alt";

function rectOf(el: Element | null | undefined): Anchor | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, bottom: r.bottom, right: r.right };
}

/** A toolbar button whose press opens a small menu under it. */
export function DropButton({
  label,
  face,
  children,
  wide,
  disabled,
}: {
  label: string;
  face: ReactNode;
  children: (close: () => void) => ReactNode;
  wide?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const anchor = open ? rectOf(ref.current) : null;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`docs-tb-btn docs-tb-drop${wide ? " docs-tb-wide" : ""}${open ? " docs-tb-open" : ""}`}
        aria-label={label}
        data-tip={open ? undefined : label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        {face}
        <DropDownIcon size={18} className="docs-tb-caret" />
      </button>
      {open && anchor && (
        <FloatingBox anchor={anchor} className="docs-img-menu" role="menu" onDismiss={() => setOpen(false)}>
          {children(() => setOpen(false))}
        </FloatingBox>
      )}
    </>
  );
}

export function MenuRow({ checked, onSelect, children }: { checked?: boolean; onSelect: () => void; children: ReactNode }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} className="docs-dd-option" onClick={onSelect}>
      <span className="docs-dd-check">{checked ? <CheckIcon size={18} /> : null}</span>
      {children}
    </button>
  );
}

export function ImageControlsHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  const t = useT();
  useEditorTick(editor);
  const hit = selectedImage(editor.state);
  useViewportTick(hit !== null);
  const [panel, setPanel] = useState<Section | null>(null);
  const [byUrl, setByUrl] = useState(false);
  const [url, setUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const hitPos = hit?.pos ?? null;

  useEffect(
    () =>
      onInsert(editor, (event) => {
        if (event.type === "image-options") setPanel(event.section ?? "size");
        if (event.type === "crop") {
          const found = selectedImage(editor.state);
          if (found) imageViewAt(editor.view, found.pos)?.startCrop();
        }
        if (event.type === "image-replace") {
          if (event.source === "upload") fileRef.current?.click();
          else setByUrl(true);
        }
      }),
    [editor],
  );

  // The panel belongs to the selected image; it closes with the selection.
  const [lastPos, setLastPos] = useState(hitPos);
  if (lastPos !== hitPos) {
    setLastPos(hitPos);
    if (hitPos === null) {
      setPanel(null);
      setByUrl(false);
    }
  }

  const file = (
    <input
      ref={fileRef}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const chosen = e.target.files?.[0];
        e.target.value = "";
        const found = selectedImage(editor.state);
        if (chosen && found) void replaceImage(editor, found.pos, { file: chosen });
      }}
    />
  );
  if (!hit || !ctx.editing) return file;
  const figure = editor.view.nodeDOM(hit.pos);
  const box = figure instanceof HTMLElement ? figure.querySelector(".docs-img-box") : null;
  const anchor = rectOf(box);
  const a = imageAttrs(hit.node);
  const pageless = ctx.pageSetup.pageless;
  const set = (attrs: Record<string, unknown>) => editor.chain().updateImage(attrs).run();

  return (
    <>
      {file}
      {anchor && (
        <FloatingBox anchor={anchor} gap={12} className="docs-img-toolbar" role="toolbar" label={t("docsInsert.imageOptions")}>
          {MODES.map(({ wrap, label, Icon }) => {
            const off = pageless && wrap !== "inline";
            return (
              <button
                key={wrap}
                type="button"
                className="docs-tb-btn docs-img-mode"
                aria-pressed={(pageless ? "inline" : a.wrap) === wrap}
                aria-label={t(label)}
                data-tip={off ? t("docsInsert.pagelessInline") : t(label)}
                disabled={off}
                onClick={() => set({ wrap })}
              >
                <Icon size={20} />
              </button>
            );
          })}
          {!pageless && (a.wrap === "wrap" || a.wrap === "break") && (
            <DropButton
              label={t("docsInsert.margin")}
              wide
              face={<span className="docs-tb-text">{MARGINS.find(([pt]) => pt === a.wrapMargin)?.[1] ?? `${a.wrapMargin}pt`}</span>}
            >
              {(close) =>
                MARGINS.map(([pt, name]) => (
                  <MenuRow
                    key={pt}
                    checked={a.wrapMargin === pt}
                    onSelect={() => {
                      set({ wrapMargin: pt });
                      close();
                    }}
                  >
                    {name}
                  </MenuRow>
                ))
              }
            </DropButton>
          )}
          <span className="docs-tb-sep" aria-hidden />
          <button
            type="button"
            className="docs-tb-btn"
            aria-label={t("docsInsert.cropImage")}
            data-tip={t("docsInsert.cropImage")}
            onClick={() => imageViewAt(editor.view, hit.pos)?.startCrop()}
          >
            <CropIcon size={20} />
          </button>
          <DropButton label={t("docsInsert.borderColor")} face={<BorderColorIcon size={20} />}>
            {(close) => (
              <Swatches
                current={a.borderColor}
                onPick={(hex) => {
                  set({ borderColor: hex, borderWidth: a.borderWidth || 1 });
                  close();
                }}
                onNone={() => {
                  set({ borderColor: null, borderWidth: 0 });
                  close();
                }}
              />
            )}
          </DropButton>
          <DropButton label={t("docsInsert.borderWidth")} face={<BorderWeightIcon size={20} />}>
            {(close) =>
              BORDER_WEIGHTS.map((w) => (
                <MenuRow
                  key={w}
                  checked={a.borderWidth === w && (w > 0 || !a.borderColor)}
                  onSelect={() => {
                    set(w === 0 ? { borderWidth: 0 } : { borderWidth: w, borderColor: a.borderColor ?? "#000000" });
                    close();
                  }}
                >
                  <span className="docs-weight-row">
                    <span className="docs-weight-line" style={{ borderTopWidth: `${Math.max(w, 0.5)}pt`, opacity: w ? 1 : 0.3 }} />
                    {w} pt
                  </span>
                </MenuRow>
              ))
            }
          </DropButton>
          <DropButton label={t("docsInsert.borderDash")} face={<BorderDashIcon size={20} />}>
            {(close) =>
              DASHES.map(({ dash, label }) => (
                <MenuRow
                  key={dash}
                  checked={a.borderDash === dash}
                  onSelect={() => {
                    set({ borderDash: dash, borderColor: a.borderColor ?? "#000000", borderWidth: a.borderWidth || 1 });
                    close();
                  }}
                >
                  <span className="docs-weight-row">
                    <span className="docs-weight-line" style={{ borderTopStyle: dash, borderTopWidth: "2px" }} />
                    {t(label)}
                  </span>
                </MenuRow>
              ))
            }
          </DropButton>
          <DropButton label={t("docsInsert.replaceImage")} face={<ResetIcon size={20} />}>
            {(close) => (
              <>
                <MenuRow
                  onSelect={() => {
                    close();
                    fileRef.current?.click();
                  }}
                >
                  {t("docs.uploadFromComputer")}
                </MenuRow>
                <MenuRow
                  onSelect={() => {
                    close();
                    setByUrl(true);
                  }}
                >
                  {t("docs.imageByUrl")}
                </MenuRow>
              </>
            )}
          </DropButton>
          <button
            type="button"
            className="docs-tb-btn"
            aria-label={t("docsInsert.resetImage")}
            data-tip={t("docsInsert.resetImage")}
            onClick={() => void resetImage(editor, hit.pos)}
          >
            <RefreshIcon size={20} />
          </button>
          <span className="docs-tb-sep" aria-hidden />
          <DropButton label={t("docs.more")} face={<MoreVertIcon size={20} />}>
            {(close) => (
              <>
                <MenuRow
                  onSelect={() => {
                    close();
                    setPanel("size");
                  }}
                >
                  {t("docsInsert.sizeRotation")}
                </MenuRow>
                <MenuRow
                  onSelect={() => {
                    close();
                    setPanel("alt");
                  }}
                >
                  {t("docsInsert.altText")}
                </MenuRow>
                <MenuRow
                  onSelect={() => {
                    close();
                    setPanel("wrap");
                  }}
                >
                  {t("docsInsert.allImageOptions")}
                </MenuRow>
              </>
            )}
          </DropButton>
        </FloatingBox>
      )}
      {byUrl && anchor && (
        <FloatingBox anchor={{ ...anchor, top: anchor.bottom + 48, bottom: anchor.bottom + 48 }} className="docs-img-url" onDismiss={() => setByUrl(false)}>
          <form
            className="docs-image-url-form"
            onSubmit={(e) => {
              e.preventDefault();
              const value = url.trim();
              if (!/^https?:\/\/\S+$/i.test(value)) return;
              setByUrl(false);
              setUrl("");
              void replaceImage(editor, hit.pos, { url: value });
            }}
          >
            <label className="docs-field-label" htmlFor="docs-replace-url">
              {t("docs.imageByUrl")}
            </label>
            <input
              id="docs-replace-url"
              className="docs-field"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t("docsInsert.imageUrlPlaceholder")}
              autoFocus
            />
            <button type="submit" className="docs-button-primary" disabled={!/^https?:\/\/\S+$/i.test(url.trim())}>
              {t("docsInsert.replaceImage")}
            </button>
          </form>
        </FloatingBox>
      )}
      {panel && <ImageOptionsPanel editor={editor} ctx={ctx} section={panel} onClose={() => setPanel(null)} />}
    </>
  );
}

const PX_PER_IN = 96;

function inches(px: number): string {
  return (Math.round((px / PX_PER_IN) * 100) / 100).toString();
}

function ImageOptionsPanel({
  editor,
  ctx,
  section,
  onClose,
}: {
  editor: Editor;
  ctx: InsertContext;
  section: Section;
  onClose: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState<Record<Section, boolean>>({
    size: section === "size",
    wrap: section === "wrap",
    recolor: false,
    adjust: false,
    alt: section === "alt",
  });
  const [lock, setLock] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);
  const [lastSection, setLastSection] = useState(section);
  if (lastSection !== section) {
    setLastSection(section);
    setOpen((o) => ({ ...o, [section]: true }));
  }
  useEffect(() => {
    if (section === "alt") descRef.current?.focus();
  }, [section]);

  const hit = selectedImage(editor.state);
  if (!hit) return null;
  const a = imageAttrs(hit.node);
  const set = (attrs: Record<string, unknown>) => editor.chain().updateImage(attrs).run();
  const view = imageViewAt(editor.view, hit.pos);
  const drawn = view?.dom.querySelector<HTMLElement>(".docs-img-box");
  const w = a.width ?? drawn?.offsetWidth ?? 0;
  const h = a.height ?? drawn?.offsetHeight ?? 0;
  const natural = view?.dom.querySelector("img");
  const naturalW = natural?.naturalWidth || w;
  const naturalH = natural?.naturalHeight || h;
  const toggle = (s: Section) => setOpen((o) => ({ ...o, [s]: !o[s] }));
  const setSize = (nextW: number | null, nextH: number | null) => {
    const ratio = h > 0 ? w / h : 1;
    let width = nextW ?? w;
    let height = nextH ?? h;
    if (lock && nextW !== null) height = width / ratio;
    if (lock && nextH !== null) width = height * ratio;
    const max = a.wrap === "behind" || a.wrap === "front" ? 4000 : textWidthPx(editor);
    if (width > max) {
      height = lock ? max / ratio : height;
      width = max;
    }
    set({ width: Math.max(16, Math.round(width)), height: Math.max(16, Math.round(height)) });
  };
  const pageless = ctx.pageSetup.pageless;

  return (
    <SidePanel title={t("docsInsert.imageOptions")} icon={<ImageOptionsIcon size={20} />} onClose={onClose}>
      <PanelSection title={t("docsInsert.sizeRotation")} open={open.size} onToggle={() => toggle("size")}>
        <div className="docs-side-grid">
          <label>
            <span className="docs-side-label">{t("docsInsert.width")}</span>
            <input
              key={`w${w}`}
              className="docs-field"
              type="number"
              step="0.1"
              min="0.1"
              defaultValue={inches(w)}
              onBlur={(e) => setSize(Number(e.target.value) * PX_PER_IN, null)}
              onKeyDown={(e) => e.key === "Enter" && setSize(Number(e.currentTarget.value) * PX_PER_IN, null)}
            />
          </label>
          <label>
            <span className="docs-side-label">{t("docsInsert.height")}</span>
            <input
              key={`h${h}`}
              className="docs-field"
              type="number"
              step="0.1"
              min="0.1"
              defaultValue={inches(h)}
              onBlur={(e) => setSize(null, Number(e.target.value) * PX_PER_IN)}
              onKeyDown={(e) => e.key === "Enter" && setSize(null, Number(e.currentTarget.value) * PX_PER_IN)}
            />
          </label>
        </div>
        <label className="docs-side-check">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          {t("docsInsert.lockRatio")}
        </label>
        <div className="docs-side-grid">
          <label>
            <span className="docs-side-label">{t("docsInsert.scaleWidth")}</span>
            <input
              key={`sw${w}`}
              className="docs-field"
              type="number"
              min="1"
              defaultValue={naturalW ? Math.round((w / naturalW) * 100) : 100}
              onBlur={(e) => setSize((Number(e.target.value) / 100) * naturalW, null)}
              onKeyDown={(e) => e.key === "Enter" && setSize((Number(e.currentTarget.value) / 100) * naturalW, null)}
            />
          </label>
          <label>
            <span className="docs-side-label">{t("docsInsert.scaleHeight")}</span>
            <input
              key={`sh${h}`}
              className="docs-field"
              type="number"
              min="1"
              defaultValue={naturalH ? Math.round((h / naturalH) * 100) : 100}
              onBlur={(e) => setSize(null, (Number(e.target.value) / 100) * naturalH)}
              onKeyDown={(e) => e.key === "Enter" && setSize(null, (Number(e.currentTarget.value) / 100) * naturalH)}
            />
          </label>
        </div>
        <div className="docs-side-row">
          <label>
            <span className="docs-side-label">{t("docsInsert.angle")}</span>
            <input
              className="docs-field"
              type="number"
              step="1"
              value={a.rotation}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) set({ rotation: ((Math.round(v) % 360) + 360) % 360 });
              }}
            />
          </label>
          <button type="button" className="docs-text-btn" onClick={() => set({ rotation: (a.rotation + 90) % 360 })}>
            <RotateIcon size={18} />
            {t("docsInsert.rotate90")}
          </button>
        </div>
      </PanelSection>
      <PanelSection title={t("docsInsert.textWrapping")} open={open.wrap} onToggle={() => toggle("wrap")}>
        <div className="docs-wrap-modes">
          {MODES.map(({ wrap, label, Icon }) => (
            <button
              key={wrap}
              type="button"
              className="docs-wrap-mode"
              aria-pressed={(pageless ? "inline" : a.wrap) === wrap}
              disabled={pageless && wrap !== "inline"}
              data-tip={pageless && wrap !== "inline" ? t("docsInsert.pagelessInline") : undefined}
              onClick={() => set({ wrap })}
            >
              <Icon size={28} />
              <span>{t(label)}</span>
            </button>
          ))}
        </div>
        {!pageless && a.wrap === "wrap" && (
          <label className="docs-side-row">
            <span className="docs-side-label">{t("docsInsert.wrap")}</span>
            <select className="docs-select" value={a.wrapSide} onChange={(e) => set({ wrapSide: e.target.value as WrapSide })}>
              <option value="both">{t("docsInsert.bothSides")}</option>
              <option value="left">{t("docsInsert.leftOnly")}</option>
              <option value="right">{t("docsInsert.rightOnly")}</option>
            </select>
          </label>
        )}
        {!pageless && a.wrap !== "inline" && (
          <label className="docs-side-row">
            <span className="docs-side-label">{t("docsInsert.marginFromText")}</span>
            <input
              key={`m${a.wrapMargin}`}
              className="docs-field"
              type="number"
              min="0"
              max="72"
              defaultValue={a.wrapMargin}
              onBlur={(e) => set({ wrapMargin: Math.max(0, Math.min(72, Number(e.target.value) || 0)) })}
            />
          </label>
        )}
        {(pageless || a.wrap === "inline" || a.wrap === "break") && (
          <div className="docs-seg" role="group" aria-label={t("docsInsert.alignment")}>
            {(["left", "center", "right"] as const).map((align) => (
              <button key={align} type="button" aria-pressed={a.align === align} onClick={() => set({ align })}>
                {t(align === "left" ? "docsInsert.alignLeft" : align === "center" ? "docsInsert.alignCenter" : "docsInsert.alignRight")}
              </button>
            ))}
          </div>
        )}
      </PanelSection>
      <PanelSection title={t("docsInsert.recolor")} open={open.recolor} onToggle={() => toggle("recolor")}>
        <select className="docs-select" value={a.recolor} onChange={(e) => set({ recolor: e.target.value as Recolor })}>
          <option value="none">{t("docsInsert.noRecolor")}</option>
          <option value="grayscale">{t("docsInsert.grayscale")}</option>
          <option value="sepia">{t("docsInsert.sepia")}</option>
          <option value="negative">{t("docsInsert.negative")}</option>
        </select>
      </PanelSection>
      <PanelSection title={t("docsInsert.adjustments")} open={open.adjust} onToggle={() => toggle("adjust")}>
        {(
          [
            ["transparency", "docsInsert.transparency", 0, 100],
            ["brightness", "docsInsert.brightness", -100, 100],
            ["contrast", "docsInsert.contrast", -100, 100],
          ] as const
        ).map(([key, label, min, max]) => (
          <label key={key} className="docs-side-slider">
            <span className="docs-side-label">{t(label)}</span>
            <input
              className="docs-slider"
              type="range"
              min={min}
              max={max}
              value={a[key]}
              onChange={(e) => set({ [key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <button type="button" className="docs-button-outline docs-side-reset" onClick={() => set({ transparency: 0, brightness: 0, contrast: 0 })}>
          {t("docsInsert.reset")}
        </button>
      </PanelSection>
      <PanelSection title={t("docsInsert.altText")} open={open.alt} onToggle={() => toggle("alt")}>
        <label>
          <span className="docs-side-label">{t("docsInsert.description")}</span>
          <textarea
            ref={descRef}
            key={`alt${hit.pos}`}
            className="docs-field docs-side-textarea"
            defaultValue={a.alt}
            rows={3}
            onBlur={(e) => set({ alt: e.target.value || null })}
          />
        </label>
        {advanced ? (
          <label>
            <span className="docs-side-label">{t("docsInsert.altTitle")}</span>
            <input
              key={`title${hit.pos}`}
              className="docs-field"
              defaultValue={a.title}
              onBlur={(e) => set({ title: e.target.value || null })}
            />
          </label>
        ) : (
          <button type="button" className="docs-text-btn docs-side-advanced" onClick={() => setAdvanced(true)}>
            <AltTextIcon size={18} />
            {t("docsInsert.advancedOptions")}
          </button>
        )}
      </PanelSection>
    </SidePanel>
  );
}
