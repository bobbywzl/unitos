"use client";

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { EyedropperIcon } from "@/components/docs/icons";
import { hasEyeDropper, hexToRgb, pickFromScreen, rgbToHex } from "@/components/docs/palette";
import { ToolbarDialog } from "@/components/docs/toolbar/dialog";

// The custom color picker (SPEC.md §29): Google Docs' dialog behind the
// color menu's add button. A saturation and value area, the hue slider, a
// preview of the color, the eyedropper where the browser has one, and the
// Hex, R, G, and B fields; OK applies the color and adds it to the CUSTOM
// row. The page behind stays undimmed; the title bar is hidden.

type Hsv = { h: number; s: number; v: number };

function rgbToHsv(r: number, g: number, b: number): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function CustomColorDialog({
  initial,
  onClose,
  onApply,
}: {
  initial: string;
  onClose: () => void;
  onApply: (hex: string) => void;
}) {
  const t = useT();
  const start = /^#[0-9a-f]{6}$/i.test(initial) ? initial.toLowerCase() : "#000000";
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(...hexToRgb(start)));
  const hex = rgbToHex(...hsvToRgb(hsv));
  const [rgb, setRgb] = useState(() => hexToRgb(start));
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [rgbDraft, setRgbDraft] = useState<(string | null)[]>([null, null, null]);

  const setColor = (next: Hsv) => {
    setHsv(next);
    setRgb(hsvToRgb(next).map(Math.round) as [number, number, number]);
    setHexDraft(null);
    setRgbDraft([null, null, null]);
  };
  const setFromHex = (value: string) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
    if (!m) return;
    const next = hexToRgb(`#${m[1].toLowerCase()}`);
    setHsv(rgbToHsv(...next));
    setRgb(next);
  };

  // A press and drag on the area or the hue track.
  const drag = (e: React.PointerEvent<HTMLDivElement>, onMove: (x: number, y: number) => void) => {
    const el = e.currentTarget;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect();
      onMove(clamp01((ev.clientX - r.left) / r.width), clamp01((ev.clientY - r.top) / r.height));
    };
    move(e);
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const channel = (i: 0 | 1 | 2, label: string) => (
    <label className="docs-color-field docs-color-channel">
      <span>{label}</span>
      <input
        className="docs-tb-field"
        value={rgbDraft[i] ?? String(rgb[i])}
        maxLength={3}
        inputMode="numeric"
        onChange={(e) => {
          const raw = e.target.value.replace(/\D/g, "");
          setRgbDraft((d) => d.map((v, j) => (j === i ? raw : v)));
          const n = Number(raw);
          if (raw !== "" && n >= 0 && n <= 255) {
            const next = [...rgb] as [number, number, number];
            next[i] = n;
            setRgb(next);
            setHsv(rgbToHsv(...next));
            setHexDraft(null);
          }
        }}
        onBlur={() => setRgbDraft([null, null, null])}
      />
    </label>
  );

  return (
    <ToolbarDialog
      label={t("docs.customColorPicker")}
      onClose={onClose}
      dim={false}
      closeButton={false}
      className="docs-color-dialog"
      submit={{ run: () => onApply(hex) }}
    >
      <div
        className="docs-color-area"
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={(e) => drag(e, (x, y) => setColor({ ...hsv, s: x, v: 1 - y }))}
        role="slider"
        aria-label={t("docs.customColorPicker")}
        aria-valuetext={hex}
        aria-valuenow={Math.round(hsv.s * 100)}
        tabIndex={0}
        onKeyDown={(e) => {
          const d = e.shiftKey ? 0.1 : 0.02;
          const moves: Record<string, Partial<Hsv>> = {
            ArrowLeft: { s: clamp01(hsv.s - d) },
            ArrowRight: { s: clamp01(hsv.s + d) },
            ArrowUp: { v: clamp01(hsv.v + d) },
            ArrowDown: { v: clamp01(hsv.v - d) },
          };
          const move = moves[e.key];
          if (!move) return;
          e.preventDefault();
          setColor({ ...hsv, ...move });
        }}
      >
        <span className="docs-color-handle" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div className="docs-color-row">
        <span className="docs-color-preview" style={{ background: hex }} />
        {hasEyeDropper() && (
          <button
            type="button"
            className="docs-palette-tool docs-color-eyedropper"
            aria-label={t("docs.eyedropper")}
            data-tip={t("docs.eyedropper")}
            onClick={() => {
              void pickFromScreen().then((picked) => {
                if (picked) setFromHex(picked);
              });
            }}
          >
            <EyedropperIcon size={20} />
          </button>
        )}
        <div
          className="docs-color-hue"
          onPointerDown={(e) => drag(e, (x) => setColor({ ...hsv, h: Math.min(359.9, x * 360) }))}
          role="slider"
          aria-label={t("docs.hue")}
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hsv.h)}
          tabIndex={0}
          onKeyDown={(e) => {
            const d = e.shiftKey ? 20 : 4;
            if (e.key === "ArrowLeft" || e.key === "ArrowDown") setColor({ ...hsv, h: Math.max(0, hsv.h - d) });
            else if (e.key === "ArrowRight" || e.key === "ArrowUp") setColor({ ...hsv, h: Math.min(359.9, hsv.h + d) });
            else return;
            e.preventDefault();
          }}
        >
          <span className="docs-color-hue-thumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
        </div>
      </div>
      <div className="docs-color-fields">
        <label className="docs-color-field docs-color-hex">
          <span>{t("docs.hex")}</span>
          <input
            className="docs-tb-field"
            value={hexDraft ?? hex}
            maxLength={7}
            aria-label={t("docs.hexColor")}
            onChange={(e) => {
              setHexDraft(e.target.value);
              setFromHex(e.target.value);
            }}
            onBlur={() => setHexDraft(null)}
          />
        </label>
        {channel(0, "R")}
        {channel(1, "G")}
        {channel(2, "B")}
      </div>
    </ToolbarDialog>
  );
}
