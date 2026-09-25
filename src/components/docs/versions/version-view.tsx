"use client";

import type { Editor } from "@tiptap/react";
import { DOMSerializer } from "@tiptap/pm/model";
import katex from "katex";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuthor } from "@/components/collab/collab-context";
import { useLang, useT } from "@/components/lang-provider";
import { MoreVertIcon } from "@/components/docs/icons";
import { ArrowBackIcon } from "@/components/docs/insert/icons";
import { flushDocument } from "@/components/docs/layer/flush";
import { DropdownPanel, MenuItem } from "@/components/docs/menu";
import { pageFrame, pagelessWidth, scrollParent } from "@/components/docs/page/geometry";
import { pageStore, usePageState } from "@/components/docs/page/store";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { namedStyleSheet } from "@/components/docs/toolbar/styles";
import { markChanges } from "@/components/docs/versions/diff";
import { api } from "@/lib/api";
import { setVersionsOpen } from "@/lib/assistant/side-chat-open";
import type { PageSetup, RichNode } from "@/lib/docs/schema";
import { KATEX_MACROS } from "@/lib/katex";
import { personColor, type Person } from "@/lib/person";

// Version history (SPEC.md §29), Google Docs' view: the top bar, the version
// drawn read-only on its page, and the panel of versions.

type Version = { id: string; rev: number; savedAt: string; userId: string | null; name: string | null };
type History = { current: Omit<Version, "id" | "name">; versions: Version[]; people: Record<string, Person> };
/** A row of the list: a kept version, or the live document (id ""). */
type Entry = Version & { current: boolean };

const SCOPE = 'html .docs-prose[data-docs-styles="version"]';

function entriesOf(history: History): Entry[] {
  const kept = history.versions.map((v, i) => ({ ...v, current: i === 0 && v.rev === history.current.rev }));
  return kept[0]?.current ? kept : [{ ...history.current, id: "", name: null, current: true }, ...kept];
}

const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** The pane the page editor scrolls in: the view covers it, not the app. */
function usePaneRect(editor: Editor) {
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const pane = scrollParent(editor.view.dom);
    if (!pane) return;
    const measure = () => {
      const r = pane.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [editor]);
  return rect;
}

export function VersionView({
  editor,
  documentId,
  pageSetup,
  canEdit,
  onClose,
}: {
  editor: Editor;
  documentId: string;
  pageSetup: PageSetup;
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const authorOf = useAuthor();
  const store = pageStore(editor, documentId, pageSetup);
  const setup = usePageState(store, (s) => s.setup);
  const textWidth = usePageState(store, (s) => s.textWidth);
  const rect = usePaneRect(editor);
  // The notes tray folds while the view is open, so the page has the room.
  useEffect(() => {
    setVersionsOpen(true);
    return () => setVersionsOpen(false);
  }, []);
  const [live] = useState(() => editor.getJSON() as RichNode);
  const [history, setHistory] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [texts, setTexts] = useState<Record<string, RichNode>>({});
  const [namedOnly, setNamedOnly] = useState(false);
  const [showChanges, setShowChanges] = useState(true);
  const [naming, setNaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const proseRef = useRef<HTMLDivElement>(null);
  const styleRef = useRef<HTMLStyleElement>(null);
  const fetching = useRef(new Set<string>());

  const fail = useCallback((err: unknown) => setError(err instanceof Error ? err.message : t("common.requestFailed")), [t]);
  const read = useCallback(
    async <T,>(path: string): Promise<T> => {
      const res = await fetch(path);
      if (!res.ok) throw new Error(t("common.requestFailedStatus", { status: res.status }));
      return (await res.json()) as T;
    },
    [t],
  );
  // Only the latest list lands: an older one answering later (the view's
  // first load, still out when a version is named) never covers it.
  const loads = useRef(0);
  const load = useCallback(() => {
    const n = ++loads.current;
    return read<History>(`/api/documents/${documentId}/versions`).then((h) => {
      if (n === loads.current) setHistory(h);
    }, fail);
  }, [documentId, read, fail]);
  // The typing waiting to be saved is saved first, so the list holds it.
  useEffect(() => {
    void flushDocument(documentId).then(load);
  }, [documentId, load]);
  // The view takes the focus from the page once it stands over it.
  const placed = rect !== null;
  useEffect(() => {
    if (placed) rootRef.current?.focus();
  }, [placed]);

  const entries = history ? entriesOf(history) : [];
  const index = Math.max(0, entries.findIndex((e) => e.id === selected));
  const entry: Entry | undefined = entries[index];
  const prior: Entry | undefined = entries[index + 1];
  const textOf = (e: Entry) => (e.current ? live : texts[e.id]);
  const doc = entry && textOf(entry);
  const before = showChanges && prior ? textOf(prior) : null;

  // The versions the page needs: the one shown, and the one before it.
  const wantedKey = [entry, showChanges ? prior : undefined].flatMap((e) => (e && !e.current ? [e.id] : [])).join(" ");
  useEffect(() => {
    for (const id of wantedKey.split(" ").filter(Boolean)) {
      if (fetching.current.has(id)) continue;
      fetching.current.add(id);
      read<{ richText: RichNode }>(`/api/documents/${documentId}/versions/${id}`).then(
        (body) => setTexts((all) => ({ ...all, [id]: body.richText })),
        fail,
      );
    }
  }, [wantedKey, documentId, read, fail]);

  const person = (userId: string | null) => (userId ? (history?.people[userId] ?? authorOf(userId)) : undefined);
  const colorOf = (e: Entry) => person(e.userId)?.color ?? personColor(e.userId ?? "");
  const color = entry ? colorOf(entry) : "";

  // The version as the page draws it, its changes marked when they show; a
  // copy with no paragraph index ids, so nothing takes it for the page's text.
  const ready = Boolean(doc) && before !== undefined;
  useLayoutEffect(() => {
    const el = proseRef.current;
    if (!el || !doc || before === undefined) return;
    const schema = editor.schema;
    try {
      const node = schema.nodeFromJSON(doc);
      const shown = showChanges ? markChanges(schema, node, before && schema.nodeFromJSON(before), color) : node;
      const html = DOMSerializer.fromSchema(schema).serializeFragment(shown.content);
      html.querySelectorAll("[data-block-id]").forEach((n) => n.removeAttribute("data-block-id"));
      html.querySelectorAll<HTMLElement>("[data-latex]").forEach((n) =>
        katex.render(n.dataset.latex ?? "", n, {
          displayMode: n.dataset.type === "block-math",
          throwOnError: false,
          macros: { ...KATEX_MACROS },
        }),
      );
      el.replaceChildren(html);
      if (styleRef.current) styleRef.current.textContent = namedStyleSheet(node, SCOPE);
    } catch {
      // A version the editor's schema no longer reads.
      el.replaceChildren();
    }
  }, [editor, doc, before, showChanges, color]);

  const locale = lang === "zh" ? "zh-CN" : undefined;
  const thisYear = new Date().getFullYear();
  const dateOf = (d: Date) =>
    d.toLocaleDateString(locale, { month: "long", day: "numeric", year: d.getFullYear() === thisYear ? undefined : "numeric" });
  const timeOf = (iso: string) => {
    const d = new Date(iso);
    return t("docsVersions.dateTime", { date: dateOf(d), time: d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" }) });
  };
  const groupOf = (iso: string) => {
    const d = new Date(iso);
    const days = Math.round((dayOf(new Date()) - dayOf(d)) / 86_400_000);
    return days === 0 ? t("docsVersions.today") : days === 1 ? t("docsVersions.yesterday") : dateOf(d);
  };

  const saveName = async (e: Entry, value: string) => {
    setNaming(null);
    const name = value.trim();
    if (name === (e.name ?? "")) return;
    try {
      if (e.id) await api(`/api/documents/${documentId}/versions/${e.id}`, "PATCH", { name: name || null });
      else if (name) {
        await flushDocument(documentId);
        await api(`/api/documents/${documentId}/versions`, "POST", { name });
      }
      await load();
    } catch (err) {
      fail(err);
    }
  };

  // Restore this version: the text on screen is kept as a version first,
  // then the version's text becomes the document's, one change to undo.
  const restore = async () => {
    if (!doc) return;
    setConfirming(false);
    await flushDocument(documentId);
    if (!editor.isEmpty) await api(`/api/documents/${documentId}/versions`, "POST", {}).catch(() => {});
    const node = editor.schema.nodeFromJSON(doc);
    const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, node.content);
    for (const [name, value] of Object.entries(node.attrs)) tr.setDocAttribute(name, value);
    editor.view.dispatch(tr);
    onClose();
    editor.commands.focus("start");
  };

  if (!rect) return null;
  const frame = pageFrame(setup);
  const panelWidth = Math.min(320, rect.width / 2);
  const canvasWidth = rect.width - panelWidth;
  // The page fits the canvas, down to half its size; a narrower canvas scrolls.
  const scale = Math.max(0.5, Math.min(1, (canvasWidth - 64) / frame.width));
  const white = setup.pageless || /^#f{3}(f{3})?$/i.test(setup.color);
  const pageStyle: React.CSSProperties = setup.pageless
    ? { width: pagelessWidth(canvasWidth, 1, textWidth) }
    : {
        width: frame.width,
        minHeight: frame.height,
        padding: `${frame.top}px ${frame.right}px ${frame.bottom}px ${frame.left}px`,
        background: white ? undefined : setup.color,
        zoom: scale < 1 ? scale : undefined,
      };
  const visible = namedOnly ? entries.filter((e) => e.current || e.name) : entries;
  const menuEntry = entries.find((e) => e.id === menu);
  const restorable = canEdit && entry && !entry.current;

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="docs-versions"
      data-edit-control
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
    >
      <div className="docs-versions-main">
        <div className="docs-versions-bar">
          <button
            type="button"
            className="docs-icon-btn"
            aria-label={t("docsVersions.back")}
            data-tip={t("docsVersions.back")}
            onClick={onClose}
          >
            <ArrowBackIcon size={24} />
          </button>
          {entry && (
            <div className="docs-versions-heading">
              <div className="docs-versions-heading-title">{entry.name ?? timeOf(entry.savedAt)}</div>
              {entry.name && <div className="docs-versions-heading-time">{timeOf(entry.savedAt)}</div>}
            </div>
          )}
          {restorable && (
            <DialogButton primary onClick={() => setConfirming(true)}>
              {t("docsVersions.restore")}
            </DialogButton>
          )}
        </div>
        <div className="docs-versions-canvas">
          {ready ? (
            <article className="docs-versions-page" data-pageless={setup.pageless || undefined} data-white={white || undefined} style={pageStyle}>
              <style ref={styleRef} />
              <div ref={proseRef} className="docs-prose" data-docs-styles="version" />
            </article>
          ) : (
            !error && <p className="docs-versions-status">{t("common.loading")}</p>
          )}
        </div>
      </div>
      <aside className="docs-versions-panel" style={{ width: panelWidth }}>
        <h2 className="docs-versions-panel-title">{t("docsVersions.versionHistory")}</h2>
        <label className="docs-versions-check">
          <input type="checkbox" checked={namedOnly} onChange={(e) => setNamedOnly(e.target.checked)} />
          {t("docsVersions.namedOnly")}
        </label>
        {error && <p className="docs-versions-error">{error}</p>}
        <div className="docs-versions-list">
          {visible.map((e, i) => {
            const group = groupOf(e.savedAt);
            const who = person(e.userId);
            return (
              <div key={e.id || "current"}>
                {(i === 0 || groupOf(visible[i - 1].savedAt) !== group) && <div className="docs-versions-day">{group}</div>}
                <div className={`docs-versions-tile${e.id === entry?.id ? " docs-versions-tile-selected" : ""}`}>
                  {naming === e.id ? (
                    <input
                      autoFocus
                      className="docs-tb-field docs-versions-name"
                      defaultValue={e.name ?? ""}
                      maxLength={100}
                      aria-label={t("docsVersions.nameThis")}
                      onBlur={(ev) => void saveName(e, ev.currentTarget.value)}
                      onKeyDown={(ev) => {
                        if (ev.key === "Enter") ev.currentTarget.blur();
                        else if (ev.key === "Escape") {
                          ev.currentTarget.value = e.name ?? "";
                          ev.currentTarget.blur();
                        }
                      }}
                    />
                  ) : (
                    <button type="button" className="docs-versions-pick" onClick={() => setSelected(e.id)}>
                      {e.name ?? timeOf(e.savedAt)}
                    </button>
                  )}
                  {e.name && <div className="docs-versions-note">{timeOf(e.savedAt)}</div>}
                  {e.current && <div className="docs-versions-note docs-versions-current">{t("docsVersions.current")}</div>}
                  {who && (
                    <div className="docs-versions-author">
                      <span className="docs-versions-dot" style={{ background: colorOf(e) }} />
                      {who.name}
                    </div>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      className="docs-icon-btn docs-versions-more"
                      aria-label={t("docsVersions.moreActions")}
                      data-tip={t("docsVersions.moreActions")}
                      aria-expanded={menu === e.id}
                      onClick={(ev) => {
                        menuAnchor.current = ev.currentTarget;
                        setMenu(menu === e.id ? null : e.id);
                      }}
                    >
                      <MoreVertIcon size={20} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <label className="docs-versions-check docs-versions-foot">
          <input type="checkbox" checked={showChanges} onChange={(e) => setShowChanges(e.target.checked)} />
          {t("docsVersions.showChanges")}
        </label>
      </aside>
      <DropdownPanel open={menuEntry !== undefined} anchorRef={menuAnchor} onClose={() => setMenu(null)} placement="below-right" className="docs-menu-plain">
        {menuEntry && !menuEntry.current && (
          <MenuItem
            onSelect={() => {
              setSelected(menuEntry.id);
              setMenu(null);
              setConfirming(true);
            }}
          >
            {t("docsVersions.restore")}
          </MenuItem>
        )}
        <MenuItem
          onSelect={() => {
            setNaming(menu);
            setMenu(null);
          }}
        >
          {t("docsVersions.nameThis")}
        </MenuItem>
      </DropdownPanel>
      {confirming && entry && (
        <ToolbarDialog
          title={t("docsVersions.restoreQuestion")}
          onClose={() => setConfirming(false)}
          closeButton={false}
          submit={{ label: t("docsVersions.restoreButton"), disabled: !doc, run: () => void restore() }}
        >
          {t("docsVersions.restoreBody", { time: timeOf(entry.savedAt) })}
        </ToolbarDialog>
      )}
    </div>
  );
}
