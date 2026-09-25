"use client";

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { PersonBadge } from "@/components/collab/person-badge";
import { useT } from "@/components/lang-provider";
import { docsCommands } from "@/components/docs/commands";
import {
  BulletListIcon,
  ChecklistIcon,
  DocIcon,
  HorizontalRuleIcon,
  ImageIcon,
  LinkIcon,
  NumberedListIcon,
  OutlineIcon,
  PageBreakIcon,
  TableIcon,
} from "@/components/docs/icons";
import {
  insertBookmark,
  insertCodeBlock,
  insertDateChip,
  insertDropdownChip,
  insertEquation,
  insertFileChip,
  insertHorizontalLine,
  insertInline,
  insertPersonChip,
  insertTableOfContents,
  replaceQuery,
  type Range,
} from "@/components/docs/insert/actions";
import { atMenuState, closeAtMenu, setAtKeyHandler, type AtState } from "@/components/docs/insert/at-plugin";
import { buildingBlock, type BuildingBlock } from "@/components/docs/insert/building-blocks";
import { emitInsert, onInsert, type InsertContext, type PickerKind } from "@/components/docs/insert/context";
import { DatePicker } from "@/components/docs/insert/date-picker";
import { matchDates } from "@/components/docs/insert/dates";
import { DropdownPicker } from "@/components/docs/insert/dropdown-ui";
import { EmojiPicker, rememberEmoji, useEmojiData } from "@/components/docs/insert/emoji-picker";
import { insertFootnote } from "@/components/docs/insert/footnotes";
import { TocStyles } from "@/components/docs/insert/hosts";
import {
  AssignmentIcon,
  BookmarkIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  DropdownChipIcon,
  EmailIcon,
  FootnoteIcon,
  FunctionsIcon,
  MapIcon,
  MeetingNotesIcon,
  MoodIcon,
  TaskIcon,
  TitleIcon,
} from "@/components/docs/insert/icons";
import { ImageSourcePicker } from "@/components/docs/insert/image-source";
import { insertImageFrom } from "@/components/docs/insert/image";
import { TableGridPicker } from "@/components/docs/insert/table-grid";
import { anchorAt, FloatingBox, useDocPos, useEditorTick, useViewportTick } from "@/components/docs/insert/ui";
import { DOCS_EVENT, fireDocs } from "@/components/docs/typing/events";
import type { TKey } from "@/lib/i18n/dictionaries";

// The "@" menu (SPEC.md §29), Google Docs' insert menu under the typed "@":
// sections filtered by the words typed after it, the matching letters in
// bold. An item deletes the "@query" and inserts, or opens its picker there.

type Section = "people" | "dates" | "chips" | "blocks" | "files" | "emojis" | "lists" | "media" | "headings" | "tables" | "page" | "more";

type Item = {
  key: string;
  section: Section;
  label: string;
  sub?: string;
  /** More words that find the item, lowercase, both languages. */
  words?: string;
  icon: ReactNode;
  /** A picker to open, or what the item does in place of the "@query". */
  action: PickerKind | ((range: Range) => void);
  disabled?: string;
  /** Always shown while its section shows (dates and emoji are matched already). */
  matched?: boolean;
};

const SECTION_TITLE: Record<Section, TKey> = {
  people: "docsInsert.sectionPeople",
  dates: "docsInsert.sectionDates",
  chips: "docsInsert.sectionSmartChips",
  blocks: "docsInsert.sectionBuildingBlocks",
  files: "docsInsert.sectionFiles",
  emojis: "docsInsert.sectionEmojis",
  lists: "docsInsert.sectionLists",
  media: "docsInsert.sectionMedia",
  headings: "docsInsert.sectionHeadings",
  tables: "docsInsert.sectionTables",
  page: "docsInsert.sectionPageComponents",
  more: "docsInsert.sectionMore",
};

/** How many rows a section shows before its full list; 0 = all. */
const SECTION_LIMIT: Partial<Record<Section, number>> = { people: 3, blocks: 4, files: 3, emojis: 5, dates: 4 };

const ORDER_EMPTY: Section[] = ["people", "chips", "blocks", "files", "lists", "media", "headings", "tables", "page", "more"];
const ORDER_QUERY: Section[] = ["people", "dates", "chips", "files", "blocks", "emojis", "lists", "media", "headings", "tables", "page", "more"];

const BLOCKS: [BuildingBlock, TKey, ReactNode, string][] = [
  ["meetingNotes", "docsInsert.itemMeetingNotes", <MeetingNotesIcon key="i" />, "meeting notes agenda 会议 记录"],
  ["emailDraft", "docsInsert.itemEmailDraft", <EmailIcon key="i" />, "email mail draft 邮件"],
  ["productRoadmap", "docsInsert.itemProductRoadmap", <MapIcon key="i" />, "roadmap product table 路线图"],
  ["reviewTracker", "docsInsert.itemReviewTracker", <AssignmentIcon key="i" />, "review tracker table 审核"],
  ["taskTracker", "docsInsert.itemTaskTracker", <TaskIcon key="i" />, "task tracker todo table 任务"],
];

const HEADINGS: ["title" | "subtitle" | "h1" | "h2" | "h3" | "normal", TKey, string][] = [
  ["title", "docs.styleTitle", "title heading 标题"],
  ["subtitle", "docs.styleSubtitle", "subtitle 副标题"],
  ["h1", "docs.styleHeading1", "heading h1 标题"],
  ["h2", "docs.styleHeading2", "heading h2 标题"],
  ["h3", "docs.styleHeading3", "heading h3 标题"],
  ["normal", "docs.styleNormal", "normal text paragraph 正文"],
];

const PAGE_COMPONENTS: [id: string, words: string, icon: ReactNode][] = [
  ["page:page-numbers", "page number numbering 页码", <span key="i" className="docs-at-glyph">#</span>],
  ["page:page-count", "page count total pages 页数", <span key="i" className="docs-at-glyph">#</span>],
  ["page:header", "header 页眉", <DocIcon key="i" />],
  ["page:footer", "footer 页脚", <DocIcon key="i" />],
];

const CODE_LANGUAGES: [string, string][] = [
  ["bash", "Bash"],
  ["c", "C"],
  ["cpp", "C++"],
  ["csharp", "C#"],
  ["css", "CSS"],
  ["go", "Go"],
  ["html", "HTML"],
  ["java", "Java"],
  ["javascript", "JavaScript"],
  ["json", "JSON"],
  ["kotlin", "Kotlin"],
  ["php", "PHP"],
  ["protobuf", "Protobuf"],
  ["python", "Python"],
  ["rust", "Rust"],
  ["sql", "SQL"],
  ["typescript", "TypeScript"],
  ["xml", "XML"],
];

/** The label with the typed letters in bold. */
function Marked({ label, query }: { label: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? label.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, at)}
      <b>{label.slice(at, at + q.length)}</b>
      {label.slice(at + q.length)}
    </>
  );
}

function score(item: Item, q: string): number {
  if (item.matched) return 5;
  if (!q) return 1;
  const label = item.label.toLowerCase().replace(/^:/, "");
  if (label.startsWith(q)) return 4;
  if (label.split(/[\s/&(),.-]+/).some((w) => w.startsWith(q))) return 3;
  if (label.includes(q)) return 2;
  if ((item.words ?? "").split(" ").some((w) => w && (w.startsWith(q) || (q.startsWith(w) && w.length > 2)))) return 1;
  return 0;
}

export function AtMenuHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  useEditorTick(editor);
  const s = atMenuState(editor.state);
  // The picker's place follows the edits made while it is open.
  const [at, setAt] = useDocPos(editor);
  const [kind, setKind] = useState<PickerKind>("date");
  useViewportTick(s.active || at !== null);

  const openPicker = useCallback(
    (next: PickerKind, pos: number) => {
      setKind(next);
      setAt(pos);
    },
    [setAt],
  );

  // A command opens a picker at the caret (Insert › Date, Dropdown, …).
  useEffect(
    () => onInsert(editor, (event) => event.type === "picker" && openPicker(event.kind, editor.state.selection.from)),
    [editor, openPicker],
  );

  if (at !== null) {
    const close = (run?: () => void) => {
      setAt(null);
      const { state, view } = editor;
      view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve(Math.min(at, state.doc.content.size)))));
      view.focus();
      run?.();
    };
    return <PickerBox editor={editor} ctx={ctx} kind={kind} at={at} done={close} />;
  }
  if (!s.active) return null;
  return <AtMenu editor={editor} ctx={ctx} state={s} onPicker={openPicker} />;
}

function AtMenu({
  editor,
  ctx,
  state,
  onPicker,
}: {
  editor: Editor;
  ctx: InsertContext;
  state: AtState;
  onPicker: (kind: PickerKind, pos: number) => void;
}) {
  const t = useT();
  const collab = useCollab();
  const emoji = useEmojiData();
  const [expanded, setExpanded] = useState<Section | null>(null);
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = state.query.trim().toLowerCase();
  const colon = state.char === ":";

  // A new query starts at the first row of the full menu.
  const [lastQuery, setLastQuery] = useState(state.query);
  if (lastQuery !== state.query) {
    setLastQuery(state.query);
    setHighlight(0);
    setExpanded(null);
  }

  const items = useMemo((): Item[] => {
    const lang = ctx.lang;
    const emojiItems = (limit: number): Item[] =>
      emoji && emoji !== "error" && q
        ? emoji.searchEmojis(q, limit).map((e) => ({
            key: `emoji-${e.code}`,
            section: "emojis",
            label: `:${e.code}:`,
            words: e.words,
            icon: <span className="docs-at-emoji">{e.char}</span>,
            matched: colon,
            action: (range) => {
              rememberEmoji(e.char);
              insertInline(editor, { type: "text", text: e.char }, range);
            },
          }))
        : [];
    if (colon) return emojiItems(40);
    const here = (run: () => void) => (range: Range) => replaceQuery(editor, range, run);
    const item = (key: string, section: Section, label: TKey, words: string, icon: ReactNode, action: Item["action"]): Item => ({
      key,
      section,
      label: t(label),
      words,
      icon,
      action,
    });
    return [
      // People: the project's collaborators; the signed-in person answers "@me".
      ...Object.values(collab.people).map(
        (person): Item => ({
          key: `person-${person.id}`,
          section: "people",
          label: person.name,
          sub: person.id === collab.myId ? t("docsInsert.me") : undefined,
          words: person.id === collab.myId ? "me 我" : "",
          icon: <PersonBadge person={person} size={20} />,
          action: (range) => insertPersonChip(editor, person, range),
        }),
      ),
      item("date", "chips", "docsInsert.itemDate", "date calendar 日期", <CalendarIcon />, "date"),
      item("dropdown", "chips", "docsInsert.itemDropdown", "dropdown status select 下拉", <DropdownChipIcon />, "dropdown"),
      // Dates: the words typed name a day.
      ...(q ? matchDates(state.query, lang) : []).map(
        (d): Item => ({
          key: `date-${d.iso}`,
          section: "dates",
          label: new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" }).format(new Date(`${d.iso}T12:00:00`)),
          sub: d.hint,
          icon: <CalendarIcon />,
          matched: true,
          action: (range) => insertDateChip(editor, d.iso, lang, { range }),
        }),
      ),
      ...BLOCKS.map(([kind, label, icon, words]) =>
        item(`block-${kind}`, "blocks", label, words, icon, here(() => editor.chain().focus().insertContent(buildingBlock(kind, t, lang)).run())),
      ),
      // Files: the project's other documents.
      ...ctx.documents
        .filter((doc) => doc.id !== ctx.documentId)
        .map(
          (doc): Item => ({
            key: `file-${doc.id}`,
            section: "files",
            label: doc.title,
            icon: <DocIcon className="docs-at-doc-icon" />,
            action: (range) => insertFileChip(editor, doc, ctx.notebookId, range),
          }),
        ),
      ...emojiItems(12),
      item("checklist", "lists", "docs.checklist", "checklist todo task 清单", <ChecklistIcon />, here(() => editor.isActive("taskList") || editor.chain().focus().toggleTaskList().run())),
      item("bullets", "lists", "docs.bulletedList", "bulleted list bullets 列表", <BulletListIcon />, here(() => editor.isActive("bulletList") || editor.chain().focus().toggleBulletList().run())),
      item("numbers", "lists", "docs.numberedList", "numbered list ordered 编号", <NumberedListIcon />, here(() => editor.isActive("orderedList") || editor.chain().focus().toggleOrderedList().run())),
      item("image", "media", "docsInsert.itemImage", "image picture photo 图片 照片", <ImageIcon />, "image"),
      item("emoji", "media", "docsInsert.itemEmoji", "emoji smiley 表情", <MoodIcon />, "emoji"),
      ...HEADINGS.map(([style, label, words]) => item(style, "headings", label, words, <TitleIcon />, here(() => editor.chain().focus().setDocStyle(style).run()))),
      item("table", "tables", "docsInsert.itemTable", "table grid 表格", <TableIcon />, "table"),
      // The page area's commands (page/commands.ts): Page count only while a
      // header or footer is edited.
      ...PAGE_COMPONENTS.flatMap(([id, words, icon]): Item[] => {
        const command = docsCommands().find((c) => c.id === id);
        if (!command) return [];
        const off = command.enabled?.(editor) === false;
        const why = ctx.pageSetup.pageless ? "docsInsert.pagesOnly" : "docsInsert.headersOnly";
        return [{ ...item(id, "page", command.label, words, icon, here(() => command.run(editor))), disabled: off ? t(why) : undefined }];
      }),
      {
        ...item("pagebreak", "page", "docsInsert.itemPageBreak", "page break 分页", <PageBreakIcon />, here(() => editor.chain().focus().setPageBreak().run())),
        disabled: ctx.pageSetup.pageless ? t("docsInsert.pagesOnly") : undefined,
      },
      item("hr", "more", "docsInsert.itemHorizontalLine", "horizontal line rule divider hr 分隔线 横线", <HorizontalRuleIcon />, (range) =>
        insertHorizontalLine(editor, range),
      ),
      item("toc", "more", "docsInsert.itemTableOfContents", "table of contents toc 目录", <OutlineIcon />, "toc"),
      item("bookmark", "more", "docsInsert.itemBookmark", "bookmark anchor 书签 锚点", <BookmarkIcon />, (range) => insertBookmark(editor, range)),
      item("footnote", "more", "docsInsert.itemFootnote", "footnote note 脚注", <FootnoteIcon />, here(() => insertFootnote(editor))),
      item("equation", "more", "docsInsert.itemEquation", "equation math formula latex 公式 数学", <FunctionsIcon />, (range) => {
        const pos = insertEquation(editor, range);
        if (pos !== null) emitInsert(editor, { type: "equation", pos });
      }),
      item("special", "more", "docsInsert.itemSpecialCharacters", "special characters symbols omega 特殊 符号", <span className="docs-at-glyph">Ω</span>, here(() =>
        emitInsert(editor, { type: "special-characters" }),
      )),
      item("link", "more", "docsInsert.itemLink", "link url hyperlink 链接", <LinkIcon />, here(() => fireDocs(editor, DOCS_EVENT.link))),
      item("code", "more", "docsInsert.itemCodeBlock", "code block snippet 代码", <CodeIcon />, "code"),
    ];
  }, [colon, emoji, q, state.query, collab.people, collab.myId, ctx, editor, t]);

  // The sections to show, each with its rows. While searching, the section
  // with the best match comes first.
  const sections = useMemo(() => {
    const order = colon ? (["emojis"] as Section[]) : q ? ORDER_QUERY : ORDER_EMPTY;
    const out: { section: Section; rows: Item[]; more: boolean; best: number }[] = [];
    for (const section of expanded ? [expanded] : order) {
      const scored = items
        .filter((i) => i.section === section)
        .map((i, index) => ({ i, index, s: score(i, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.index - b.index);
      if (scored.length === 0) continue;
      const matched = scored.map((x) => x.i);
      const limit = colon ? 8 : (SECTION_LIMIT[section] ?? 0);
      const more = limit > 0 && matched.length > limit;
      out.push({ section, rows: expanded || !more ? matched : matched.slice(0, limit), more: more && !expanded, best: scored[0].s });
    }
    // Emoji give way to the menu's own items on a tie.
    const rank = (x: { section: Section; best: number }) => x.best - (x.section === "emojis" ? 0.5 : 0);
    if (q && !colon) out.sort((a, b) => rank(b) - rank(a));
    return out;
  }, [items, q, expanded, colon]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const current = Math.min(highlight, Math.max(0, flat.length - 1));

  const choose = useCallback(
    (item: Item | undefined) => {
      if (!item || item.disabled) return;
      const range = { ...state.range };
      closeAtMenu(editor.view);
      if (typeof item.action === "function") {
        item.action(range);
        return;
      }
      if (range.to > range.from) editor.chain().focus().deleteRange(range).run();
      onPicker(item.action, range.from);
    },
    [editor, onPicker, state.range],
  );

  const expand = (section: Section | null) => {
    setExpanded(section);
    setHighlight(0);
  };

  // The keys, while the menu is open.
  const keyState = useRef({ flat, current, sections, choose, expanded });
  useLayoutEffect(() => {
    keyState.current = { flat, current, sections, choose, expanded };
  });
  useEffect(() => {
    const view = editor.view;
    setAtKeyHandler(view, (e) => {
      const k = keyState.current;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (k.flat.length === 0) return true;
        const d = e.key === "ArrowDown" ? 1 : -1;
        setHighlight((h) => (Math.min(h, k.flat.length - 1) + d + k.flat.length) % k.flat.length);
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (k.flat.length === 0) return false;
        k.choose(k.flat[k.current]);
        return true;
      }
      if (e.key === "ArrowRight" && !k.expanded) {
        const section = k.sections.find((s) => s.rows.includes(k.flat[k.current]));
        if (!section?.more) return false;
        expand(section.section);
        return true;
      }
      if (e.key === "ArrowLeft" && k.expanded) {
        expand(null);
        return true;
      }
      return false;
    });
    return () => setAtKeyHandler(view, null);
  }, [editor]);

  useEffect(() => {
    listRef.current?.querySelector(".is-active")?.scrollIntoView({ block: "nearest" });
  }, [current, expanded]);

  const anchor = anchorAt(editor, state.range.from);
  // ":" shows nothing until a letter is typed.
  if (!anchor || (colon && !q)) return null;
  const loading = (colon || (q && flat.length === 0)) && emoji === null;
  const failed = colon && emoji === "error";
  if (colon && !loading && !failed && flat.length === 0) return null;
  let index = -1;
  return (
    <FloatingBox anchor={anchor} className="docs-at-menu" role="listbox" label={t("docs.menuInsert")} onDismiss={() => closeAtMenu(editor.view)}>
      <div ref={listRef} className="docs-at-scroll">
        {expanded && (
          <button type="button" className="docs-at-back" onClick={() => expand(null)}>
            <ChevronLeftIcon />
            <span>{t(SECTION_TITLE[expanded])}</span>
          </button>
        )}
        {sections.map((sec) => (
          <div key={sec.section} role="group" aria-label={t(SECTION_TITLE[sec.section])}>
            {!expanded && (
              <div className="docs-at-section">
                <span>{t(SECTION_TITLE[sec.section])}</span>
                {sec.more && (
                  <button
                    type="button"
                    className="docs-at-more"
                    aria-label={t("docsInsert.seeAll")}
                    data-tip={t("docsInsert.seeAll")}
                    onClick={() => expand(sec.section)}
                  >
                    <ChevronRightIcon />
                  </button>
                )}
              </div>
            )}
            {sec.rows.map((item) => {
              index += 1;
              const mine = index;
              return (
                <button
                  key={item.key}
                  type="button"
                  role="option"
                  aria-selected={mine === current}
                  aria-disabled={Boolean(item.disabled)}
                  data-tip={item.disabled}
                  className={`docs-at-row${mine === current ? " is-active" : ""}${item.sub ? " is-two-line" : ""}`}
                  onMouseMove={() => mine !== current && setHighlight(mine)}
                  onClick={() => choose(item)}
                >
                  <span className="docs-at-icon">{item.icon}</span>
                  <span className="docs-at-text">
                    <span className="docs-at-label">
                      <Marked label={item.label} query={colon ? `:${q}` : q} />
                    </span>
                    {item.sub && <span className="docs-at-sub">{item.sub}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {loading && <div className="docs-at-state">{t("common.loading")}</div>}
        {failed && <div className="docs-at-state">{t("docsInsert.cantRetrieve")}</div>}
        {!loading && !failed && flat.length === 0 && <div className="docs-at-state">{t("docsInsert.noResults")}</div>}
      </div>
    </FloatingBox>
  );
}

/** The picker an item opened, at the place of its "@query". `done` puts the
    caret back there, then runs what was picked. */
function PickerBox({
  editor,
  ctx,
  kind,
  at,
  done,
}: {
  editor: Editor;
  ctx: InsertContext;
  kind: PickerKind;
  at: number;
  done: (run?: () => void) => void;
}) {
  const t = useT();
  const anchor = anchorAt(editor, at);
  if (!anchor) return null;
  const pickers: Record<PickerKind, () => ReactNode> = {
    date: () => <DatePicker onPick={(iso, time) => done(() => insertDateChip(editor, iso, ctx.lang, { time }))} />,
    dropdown: () => (
      <DropdownPicker
        editor={editor}
        onPick={(d) => done(() => insertDropdownChip(editor, d))}
        onEdit={(dropdownId) => done(() => emitInsert(editor, { type: "dropdown-dialog", dropdownId }))}
      />
    ),
    table: () => <TableGridPicker onPick={(rows, cols) => done(() => editor.chain().focus().insertDocsTable(rows, cols).run())} />,
    emoji: () => <EmojiPicker onPick={(char) => done(() => insertInline(editor, { type: "text", text: char }))} />,
    image: () => <ImageSourcePicker onPick={(source) => done(() => insertImageFrom(editor, source))} />,
    toc: () => <TocStyles onPick={(style) => done(() => insertTableOfContents(editor, style, null))} />,
    code: () => (
      <div className="docs-code-langs" role="menu" aria-label={t("docsInsert.codeLanguage")}>
        <div className="docs-at-section">{t("docsInsert.codeLanguage")}</div>
        {[["", t("docsInsert.plainText")], ...CODE_LANGUAGES].map(([id, name]) => (
          <button key={id || "plain"} type="button" className="docs-at-row" onClick={() => done(() => insertCodeBlock(editor, id || null, null))}>
            <span className="docs-at-icon">
              <CodeIcon />
            </span>
            <span className="docs-at-label">{name}</span>
          </button>
        ))}
      </div>
    ),
  };
  return (
    <FloatingBox anchor={anchor} className={`docs-picker docs-picker-${kind}`} onDismiss={() => done()}>
      {pickers[kind]()}
    </FloatingBox>
  );
}
