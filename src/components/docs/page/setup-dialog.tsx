"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLang, useT } from "@/components/lang-provider";
import { DropdownPanel } from "@/components/docs/menu";
import { PALETTE, colorName } from "@/components/docs/palette";
import { MIN_TEXT_PT, PAPERS, formatLength, paperOf, parseLength, type LengthUnit } from "@/components/docs/page/geometry";
import { readPref, usePageState, writePref, type PageStore } from "@/components/docs/page/store";
import { pageSetupSchema, type PageSetup } from "@/lib/docs/schema";

// Page setup (SPEC.md §29), Google Docs' dialog: two tabs, Pages and
// Pageless. Pages: the orientation, the paper size and the page color side
// by side, and the margins in inches (centimeters in Chinese). Pageless: what
// the format does and the background color. Set as default keeps the Pages
// settings in this browser for the next new document; OK applies the tab's
// format and the settings.

const DEFAULT_KEY = "unitos-docs-page-default";

type Defaults = Pick<PageSetup, "width" | "height" | "margins" | "color">;

const defaultsSchema = pageSetupSchema.pick({ width: true, height: true, margins: true, color: true });

/** The Pages settings kept as this browser's default, if any. */
export function readPageDefault(): Defaults | null {
  try {
    const parsed = defaultsSchema.safeParse(JSON.parse(readPref(DEFAULT_KEY) ?? ""));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

type Side = "top" | "bottom" | "left" | "right";
const SIDES: Side[] = ["top", "bottom", "left", "right"];

export function lengthUnitFor(lang: string): LengthUnit {
  return lang === "zh" ? "cm" : "in";
}

export function PageSetupDialog({ store, onClose }: { store: PageStore; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const unit = lengthUnitFor(lang);
  const setup = usePageState(store, (s) => s.setup);
  const [tab, setTab] = useState<"pages" | "pageless">(setup.pageless ? "pageless" : "pages");
  const [landscape, setLandscape] = useState(setup.width > setup.height);
  const [paper, setPaper] = useState(paperOf(setup)?.id ?? "custom");
  const [color, setColor] = useState(setup.color);
  const [margins, setMargins] = useState<Record<Side, string>>(() => ({
    top: formatLength(setup.margins.top, unit),
    bottom: formatLength(setup.margins.bottom, unit),
    left: formatLength(setup.margins.left, unit),
    right: formatLength(setup.margins.right, unit),
  }));
  const [error, setError] = useState<string | null>(null);
  const [savedDefault, setSavedDefault] = useState<Defaults | null>(() => readPageDefault());
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // The dialog takes the focus, so Escape and Enter reach it; a tab key
  // then moves through its controls.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  /** The dialog's Pages settings, or null when a margin is not a number or
      the margins leave no room for text. */
  const read = (): Defaults | null => {
    const size = PAPERS.find((p) => p.id === paper);
    const short = size ? size.width : Math.min(setup.width, setup.height);
    const long = size ? size.height : Math.max(setup.width, setup.height);
    const width = landscape ? long : short;
    const height = landscape ? short : long;
    const pt: Partial<Record<Side, number>> = {};
    for (const side of SIDES) {
      const v = parseLength(margins[side], unit);
      if (v === null) return null;
      pt[side] = v;
    }
    const m = { top: pt.top ?? 0, right: pt.right ?? 0, bottom: pt.bottom ?? 0, left: pt.left ?? 0 };
    if (m.top + m.bottom > height - MIN_TEXT_PT || m.left + m.right > width - MIN_TEXT_PT) return null;
    if (Object.values(m).some((v) => v > 700)) return null;
    return { width, height, margins: m, color };
  };

  const current = read();
  const isDefault =
    current !== null &&
    savedDefault !== null &&
    JSON.stringify({ ...current, color: current.color.toLowerCase() }) ===
      JSON.stringify({ ...savedDefault, color: savedDefault.color.toLowerCase() });

  const apply = () => {
    const pages = read();
    if (!pages) {
      setError(t("docsPage.marginsTooLarge"));
      return;
    }
    const next: PageSetup = { ...setup, ...pages, pageless: tab === "pageless" };
    if (JSON.stringify(next) !== JSON.stringify(setup)) void store.saveSetup(next);
    onClose();
  };

  const makeDefault = () => {
    const pages = read();
    if (!pages) {
      setError(t("docsPage.marginsTooLarge"));
      return;
    }
    writePref(DEFAULT_KEY, JSON.stringify(pages));
    setSavedDefault(pages);
  };

  const colorButton = (label: string) => (
    <div className="docs-setup-group">
      <span className="docs-setup-label">{label}</span>
      <button
        ref={colorRef}
        type="button"
        className="docs-setup-color"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={colorOpen}
        onClick={() => setColorOpen((o) => !o)}
      >
        <span className="docs-setup-swatch" style={{ background: color }} />
      </button>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="docs-dialog-backdrop"
      data-edit-control
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !colorOpen) {
          e.stopPropagation();
          onClose();
        }
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
          apply();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("docsPage.pageSetup")}
        className="docs-setup-dialog"
        tabIndex={-1}
      >
        <h2 className="docs-setup-title">{t("docsPage.pageSetup")}</h2>
        <div role="tablist" className="docs-setup-tabs">
          {(["pages", "pageless"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="docs-setup-tab"
              onClick={() => setTab(id)}
            >
              {t(id === "pages" ? "docsPage.pagesTab" : "docsPage.pagelessTab")}
            </button>
          ))}
        </div>
        {tab === "pages" ? (
          <div className="docs-setup-body" role="tabpanel">
            <fieldset className="docs-setup-group">
              <legend className="docs-setup-label">{t("docsPage.orientation")}</legend>
              <div className="docs-setup-radios">
                {([false, true] as const).map((value) => (
                  <label key={String(value)} className="docs-setup-radio">
                    <input type="radio" name="docs-orientation" checked={landscape === value} onChange={() => setLandscape(value)} />
                    {t(value ? "docsPage.landscape" : "docsPage.portrait")}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="docs-setup-row">
              <label className="docs-setup-group docs-setup-grow">
                <span className="docs-setup-label">{t("docsPage.paperSize")}</span>
                <select className="docs-setup-select" value={paper} onChange={(e) => setPaper(e.target.value)}>
                  {PAPERS.map((p) => (
                    <option key={p.id} value={p.id}>
                      {`${p.name} (${unit === "in" ? p.inches : p.cm})`}
                    </option>
                  ))}
                  {paper === "custom" && <option value="custom">{t("docsPage.customSize")}</option>}
                </select>
              </label>
              {colorButton(t("docsPage.pageColor"))}
            </div>
            <fieldset className="docs-setup-group">
              <legend className="docs-setup-label">
                {t(unit === "in" ? "docsPage.marginsInches" : "docsPage.marginsCentimeters")}
              </legend>
              <div className="docs-setup-margins">
                {SIDES.map((side) => (
                  <label key={side} className="docs-setup-margin">
                    <span>{t(`docsPage.${side}`)}</span>
                    <input
                      className="docs-setup-input"
                      inputMode="decimal"
                      value={margins[side]}
                      onChange={(e) => {
                        setError(null);
                        setMargins((m) => ({ ...m, [side]: e.target.value.slice(0, 8) }));
                      }}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            {error && (
              <p className="docs-setup-error" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <div className="docs-setup-body" role="tabpanel">
            <div className="docs-setup-pageless-art" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <p className="docs-setup-about">{t("docsPage.pagelessAbout")}</p>
            {(setup.header || setup.footer) && <p className="docs-setup-note">{t("docsPage.pagelessHides")}</p>}
            {colorButton(t("docsPage.backgroundColor"))}
          </div>
        )}
        <DropdownPanel open={colorOpen} anchorRef={colorRef} onClose={() => setColorOpen(false)} label={t("docsPage.pageColor")}>
          <div className="docs-page-colors">
            {PALETTE.flat().map((hex) => (
              <button
                key={hex}
                type="button"
                className="docs-page-color"
                style={{ background: hex }}
                aria-label={colorName(t, hex)}
                data-tip={colorName(t, hex)}
                aria-pressed={color.toLowerCase() === hex}
                onClick={() => {
                  setColor(hex);
                  setColorOpen(false);
                }}
              />
            ))}
          </div>
        </DropdownPanel>
        <div className="docs-setup-actions">
          {tab === "pages" && (
            <button type="button" className="docs-setup-text-btn" disabled={isDefault} onClick={makeDefault}>
              {t(isDefault ? "docsPage.savedAsDefault" : "docsPage.setAsDefault")}
            </button>
          )}
          <span className="docs-setup-spacer" />
          <button type="button" className="docs-setup-text-btn" onClick={onClose}>
            {t("docsPage.cancel")}
          </button>
          <button type="button" className="docs-button-primary" onClick={apply}>
            {t("docsPage.ok")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
