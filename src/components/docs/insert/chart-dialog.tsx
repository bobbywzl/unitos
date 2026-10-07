"use client";

import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/lang-provider";
import { AddIcon, CloseIcon } from "@/components/docs/icons";
import { onInsert, type InsertContext } from "@/components/docs/insert/context";
import { imageAttrs, isChartImage, setImageAttrs } from "@/components/docs/insert/image";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { insertImage } from "@/components/docs/typing/paste";
import {
  CHART_HEIGHT,
  CHART_TYPES,
  CHART_WIDTH,
  MAX_CHART_LABELS,
  MAX_CHART_SERIES,
  chartFromRows,
  chartNumber,
  chartSvg,
  parseChart,
  type ChartSpec,
  type ChartType,
} from "@/lib/docs/chart";
import type { TFunc, TKey } from "@/lib/i18n/dictionaries";
import { uploadImage } from "@/lib/images";
import "./chart.css";

// Insert > Chart (SPEC.md §29): the dialog that makes a chart and edits one.
// The type, the chart title, and the data — a label and a value per series
// on each row, the series named in the header — with the chart drawn beside
// it as it changes. Insert stores the drawing as an image that keeps the
// data (lib/docs/chart.ts); on a chart, Update draws it again. A new chart
// made while the caret is in a table takes the table's words and numbers
// and lands under the table.

export const CHART_TYPE_LABEL: Record<ChartType, TKey> = {
  column: "docsInsert.chartColumn",
  bar: "docsInsert.chartBar",
  line: "docsInsert.chartLine",
  pie: "docsInsert.chartPie",
};

/** The data as the dialog edits it: every value as typed. */
type Draft = { type: ChartType; title: string; labels: string[]; names: string[]; cells: string[][] };

function draftOf(spec: ChartSpec): Draft {
  return {
    type: spec.type,
    title: spec.title,
    labels: [...spec.labels],
    names: spec.series.map((s) => s.name),
    cells: spec.labels.map((_, row) => spec.series.map((s) => (s.values[row] === null ? "" : String(s.values[row])))),
  };
}

function specOf(draft: Draft): ChartSpec {
  return {
    v: 1,
    type: draft.type,
    title: draft.title.trim().slice(0, 200),
    labels: draft.labels.map((label) => label.slice(0, 100)),
    series: draft.names.map((name, k) => ({
      name: name.slice(0, 100),
      values: draft.cells.map((row) => chartNumber(row[k] ?? "")),
    })),
  };
}

/** The chart's alt text: its type, and its title when it has one. */
function altOf(spec: ChartSpec, t: TFunc): string {
  const kind = t(CHART_TYPE_LABEL[spec.type]);
  return spec.title ? `${kind}: ${spec.title}` : kind;
}

/** The table the caret is in, and where it starts. */
function tableAround(state: EditorState): { node: PMNode; pos: number } | null {
  const { $from } = state.selection;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "table") return { node, pos: $from.before(depth) };
  }
  return null;
}

function rowsOf(table: PMNode): string[][] {
  const rows: string[][] = [];
  table.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
}

/** A new chart's data when there is no table to read: three rows to type over. */
function sample(t: TFunc): ChartSpec {
  return {
    v: 1,
    type: "column",
    title: "",
    labels: [1, 2, 3].map((n) => t("docsInsert.chartItem", { n })),
    series: [{ name: t("docsInsert.chartSeries", { n: 1 }), values: [12, 30, 21] }],
  };
}

/** The drawing as a PNG, at twice its size for sharp print; null when the
    browser cannot draw it. */
async function chartFile(svg: string): Promise<File | null> {
  try {
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = CHART_WIDTH * 2;
    canvas.height = CHART_HEIGHT * 2;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? new File([blob], "chart.png", { type: "image/png" }) : null;
  } catch {
    return null;
  }
}

type Open = { draft: Draft; pos: number | null; after: number | null };

export function ChartHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  const t = useT();
  const [open, setOpen] = useState<Open | null>(null);
  useEffect(
    () =>
      onInsert(editor, (event) => {
        if (event.type !== "chart" || !ctx.editing) return;
        if (event.pos !== undefined) {
          const node = editor.state.doc.nodeAt(event.pos);
          const spec = node && isChartImage(node) ? parseChart(node.attrs.chart) : null;
          if (spec) setOpen({ draft: draftOf(spec), pos: event.pos, after: null });
          return;
        }
        const table = tableAround(editor.state);
        const read = table ? chartFromRows(rowsOf(table.node), (n) => t("docsInsert.chartSeries", { n })) : null;
        const spec = read ?? sample(t);
        setOpen({
          draft: { ...draftOf(spec), type: event.kind ?? spec.type },
          pos: null,
          after: read && table ? table.pos + table.node.nodeSize : null,
        });
      }),
    [editor, ctx.editing, t],
  );
  if (!open) return null;
  return (
    <ChartDialog
      editor={editor}
      open={open}
      onClose={() => {
        setOpen(null);
        editor.commands.focus();
      }}
    />
  );
}

function ChartDialog({ editor, open, onClose }: { editor: Editor; open: Open; onClose: () => void }) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(open.draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spec = useMemo(() => specOf(draft), [draft]);
  const svg = useMemo(() => chartSvg(spec, t("docsInsert.chartNoData")), [spec, t]);
  const editing = open.pos !== null;

  const set = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));
  const setCell = (row: number, k: number, value: string) =>
    setDraft((d) => ({ ...d, cells: d.cells.map((cells, r) => (r === row ? cells.map((c, j) => (j === k ? value : c)) : cells)) }));
  const addRow = () =>
    setDraft((d) => ({ ...d, labels: [...d.labels, t("docsInsert.chartItem", { n: d.labels.length + 1 })], cells: [...d.cells, d.names.map(() => "")] }));
  const removeRow = (row: number) =>
    setDraft((d) => ({ ...d, labels: d.labels.filter((_, r) => r !== row), cells: d.cells.filter((_, r) => r !== row) }));
  const addSeries = () =>
    setDraft((d) => ({ ...d, names: [...d.names, t("docsInsert.chartSeries", { n: d.names.length + 1 })], cells: d.cells.map((cells) => [...cells, ""]) }));
  const removeSeries = (k: number) =>
    setDraft((d) => ({ ...d, names: d.names.filter((_, j) => j !== k), cells: d.cells.map((cells) => cells.filter((_, j) => j !== k)) }));

  async function apply() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const file = await chartFile(svg);
      if (!file) throw new Error(t("common.requestFailed"));
      const { url } = await uploadImage(file);
      const alt = altOf(spec, t);
      const chart = JSON.stringify(spec);
      if (open.pos !== null) {
        const node = editor.state.doc.nodeAt(open.pos);
        if (node && node.type.name === "image") {
          const { width } = imageAttrs(node);
          const height = width ? { height: Math.round((width * CHART_HEIGHT) / CHART_WIDTH) } : {};
          setImageAttrs(editor.view, open.pos, { src: url, alt, chart, ...height });
        }
      } else {
        insertImage(editor, { src: url, alt, width: CHART_WIDTH, height: CHART_HEIGHT, chart }, open.after ?? undefined);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("common.requestFailed"));
      setBusy(false);
    }
  }

  return (
    <ToolbarDialog
      title={t(editing ? "docsInsert.editChart" : "docsInsert.insertChart")}
      onClose={onClose}
      className="docs-chart-dialog"
      closeButton={false}
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <button
            type="button"
            className="docs-tb-button docs-tb-button-primary"
            data-track="docs:chart:insert"
            disabled={busy}
            onClick={() => void apply()}
          >
            {t(editing ? "docsInsert.chartUpdate" : "docsInsert.chartInsert")}
          </button>
        </>
      }
    >
      <div className="docs-chart-body">
        <div className="docs-chart-form">
          <div className="docs-chart-label">{t("docsInsert.chartType")}</div>
          <div className="docs-chart-types" role="group" aria-label={t("docsInsert.chartType")}>
            {CHART_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                className="docs-chart-type"
                aria-pressed={draft.type === type}
                data-track={`docs:chart:type:${type}`}
                onClick={() => set({ type })}
              >
                {t(CHART_TYPE_LABEL[type])}
              </button>
            ))}
          </div>
          <label className="docs-chart-label" htmlFor="docs-chart-title">
            {t("docsInsert.chartTitle")}
          </label>
          <input
            id="docs-chart-title"
            className="docs-tb-field"
            value={draft.title}
            maxLength={200}
            data-track="docs:chart:title"
            onChange={(e) => set({ title: e.target.value })}
          />
          <div className="docs-chart-label">{t("docsInsert.chartData")}</div>
          <div className="docs-chart-grid-wrap">
            <table className="docs-chart-grid">
              <thead>
                <tr>
                  <th className="docs-chart-corner">{t("docsInsert.chartLabel")}</th>
                  {draft.names.map((name, k) => (
                    <th key={k}>
                      <span className="docs-chart-cell">
                        <input
                          value={name}
                          maxLength={100}
                          aria-label={t("docsInsert.chartSeries", { n: k + 1 })}
                          data-track="docs:chart:series"
                          onChange={(e) => setDraft((d) => ({ ...d, names: d.names.map((n, j) => (j === k ? e.target.value : n)) }))}
                        />
                        {draft.names.length > 1 && (
                          <button
                            type="button"
                            className="docs-chart-remove"
                            aria-label={t("docsInsert.chartRemoveSeries")}
                            data-tip={t("docsInsert.chartRemoveSeries")}
                            data-track="docs:chart:remove-series"
                            onClick={() => removeSeries(k)}
                          >
                            <CloseIcon size={14} />
                          </button>
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="docs-chart-add-col">
                    {draft.names.length < MAX_CHART_SERIES && (
                      <button
                        type="button"
                        className="docs-chart-remove"
                        aria-label={t("docsInsert.chartAddSeries")}
                        data-tip={t("docsInsert.chartAddSeries")}
                        data-track="docs:chart:add-series"
                        onClick={addSeries}
                      >
                        <AddIcon size={16} />
                      </button>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {draft.labels.map((label, row) => (
                  <tr key={row}>
                    <td>
                      <input
                        value={label}
                        maxLength={100}
                        aria-label={t("docsInsert.chartLabel")}
                        data-track="docs:chart:label"
                        onChange={(e) => setDraft((d) => ({ ...d, labels: d.labels.map((l, r) => (r === row ? e.target.value : l)) }))}
                      />
                    </td>
                    {draft.names.map((name, k) => (
                      <td key={k}>
                        <input
                          value={draft.cells[row]?.[k] ?? ""}
                          inputMode="decimal"
                          aria-label={`${label} · ${name}`}
                          aria-invalid={Boolean(draft.cells[row]?.[k]?.trim()) && chartNumber(draft.cells[row][k]) === null}
                          data-track="docs:chart:value"
                          onChange={(e) => setCell(row, k, e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="docs-chart-add-col">
                      {draft.labels.length > 1 && (
                        <button
                          type="button"
                          className="docs-chart-remove"
                          aria-label={t("docsInsert.chartRemoveRow")}
                          data-tip={t("docsInsert.chartRemoveRow")}
                          data-track="docs:chart:remove-row"
                          onClick={() => removeRow(row)}
                        >
                          <CloseIcon size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {draft.labels.length < MAX_CHART_LABELS && (
            <button type="button" className="docs-chart-add-row" data-track="docs:chart:add-row" onClick={addRow}>
              <AddIcon size={16} />
              {t("docsInsert.chartAddRow")}
            </button>
          )}
          {draft.type === "pie" && draft.names.length > 1 && <p className="docs-chart-note">{t("docsInsert.chartPieFirst")}</p>}
          {error && <p className="docs-chart-error">{error}</p>}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          className="docs-chart-preview"
          src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          alt={altOf(spec, t)}
          width={CHART_WIDTH}
          height={CHART_HEIGHT}
        />
      </div>
    </ToolbarDialog>
  );
}
