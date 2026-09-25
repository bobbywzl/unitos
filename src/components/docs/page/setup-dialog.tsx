"use client";

import { useRef, useState } from "react";
import { useLang, useT } from "@/components/lang-provider";
import { DropdownPanel } from "@/components/docs/menu";
import { PALETTE, colorName } from "@/components/docs/palette";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { MIN_TEXT_PT, PAPERS, formatLength, lengthUnitFor, paperOf, parseLength } from "@/components/docs/page/geometry";
import { readPref, usePageState, writePref, type PageStore } from "@/components/docs/page/store";
import { pageSetupSchema, type PageSetup } from "@/lib/docs/schema";

// Page setup (SPEC.md §29), Google Docs' dialog: the Pages tab (the
// orientation, the paper size and the page color, the margins) and the
// Pageless tab (what the format does, the background color). OK applies the
// tab's format and the settings; Set as default keeps the Pages settings in
// this browser for the next new document.

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

const SIDES = ["top", "bottom", "left", "right"] as const;
type Side = (typeof SIDES)[number];

export function PageSetupDialog({ store, onClose }: { store: PageStore; onClose: () => void }) {
  const t = useT();
  const unit = lengthUnitFor(useLang());
  const setup = usePageState(store, (s) => s.setup);
  const [tab, setTab] = useState<"pages" | "pageless">(setup.pageless ? "pageless" : "pages");
  const [landscape, setLandscape] = useState(setup.width > setup.height);
  const [paper, setPaper] = useState(paperOf(setup)?.id ?? "custom");
  const [color, setColor] = useState(setup.color);
  const [margins, setMargins] = useState(() =>
    Object.fromEntries(SIDES.map((side) => [side, formatLength(setup.margins[side], unit)])) as Record<Side, string>,
  );
  const [error, setError] = useState(false);
  const [savedDefault, setSavedDefault] = useState(readPageDefault);
  const [colorOpen, setColorOpen] = useState(false);
  const colorRef = useRef<HTMLButtonElement>(null);

  /** The Pages settings, or null when a margin is not a number or the
      margins leave no room for text. */
  const read = (): Defaults | null => {
    const size = PAPERS.find((p) => p.id === paper);
    const short = size ? size.width : Math.min(setup.width, setup.height);
    const long = size ? size.height : Math.max(setup.width, setup.height);
    const width = landscape ? long : short;
    const height = landscape ? short : long;
    const m = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const side of SIDES) {
      const v = parseLength(margins[side], unit);
      if (v === null || v > 700) return null;
      m[side] = v;
    }
    if (m.top + m.bottom > height - MIN_TEXT_PT || m.left + m.right > width - MIN_TEXT_PT) return null;
    return { width, height, margins: m, color };
  };

  const current = read();
  const same = (a: Defaults, b: Defaults) =>
    JSON.stringify({ ...a, color: a.color.toLowerCase() }) === JSON.stringify({ ...b, color: b.color.toLowerCase() });
  const isDefault = current !== null && savedDefault !== null && same(current, savedDefault);

  const apply = () => {
    if (!current) return setError(true);
    const next: PageSetup = { ...setup, ...current, pageless: tab === "pageless" };
    if (JSON.stringify(next) !== JSON.stringify(setup)) void store.saveSetup(next);
    onClose();
  };

  const makeDefault = () => {
    if (!current) return setError(true);
    writePref(DEFAULT_KEY, JSON.stringify(current));
    setSavedDefault(current);
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

  return (
    <ToolbarDialog
      title={t("docsPage.pageSetup")}
      onClose={onClose}
      className="docs-setup"
      closeButton={false}
      actions={
        <>
          {tab === "pages" && (
            <span className="docs-setup-default">
              <DialogButton disabled={isDefault} onClick={makeDefault}>
                {t(isDefault ? "docsPage.savedAsDefault" : "docsPage.setAsDefault")}
              </DialogButton>
            </span>
          )}
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <DialogButton primary onClick={apply}>
            {t("docs.ok")}
          </DialogButton>
        </>
      }
    >
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
      <div
        className="docs-setup-body"
        role="tabpanel"
        onKeyDown={(e) => {
          if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
            e.preventDefault();
            apply();
          }
        }}
      >
        {tab === "pages" ? (
          <>
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
                <select className="docs-field" value={paper} onChange={(e) => setPaper(e.target.value)}>
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
                      className="docs-field"
                      inputMode="decimal"
                      value={margins[side]}
                      onChange={(e) => {
                        setError(false);
                        setMargins((m) => ({ ...m, [side]: e.target.value.slice(0, 8) }));
                      }}
                    />
                  </label>
                ))}
              </div>
            </fieldset>
            {error && (
              <p className="docs-setup-error" role="alert">
                {t("docsPage.marginsTooLarge")}
              </p>
            )}
          </>
        ) : (
          <>
            <div className="docs-setup-pageless-art" aria-hidden>
              <span />
              <span />
              <span />
            </div>
            <p>{t("docsPage.pagelessAbout")}</p>
            {(setup.header || setup.footer) && <p className="docs-setup-note">{t("docsPage.pagelessHides")}</p>}
            {colorButton(t("docsPage.backgroundColor"))}
          </>
        )}
      </div>
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
    </ToolbarDialog>
  );
}
