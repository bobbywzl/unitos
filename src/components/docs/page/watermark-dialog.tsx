"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { DOCS_FONTS } from "@/components/docs/fonts";
import { BoldIcon, ItalicIcon, UploadIcon } from "@/components/docs/icons";
import { DropdownPanel } from "@/components/docs/menu";
import { PALETTE, colorName } from "@/components/docs/palette";
import { pageFrame } from "@/components/docs/page/geometry";
import { usePageState, type PageStore } from "@/components/docs/page/store";
import { WatermarkMark, textWatermarkImage } from "@/components/docs/page/watermark";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { IMAGE_ACCEPT, uploadImage } from "@/lib/images";
import {
  DEFAULT_TEXT_WATERMARK,
  WATERMARK_SCALES,
  sameTextLook,
  type ImageWatermark,
  type TextWatermark,
  type Watermark,
} from "@/lib/docs/watermark";

// Insert > Watermark (SPEC.md §29), Google Docs' Watermark panel as a
// dialog: the Text tab (the words, their face, size, bold, italic, color,
// opacity, and Diagonal or Horizontal) and the Image tab (an image from the
// computer, its scale, and Faded), with the page in small beside them. OK
// puts the watermark on every page; Remove watermark takes it off. The words
// go up as an image too, for the Word download (lib/docs/export.ts).

/** The small page's width in px. */
const PREVIEW_WIDTH = 150;
/** The small page's lines of text: each line's width as a share of the text area. */
const PREVIEW_LINES = [1, 0.94, 0.98, 0.9, 0.6, 1, 0.96, 0.92, 0.99, 0.7, 1, 0.95, 0.9, 0.97, 0.5];

type ImageChoice = Omit<ImageWatermark, "src"> & { src: string | null };

export function WatermarkDialog({ store, onClose }: { store: PageStore; onClose: () => void }) {
  const t = useT();
  const setup = usePageState(store, (s) => s.setup);
  const current = setup.watermark ?? null;
  const [tab, setTab] = useState<"text" | "image">(current?.kind ?? "text");
  const [text, setText] = useState<TextWatermark>(current?.kind === "text" ? current : DEFAULT_TEXT_WATERMARK);
  const [size, setSize] = useState(String(text.size));
  const [image, setImage] = useState<ImageChoice>(current?.kind === "image" ? current : { kind: "image", src: null, scale: null, faded: true });
  const [busy, setBusy] = useState<"upload" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const typedSize = Number(size.replace(",", "."));
  const shownText: TextWatermark = { ...text, size: Number.isFinite(typedSize) && typedSize >= 8 && typedSize <= 400 ? typedSize : text.size };
  const shown: Watermark | null =
    tab === "text" ? (shownText.text.trim() ? shownText : null) : image.src ? { ...image, src: image.src } : null;
  const edit = (patch: Partial<TextWatermark>) => setText((w) => ({ ...w, ...patch }));

  const save = (mark: Watermark | null) => {
    void store.saveSetup({ ...store.get().setup, watermark: mark });
    onClose();
  };

  async function apply() {
    if (!shown || busy) return;
    if (shown.kind === "image") return save(shown);
    const mark: TextWatermark = { ...shown, text: shown.text.trim() };
    // The same words drawn the same way keep their image; else the dialog draws a new one.
    if (current?.kind === "text" && current.image && sameTextLook(current, mark)) return save({ ...mark, image: current.image });
    setBusy("save");
    setError(null);
    try {
      const drawn = await textWatermarkImage(mark);
      const stored = drawn ? await uploadImage(drawn.file) : null;
      const round = (n: number) => Math.round(n * 100) / 100;
      save({ ...mark, image: drawn && stored ? { src: stored.url, width: round(drawn.width), height: round(drawn.height) } : null });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("common.requestFailed"));
      setBusy(null);
    }
  }

  async function choose(file: File | undefined) {
    if (!file || busy) return;
    setBusy("upload");
    setError(null);
    try {
      const { url } = await uploadImage(file);
      setImage((w) => ({ ...w, src: url }));
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("common.requestFailed"));
    }
    setBusy(null);
  }

  // The small page: the page's own shape and margins, a few lines of text, and the watermark.
  const frame = pageFrame(setup);
  const k = PREVIEW_WIDTH / frame.width;
  // A white page is Unitos's paper on screen, as the page draws it.
  const white = setup.color.toLowerCase() === "#ffffff";
  const lineGap = 22;
  const lines = PREVIEW_LINES.slice(0, Math.max(0, Math.floor((frame.height - frame.top - frame.bottom) / lineGap)));

  return (
    <ToolbarDialog
      title={t("docsPage.watermark")}
      onClose={onClose}
      className="docs-wm-dialog"
      closeButton={false}
      actions={
        <>
          {current && (
            <span className="docs-setup-default">
              <button type="button" className="docs-tb-button" data-track="docs:watermark:remove" disabled={busy !== null} onClick={() => save(null)}>
                {t("docsPage.removeWatermark")}
              </button>
            </span>
          )}
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <button
            type="button"
            className="docs-tb-button docs-tb-button-primary"
            data-track="docs:watermark:ok"
            disabled={!shown || busy !== null}
            onClick={() => void apply()}
          >
            {t("docs.ok")}
          </button>
        </>
      }
    >
      <div role="tablist" className="docs-setup-tabs">
        {(["text", "image"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className="docs-setup-tab"
            data-track={`docs:watermark:tab-${id}`}
            onClick={() => {
              setTab(id);
              setError(null);
            }}
          >
            {t(id === "text" ? "docsPage.watermarkText" : "docsPage.watermarkImage")}
          </button>
        ))}
      </div>
      <div className="docs-wm-body">
        <div
          className="docs-wm-preview"
          role="img"
          aria-label={t("docsPage.watermarkPreview")}
          style={{ width: frame.width * k, height: frame.height * k, background: white ? "var(--docs-page)" : setup.color }}
        >
          <div className="docs-wm-page" style={{ width: frame.width, height: frame.height, transform: `scale(${k})` }}>
            <div className="docs-wm-lines" style={{ top: frame.top, left: frame.left, right: frame.right }}>
              {lines.map((share, i) => (
                <span key={i} style={{ width: `${share * 100}%` }} />
              ))}
            </div>
            {shown && <WatermarkMark mark={shown} frame={frame} />}
          </div>
        </div>
        <div
          className="docs-setup-body docs-wm-fields"
          role="tabpanel"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target instanceof HTMLInputElement && e.target.type !== "checkbox" && e.target.type !== "radio") {
              e.preventDefault();
              void apply();
            }
          }}
        >
          {tab === "text" ? (
            <>
              <input
                className="docs-field"
                value={text.text}
                maxLength={200}
                placeholder={t("docsPage.enterText")}
                aria-label={t("docsPage.watermarkText")}
                data-track="docs:watermark:text"
                onChange={(e) => edit({ text: e.target.value })}
              />
              <div className="docs-wm-row">
                <label className="docs-setup-margin docs-setup-grow">
                  <span>{t("docs.font")}</span>
                  <select className="docs-field" value={text.font} data-track="docs:watermark:font" onChange={(e) => edit({ font: e.target.value })}>
                    {[...new Set([...DOCS_FONTS.map((f) => f.name), text.font])].map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="docs-setup-margin">
                  <span>{t("docs.fontSize")}</span>
                  <input
                    className="docs-field docs-wm-size"
                    type="number"
                    min={8}
                    max={400}
                    value={size}
                    data-track="docs:watermark:size"
                    onChange={(e) => setSize(e.target.value.slice(0, 5))}
                    onBlur={() => {
                      edit({ size: shownText.size });
                      setSize(String(shownText.size));
                    }}
                  />
                </label>
              </div>
              <div className="docs-wm-row">
                {(
                  [
                    ["bold", BoldIcon, "docs.bold"],
                    ["italic", ItalicIcon, "docs.italic"],
                  ] as const
                ).map(([key, Icon, label]) => (
                  <button
                    key={key}
                    type="button"
                    className="docs-wm-toggle"
                    aria-pressed={text[key]}
                    aria-label={t(label)}
                    data-tip={t(label)}
                    data-track={`docs:watermark:${key}`}
                    onClick={() => edit(key === "bold" ? { bold: !text.bold } : { italic: !text.italic })}
                  >
                    <Icon size={20} />
                  </button>
                ))}
                <button
                  ref={colorRef}
                  type="button"
                  className="docs-setup-color"
                  aria-label={t("docs.textColor")}
                  data-tip={t("docs.textColor")}
                  aria-haspopup="menu"
                  aria-expanded={colorOpen}
                  data-track="docs:watermark:color"
                  onClick={() => setColorOpen((o) => !o)}
                >
                  <span className="docs-setup-swatch" style={{ background: text.color }} />
                </button>
              </div>
              <label className="docs-setup-margin">
                <span>{t("docsPage.opacity")}</span>
                <span className="docs-wm-range">
                  <input
                    type="range"
                    min={5}
                    max={100}
                    step={5}
                    value={Math.round(text.opacity * 100)}
                    data-track="docs:watermark:opacity"
                    onChange={(e) => edit({ opacity: Number(e.target.value) / 100 })}
                  />
                  <output>{`${Math.round(text.opacity * 100)}%`}</output>
                </span>
              </label>
              <fieldset className="docs-setup-group">
                <legend className="docs-setup-label">{t("docsPage.layout")}</legend>
                <div className="docs-setup-radios">
                  {([true, false] as const).map((diagonal) => (
                    <label key={String(diagonal)} className="docs-setup-radio">
                      <input
                        type="radio"
                        name="docs-watermark-layout"
                        checked={text.diagonal === diagonal}
                        data-track={`docs:watermark:${diagonal ? "diagonal" : "horizontal"}`}
                        onChange={() => edit({ diagonal })}
                      />
                      {t(diagonal ? "docsPage.diagonal" : "docsPage.horizontal")}
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : (
            <>
              <button
                type="button"
                className="docs-tb-button docs-wm-upload"
                data-autofocus
                disabled={busy !== null}
                onClick={() => fileRef.current?.click()}
              >
                <UploadIcon size={18} />
                {busy === "upload" ? t("docsPage.uploading") : t("docs.uploadFromComputer")}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept={IMAGE_ACCEPT}
                hidden
                data-track="docs:watermark:file"
                onChange={(e) => {
                  void choose(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <label className="docs-setup-margin">
                <span>{t("docsPage.scale")}</span>
                <select
                  className="docs-field"
                  value={image.scale === null ? "auto" : String(image.scale)}
                  data-track="docs:watermark:scale"
                  onChange={(e) => setImage((w) => ({ ...w, scale: e.target.value === "auto" ? null : Number(e.target.value) }))}
                >
                  <option value="auto">{t("docsPage.scaleAuto")}</option>
                  {WATERMARK_SCALES.map((s) => (
                    <option key={s} value={String(s)}>{`${s * 100}%`}</option>
                  ))}
                </select>
              </label>
              <label className="docs-setup-radio">
                <input
                  type="checkbox"
                  checked={image.faded}
                  data-track="docs:watermark:faded"
                  onChange={(e) => setImage((w) => ({ ...w, faded: e.target.checked }))}
                />
                {t("docsPage.faded")}
              </label>
            </>
          )}
          {error && (
            <p className="docs-setup-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
      <DropdownPanel
        open={colorOpen}
        anchorRef={colorRef}
        onClose={() => setColorOpen(false)}
        className="docs-setup-colors"
        label={t("docs.textColor")}
      >
        <div className="docs-page-colors">
          {PALETTE.flat().map((hex) => (
            <button
              key={hex}
              type="button"
              className="docs-page-color"
              style={{ background: hex }}
              aria-label={colorName(t, hex)}
              data-tip={colorName(t, hex)}
              aria-pressed={text.color.toLowerCase() === hex}
              onClick={() => {
                edit({ color: hex });
                setColorOpen(false);
              }}
            />
          ))}
        </div>
      </DropdownPanel>
    </ToolbarDialog>
  );
}
