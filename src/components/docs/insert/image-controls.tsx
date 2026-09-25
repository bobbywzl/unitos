"use client";

import type { Editor } from "@tiptap/core";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useT } from "@/components/lang-provider";
import { MoreVertIcon } from "@/components/docs/icons";
import { MenuItem } from "@/components/docs/menu";
import { PX_PER_PT } from "@/components/docs/page/geometry";
import { DropBtn, Sep } from "@/components/docs/toolbar/controls";
import { BorderButtons } from "@/components/docs/insert/colors";
import { onInsert, type InsertContext } from "@/components/docs/insert/context";
import {
  AltTextIcon,
  BehindTextIcon,
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
  setImageAttrs,
  textWidthPx,
  type Recolor,
  type Wrap,
  type WrapSide,
} from "@/components/docs/insert/image";
import { ImageSourcePicker } from "@/components/docs/insert/image-source";
import { FloatingBox, LengthField, PanelSection, Seg, SidePanel, useEditorTick, useViewportTick } from "@/components/docs/insert/ui";
import type { TKey } from "@/lib/i18n/dictionaries";

// The image's controls (SPEC.md §29), Google Docs' way: under a selected
// image a floating toolbar (the five layouts, the margin from the text,
// Crop, the border buttons, Replace image, Reset image, More), and the Image
// options panel.

const MODES: [Wrap, TKey, (p: { size?: number }) => ReactNode][] = [
  ["inline", "docsInsert.inLine", InLineIcon],
  ["wrap", "docsInsert.wrapText", WrapTextIcon],
  ["break", "docsInsert.breakText", BreakTextIcon],
  ["behind", "docsInsert.behindText", BehindTextIcon],
  ["front", "docsInsert.inFrontOfText", InFrontIcon],
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

type Section = "size" | "wrap" | "alt";

export function ImageControlsHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  const t = useT();
  useEditorTick(editor);
  const hit = selectedImage(editor.state);
  useViewportTick(hit !== null);
  const [panel, setPanel] = useState<Section | null>(null);
  const [replacing, setReplacing] = useState(false);
  const hitPos = hit?.pos ?? null;

  useEffect(
    () =>
      onInsert(editor, (event) => {
        if (event.type === "image-options") setPanel(event.section ?? "size");
        if (event.type === "image-replace") setReplacing(true);
      }),
    [editor],
  );

  // The panel belongs to the selected image; it closes with the selection.
  const [lastPos, setLastPos] = useState(hitPos);
  if (lastPos !== hitPos) {
    setLastPos(hitPos);
    if (hitPos === null) {
      setPanel(null);
      setReplacing(false);
    }
  }

  if (!hit || !ctx.editing) return null;
  const figure = editor.view.nodeDOM(hit.pos);
  const box = figure instanceof HTMLElement ? figure.querySelector(".docs-img-box")?.getBoundingClientRect() : null;
  const anchor = box ? { left: box.left, top: box.top, bottom: box.bottom } : null;
  const a = imageAttrs(hit.node);
  const pageless = ctx.pageSetup.pageless;
  const set = (attrs: Record<string, unknown>) => setImageAttrs(editor.view, hit.pos, attrs);
  const button = (label: TKey, icon: ReactNode, onClick: () => void) => (
    <button type="button" className="docs-tb-btn" aria-label={t(label)} data-tip={t(label)} onClick={onClick}>
      {icon}
    </button>
  );

  return (
    <>
      {anchor && (
        <FloatingBox anchor={anchor} gap={12} className="docs-img-toolbar" role="toolbar" label={t("docsInsert.imageOptions")}>
          {MODES.map(([wrap, label, Icon]) => (
            <button
              key={wrap}
              type="button"
              className="docs-tb-btn"
              aria-pressed={(pageless ? "inline" : a.wrap) === wrap}
              aria-label={t(label)}
              data-tip={pageless && wrap !== "inline" ? t("docsInsert.pagelessInline") : t(label)}
              disabled={pageless && wrap !== "inline"}
              onClick={() => set({ wrap })}
            >
              <Icon />
            </button>
          ))}
          {!pageless && (a.wrap === "wrap" || a.wrap === "break") && (
            <DropBtn
              label={t("docsInsert.margin")}
              track="image-margin"
              className="docs-tb-select"
              face={<span className="docs-tb-caption">{MARGINS.find(([pt]) => pt === a.wrapMargin)?.[1] ?? `${a.wrapMargin}pt`}</span>}
            >
              {(close) =>
                MARGINS.map(([pt, name]) => (
                  <MenuItem
                    key={pt}
                    checked={a.wrapMargin === pt}
                    onSelect={() => {
                      close();
                      set({ wrapMargin: pt });
                    }}
                  >
                    {name}
                  </MenuItem>
                ))
              }
            </DropBtn>
          )}
          <Sep />
          {button("docsInsert.cropImage", <CropIcon />, () => imageViewAt(editor.view, hit.pos)?.startCrop())}
          <BorderButtons
            track="image"
            widthLabel="docsInsert.borderWeight"
            border={{ color: a.borderColor, width: a.borderColor ? a.borderWidth : 0, dash: a.borderDash }}
            onChange={(spec) =>
              set(
                spec.width === 0
                  ? { borderWidth: 0 }
                  : {
                      borderColor: spec.color ?? a.borderColor ?? "#000000",
                      borderWidth: spec.width ?? (a.borderWidth || 1),
                      borderDash: spec.dash ?? a.borderDash,
                    },
              )
            }
            onNone={() => set({ borderColor: null, borderWidth: 0 })}
          />
          {button("docsInsert.replaceImage", <ResetIcon />, () => setReplacing((r) => !r))}
          {button("docsInsert.resetImage", <RefreshIcon />, () => resetImage(editor, hit.pos))}
          <Sep />
          <DropBtn label={t("docs.more")} track="image-more" arrow={false} face={<MoreVertIcon />}>
            {(close) =>
              (
                [
                  ["size", "docsInsert.sizeRotation"],
                  ["alt", "docsInsert.altText"],
                  ["wrap", "docsInsert.allImageOptions"],
                ] as const
              ).map(([section, label]) => (
                <MenuItem
                  key={section}
                  onSelect={() => {
                    close();
                    setPanel(section);
                  }}
                >
                  {t(label)}
                </MenuItem>
              ))
            }
          </DropBtn>
        </FloatingBox>
      )}
      {replacing && anchor && (
        <FloatingBox anchor={{ ...anchor, bottom: anchor.bottom + 48 }} className="docs-picker" onDismiss={() => setReplacing(false)}>
          <ImageSourcePicker
            onPick={(source) => {
              setReplacing(false);
              void replaceImage(editor, hit.pos, source);
            }}
          />
        </FloatingBox>
      )}
      {panel && (
        <ImageOptionsPanel
          key={`${panel}:${hit.pos}`}
          editor={editor}
          ctx={ctx}
          section={panel}
          onClose={() => {
            // The page takes the keys again, the image still selected.
            setPanel(null);
            editor.view.focus();
          }}
        />
      )}
    </>
  );
}

/** A number applied on Enter or blur. */
function ScaleField({ label, value, onApply }: { label: string; value: number; onApply: (n: number) => void }) {
  const apply = (input: HTMLInputElement) => {
    const n = Number(input.value);
    if (Number.isFinite(n) && n > 0) onApply(n);
    else input.value = String(value);
  };
  return (
    <label className="docs-side-field">
      <span className="docs-side-label">{label}</span>
      <input
        key={value}
        className="docs-field"
        inputMode="decimal"
        defaultValue={value}
        onBlur={(e) => apply(e.currentTarget)}
        onKeyDown={(e) => e.key === "Enter" && apply(e.currentTarget)}
      />
    </label>
  );
}

function ImageOptionsPanel({ editor, ctx, section, onClose }: { editor: Editor; ctx: InsertContext; section: Section; onClose: () => void }) {
  const t = useT();
  const [lock, setLock] = useState(true);
  const [advanced, setAdvanced] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (section === "alt") descRef.current?.focus();
  }, [section]);

  const hit = selectedImage(editor.state);
  if (!hit) return null;
  const a = imageAttrs(hit.node);
  const set = (attrs: Record<string, unknown>) => setImageAttrs(editor.view, hit.pos, attrs);
  const view = imageViewAt(editor.view, hit.pos);
  const w = a.width ?? view?.dom.querySelector<HTMLElement>(".docs-img-box")?.offsetWidth ?? 0;
  const h = a.height ?? view?.dom.querySelector<HTMLElement>(".docs-img-box")?.offsetHeight ?? 0;
  const natural = view?.dom.querySelector("img");
  const naturalW = natural?.naturalWidth || w;
  const naturalH = natural?.naturalHeight || h;
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
    <SidePanel title={t("docsInsert.imageOptions")} icon={<ImageOptionsIcon />} onClose={onClose}>
      <PanelSection title={t("docsInsert.sizeRotation")} open={section === "size"}>
        <div className="docs-side-grid">
          <LengthField label={t("docsInsert.width")} pt={w / PX_PER_PT} onChange={(pt) => setSize(pt * PX_PER_PT, null)} />
          <LengthField label={t("docsInsert.height")} pt={h / PX_PER_PT} onChange={(pt) => setSize(null, pt * PX_PER_PT)} />
        </div>
        <label className="docs-side-check">
          <input type="checkbox" checked={lock} onChange={(e) => setLock(e.target.checked)} />
          {t("docsInsert.lockRatio")}
        </label>
        <div className="docs-side-grid">
          <ScaleField label={t("docsInsert.scaleWidth")} value={naturalW ? Math.round((w / naturalW) * 100) : 100} onApply={(n) => setSize((n / 100) * naturalW, null)} />
          <ScaleField label={t("docsInsert.scaleHeight")} value={naturalH ? Math.round((h / naturalH) * 100) : 100} onApply={(n) => setSize(null, (n / 100) * naturalH)} />
        </div>
        <div className="docs-side-row">
          <label className="docs-side-field">
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
      <PanelSection title={t("docsInsert.textWrapping")} open={section === "wrap"}>
        <div className="docs-wrap-modes">
          {MODES.map(([wrap, label, Icon]) => (
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
          <label className="docs-side-field">
            <span className="docs-side-label">{t("docsInsert.wrap")}</span>
            <select className="docs-field" value={a.wrapSide} onChange={(e) => set({ wrapSide: e.target.value as WrapSide })}>
              <option value="both">{t("docsInsert.bothSides")}</option>
              <option value="left">{t("docsInsert.leftOnly")}</option>
              <option value="right">{t("docsInsert.rightOnly")}</option>
            </select>
          </label>
        )}
        {!pageless && a.wrap !== "inline" && (
          <LengthField label={t("docsInsert.marginFromText")} pt={a.wrapMargin} onChange={(pt) => set({ wrapMargin: Math.min(72, pt) })} />
        )}
        {(pageless || a.wrap === "inline" || a.wrap === "break") && (
          <Seg
            label={t("docsInsert.alignment")}
            value={a.align}
            options={[
              ["left", t("docsInsert.alignLeft")],
              ["center", t("docsInsert.alignCenter")],
              ["right", t("docsInsert.alignRight")],
            ]}
            onChange={(align) => set({ align })}
          />
        )}
      </PanelSection>
      <PanelSection title={t("docsInsert.recolor")} open={false}>
        <select className="docs-field" value={a.recolor} onChange={(e) => set({ recolor: e.target.value as Recolor })}>
          <option value="none">{t("docsInsert.noRecolor")}</option>
          <option value="grayscale">{t("docsInsert.grayscale")}</option>
          <option value="sepia">{t("docsInsert.sepia")}</option>
          <option value="negative">{t("docsInsert.negative")}</option>
        </select>
      </PanelSection>
      <PanelSection title={t("docsInsert.adjustments")} open={false}>
        {(
          [
            ["transparency", "docsInsert.transparency", 0],
            ["brightness", "docsInsert.brightness", -100],
            ["contrast", "docsInsert.contrast", -100],
          ] as const
        ).map(([key, label, min]) => (
          <label key={key} className="docs-side-field">
            <span className="docs-side-label">{t(label)}</span>
            <input className="docs-slider" type="range" min={min} max={100} value={a[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} />
          </label>
        ))}
        <button type="button" className="docs-tb-button" onClick={() => set({ transparency: 0, brightness: 0, contrast: 0 })}>
          {t("docsInsert.reset")}
        </button>
      </PanelSection>
      <PanelSection title={t("docsInsert.altText")} open={section === "alt"}>
        <label className="docs-side-field">
          <span className="docs-side-label">{t("docsInsert.description")}</span>
          <textarea ref={descRef} className="docs-field" defaultValue={a.alt} rows={3} onBlur={(e) => set({ alt: e.target.value || null })} />
        </label>
        {advanced ? (
          <label className="docs-side-field">
            <span className="docs-side-label">{t("docsInsert.altTitle")}</span>
            <input className="docs-field" defaultValue={a.title} onBlur={(e) => set({ title: e.target.value || null })} />
          </label>
        ) : (
          <button type="button" className="docs-text-btn" onClick={() => setAdvanced(true)}>
            <AltTextIcon size={18} />
            {t("docsInsert.advancedOptions")}
          </button>
        )}
      </PanelSection>
    </SidePanel>
  );
}
