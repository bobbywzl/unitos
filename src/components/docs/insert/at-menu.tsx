"use client";

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCollab } from "@/components/collab/collab-context";
import { useT } from "@/components/lang-provider";
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
import { DOCS_EVENT } from "@/components/docs/extensions";
import {
  insertBookmark,
  insertCodeBlock,
  insertDateChip,
  insertDropdownChip,
  insertEquation,
  insertFileChip,
  insertFootnoteAt,
  insertInline,
  insertPersonChip,
  insertTableOfContents,
  replaceQuery,
  type Range,
} from "@/components/docs/insert/actions";
import { atMenuState, closeAtMenu, setAtKeyHandler, type AtState } from "@/components/docs/insert/at-plugin";
import { buildingBlock, type BuildingBlock } from "@/components/docs/insert/building-blocks";
import { emitInsert, type InsertContext } from "@/components/docs/insert/context";
import { DatePicker } from "@/components/docs/insert/date-picker";
import { matchDates } from "@/components/docs/insert/dates";
import { DropdownPicker } from "@/components/docs/insert/dropdown-ui";
import { EmojiPicker, rememberEmoji, useEmojiData } from "@/components/docs/insert/emoji-picker";
import {
  AssignmentIcon,
  BookmarkIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CodeIcon,
  DropdownChipIcon,
  EmailIcon,
  EventIcon,
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
import { TOC_STYLES, type TocStyle } from "@/components/docs/insert/toc";
import { anchorAt, FloatingBox, useEditorTick, useViewportTick } from "@/components/docs/insert/ui";
import type { Person } from "@/lib/person";
import type { TKey } from "@/lib/i18n/dictionaries";

// The "@" menu (SPEC.md §29), Google Docs' insert menu: under the typed "@",
// sections with uppercase headers — People, Smart chips, Building blocks,
// Files, Lists, Media, Headings, Tables, Page components, More; Dates and
// Emojis appear while searching — filtered by the words typed after the
// "@", the matching letters in bold. ↑/↓ move, Enter or Tab inserts, →
// opens a section's full list and ← comes back, Escape closes and keeps the
// typed words. An item deletes the "@query" and inserts, or opens its
// picker at the same place: a date, a dropdown, a table's grid, emoji, an
// image's sources, a table of contents' styles, a code block's language.

type Section =
  | "people"
  | "dates"
  | "chips"
  | "blocks"
  | "files"
  | "emojis"
  | "lists"
  | "media"
  | "headings"
  | "tables"
  | "page"
  | "more";

type PickerKind = "date" | "dropdown" | "table" | "emoji" | "image" | "toc" | "code";

type Item = {
  key: string;
  section: Section;
  label: string;
  sub?: string;
  /** More words that find the item, lowercase, both languages. */
  words?: string;
  icon: ReactNode;
  /** The item opens a picker instead of inserting at once. */
  picker?: PickerKind;
  run?: (range: Range) => void;
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

export const CODE_LANGUAGES: { id: string; name: string }[] = [
  { id: "bash", name: "Bash" },
  { id: "c", name: "C" },
  { id: "cpp", name: "C++" },
  { id: "csharp", name: "C#" },
  { id: "css", name: "CSS" },
  { id: "go", name: "Go" },
  { id: "html", name: "HTML" },
  { id: "java", name: "Java" },
  { id: "javascript", name: "JavaScript" },
  { id: "json", name: "JSON" },
  { id: "kotlin", name: "Kotlin" },
  { id: "php", name: "PHP" },
  { id: "protobuf", name: "Protobuf" },
  { id: "python", name: "Python" },
  { id: "rust", name: "Rust" },
  { id: "sql", name: "SQL" },
  { id: "typescript", name: "TypeScript" },
  { id: "xml", name: "XML" },
];

export function Avatar({ person, size = 24 }: { person: Pick<Person, "name" | "symbol" | "color" | "picture">; size?: number }) {
  return person.picture ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={person.picture} alt="" className="docs-avatar" style={{ width: size, height: size }} />
  ) : (
    <span className="docs-avatar" style={{ width: size, height: size, backgroundColor: person.color, fontSize: size * 0.45 }}>
      {person.symbol}
    </span>
  );
}

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
  const label = item.label.toLowerCase();
  if (label.startsWith(q)) return 4;
  if (label.split(/[\s/&(),.-]+/).some((w) => w.startsWith(q))) return 3;
  if (label.includes(q)) return 2;
  if ((item.words ?? "").split(" ").some((w) => w && (w.startsWith(q) || q.startsWith(w) && w.length > 2))) return 1;
  return 0;
}

type Picker = { kind: PickerKind; at: number };

export function AtMenuHost({ editor, ctx }: { editor: Editor; ctx: InsertContext }) {
  useEditorTick(editor);
  const s = atMenuState(editor.state);
  const [picker, setPicker] = useState<Picker | null>(null);
  useViewportTick(s.active || picker !== null);

  // A picker's place follows the edits made while it is open.
  const pickerRef = useRef<Picker | null>(null);
  useLayoutEffect(() => {
    pickerRef.current = picker;
  });
  useEffect(() => {
    const onTr = ({ transaction }: { transaction: { docChanged: boolean; mapping: { map: (p: number) => number } } }) => {
      const p = pickerRef.current;
      if (p && transaction.docChanged) setPicker({ ...p, at: transaction.mapping.map(p.at) });
    };
    editor.on("transaction", onTr);
    return () => {
      editor.off("transaction", onTr);
    };
  }, [editor]);

  const closePicker = useCallback(() => {
    setPicker(null);
    editor.commands.focus();
  }, [editor]);

  if (picker) return <PickerBox editor={editor} ctx={ctx} picker={picker} onClose={closePicker} />;
  if (!s.active) return null;
  return <AtMenu editor={editor} ctx={ctx} state={s} onPicker={setPicker} />;
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
  onPicker: (picker: Picker) => void;
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
    const out: Item[] = [];
    if (colon) {
      if (emoji && emoji !== "error" && q) {
        for (const e of emoji.searchEmojis(q, 40)) {
          out.push({
            key: `emoji-${e.code}`,
            section: "emojis",
            label: `:${e.code}:`,
            icon: <span className="docs-at-emoji">{e.char}</span>,
            matched: true,
            run: (range) => {
              rememberEmoji(e.char);
              insertInline(editor, { type: "text", text: e.char }, range);
            },
          });
        }
      }
      return out;
    }
    // People: the project's collaborators; the signed-in person answers "@me".
    for (const person of Object.values(collab.people)) {
      const me = person.id === collab.myId;
      out.push({
        key: `person-${person.id}`,
        section: "people",
        label: person.name,
        sub: me ? t("docsInsert.me") : undefined,
        words: me ? "me 我" : "",
        icon: <Avatar person={person} size={24} />,
        run: (range) => insertPersonChip(editor, person, range),
      });
    }
    // Smart chips.
    out.push(
      { key: "date", section: "chips", label: t("docsInsert.itemDate"), words: "date calendar 日期", icon: <EventIcon />, picker: "date" },
      {
        key: "dropdown",
        section: "chips",
        label: t("docsInsert.itemDropdown"),
        words: "dropdown status select 下拉",
        icon: <DropdownChipIcon />,
        picker: "dropdown",
      },
    );
    // Dates: the words typed name a day.
    if (q) {
      for (const d of matchDates(state.query, lang)) {
        out.push({
          key: `date-${d.iso}`,
          section: "dates",
          label: new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-US", { dateStyle: "medium" }).format(
            new Date(`${d.iso}T12:00:00`),
          ),
          sub: d.hint,
          icon: <CalendarIcon />,
          matched: true,
          run: (range) => insertDateChip(editor, d.iso, lang, { range }),
        });
      }
    }
    // Building blocks.
    const blocks: [BuildingBlock, TKey, ReactNode, string][] = [
      ["meetingNotes", "docsInsert.itemMeetingNotes", <MeetingNotesIcon key="i" />, "meeting notes agenda 会议 记录"],
      ["emailDraft", "docsInsert.itemEmailDraft", <EmailIcon key="i" />, "email mail draft 邮件"],
      ["productRoadmap", "docsInsert.itemProductRoadmap", <MapIcon key="i" />, "roadmap product table 路线图"],
      ["reviewTracker", "docsInsert.itemReviewTracker", <AssignmentIcon key="i" />, "review tracker table 审核"],
      ["taskTracker", "docsInsert.itemTaskTracker", <TaskIcon key="i" />, "task tracker todo table 任务"],
    ];
    for (const [kind, key, icon, words] of blocks) {
      out.push({
        key: `block-${kind}`,
        section: "blocks",
        label: t(key),
        words,
        icon,
        run: (range) => replaceQuery(editor, range, () => editor.chain().focus().insertContent(buildingBlock(kind, t, lang)).run()),
      });
    }
    // Files: the project's other documents.
    for (const doc of ctx.documents) {
      if (doc.id === ctx.documentId) continue;
      out.push({
        key: `file-${doc.id}`,
        section: "files",
        label: doc.title,
        icon: <DocIcon className="docs-at-doc-icon" />,
        run: (range) => insertFileChip(editor, doc, ctx.notebookId, range),
      });
    }
    // Emojis while searching.
    if (q && emoji && emoji !== "error") {
      for (const e of emoji.searchEmojis(q, 12)) {
        out.push({
          key: `emoji-${e.code}`,
          section: "emojis",
          label: `:${e.code}:`,
          icon: <span className="docs-at-emoji">{e.char}</span>,
          matched: true,
          run: (range) => {
            rememberEmoji(e.char);
            insertInline(editor, { type: "text", text: e.char }, range);
          },
        });
      }
    }
    const list = (kind: "task" | "bullet" | "ordered") => (range: Range) =>
      replaceQuery(editor, range, () => {
        const c = editor.chain().focus();
        if (kind === "task" && !editor.isActive("taskList")) c.toggleTaskList().run();
        if (kind === "bullet" && !editor.isActive("bulletList")) c.toggleBulletList().run();
        if (kind === "ordered" && !editor.isActive("orderedList")) c.toggleOrderedList().run();
      });
    out.push(
      { key: "checklist", section: "lists", label: t("docs.checklist"), words: "checklist todo task 清单", icon: <ChecklistIcon />, run: list("task") },
      { key: "bullets", section: "lists", label: t("docs.bulletedList"), words: "bulleted list bullets 列表", icon: <BulletListIcon />, run: list("bullet") },
      { key: "numbers", section: "lists", label: t("docs.numberedList"), words: "numbered list ordered 编号", icon: <NumberedListIcon />, run: list("ordered") },
      { key: "image", section: "media", label: t("docsInsert.itemImage"), words: "image picture photo 图片 照片", icon: <ImageIcon />, picker: "image" },
      { key: "emoji", section: "media", label: t("docsInsert.itemEmoji"), words: "emoji smiley 表情", icon: <MoodIcon />, picker: "emoji" },
    );
    const style = (docStyle: "title" | "subtitle" | "h1" | "h2" | "h3" | "normal") => (range: Range) =>
      replaceQuery(editor, range, () => editor.chain().focus().setDocStyle(docStyle).run());
    out.push(
      { key: "title", section: "headings", label: t("docs.styleTitle"), words: "title heading 标题", icon: <TitleIcon />, run: style("title") },
      { key: "subtitle", section: "headings", label: t("docs.styleSubtitle"), words: "subtitle 副标题", icon: <TitleIcon />, run: style("subtitle") },
      { key: "h1", section: "headings", label: t("docs.styleHeading1"), words: "heading h1 标题", icon: <TitleIcon />, run: style("h1") },
      { key: "h2", section: "headings", label: t("docs.styleHeading2"), words: "heading h2 标题", icon: <TitleIcon />, run: style("h2") },
      { key: "h3", section: "headings", label: t("docs.styleHeading3"), words: "heading h3 标题", icon: <TitleIcon />, run: style("h3") },
      { key: "normal", section: "headings", label: t("docs.styleNormal"), words: "normal text paragraph 正文", icon: <TitleIcon />, run: style("normal") },
      { key: "table", section: "tables", label: t("docsInsert.itemTable"), words: "table grid 表格", icon: <TableIcon />, picker: "table" },
      {
        key: "pagebreak",
        section: "page",
        label: t("docsInsert.itemPageBreak"),
        words: "page break 分页",
        icon: <PageBreakIcon />,
        disabled: ctx.pageSetup.pageless ? t("docsInsert.pagesOnly") : undefined,
        run: (range) => replaceQuery(editor, range, () => editor.chain().focus().setPageBreak().run()),
      },
      {
        key: "hr",
        section: "more",
        label: t("docsInsert.itemHorizontalLine"),
        words: "horizontal line rule divider hr 分隔线 横线",
        icon: <HorizontalRuleIcon />,
        run: (range) => replaceQuery(editor, range, () => editor.chain().focus().setHorizontalRule().run()),
      },
      { key: "toc", section: "more", label: t("docsInsert.itemTableOfContents"), words: "table of contents toc 目录", icon: <OutlineIcon />, picker: "toc" },
      {
        key: "bookmark",
        section: "more",
        label: t("docsInsert.itemBookmark"),
        words: "bookmark anchor 书签 锚点",
        icon: <BookmarkIcon />,
        run: (range) => insertBookmark(editor, range),
      },
      { key: "footnote", section: "more", label: t("docsInsert.itemFootnote"), words: "footnote note 脚注", icon: <FootnoteIcon />, run: (range) => insertFootnoteAt(editor, range) },
      {
        key: "equation",
        section: "more",
        label: t("docsInsert.itemEquation"),
        words: "equation math formula latex 公式 数学",
        icon: <FunctionsIcon />,
        run: (range) => {
          const pos = insertEquation(editor, range);
          if (pos !== null) emitInsert(editor, { type: "equation", pos });
        },
      },
      {
        key: "special",
        section: "more",
        label: t("docsInsert.itemSpecialCharacters"),
        words: "special characters symbols omega 特殊 符号",
        icon: <span className="docs-at-glyph">Ω</span>,
        run: (range) => replaceQuery(editor, range, () => emitInsert(editor, { type: "special-characters" })),
      },
      {
        key: "link",
        section: "more",
        label: t("docsInsert.itemLink"),
        words: "link url hyperlink 链接",
        icon: <LinkIcon />,
        run: (range) => replaceQuery(editor, range, () => window.dispatchEvent(new CustomEvent(DOCS_EVENT.link))),
      },
      { key: "code", section: "more", label: t("docsInsert.itemCodeBlock"), words: "code block snippet 代码", icon: <CodeIcon />, picker: "code" },
    );
    return out;
  }, [colon, emoji, q, state.query, collab.people, collab.myId, ctx, editor, t]);

  // The sections to show, each with its rows.
  const sections = useMemo(() => {
    const order = colon ? (["emojis"] as Section[]) : q ? ORDER_QUERY : ORDER_EMPTY;
    const out: { section: Section; rows: Item[]; more: boolean }[] = [];
    for (const section of expanded ? [expanded] : order) {
      if (!q && (section === "dates" || section === "emojis") && !colon) continue;
      const matched = items
        .filter((i) => i.section === section)
        .map((i, index) => ({ i, index, s: score(i, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || a.index - b.index)
        .map((x) => x.i);
      if (matched.length === 0) continue;
      const limit = colon ? 8 : SECTION_LIMIT[section] ?? 0;
      const more = limit > 0 && matched.length > limit;
      out.push({ section, rows: expanded || !more ? matched : matched.slice(0, limit), more: more && !expanded });
    }
    return out;
  }, [items, q, expanded, colon]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const current = Math.min(highlight, Math.max(0, flat.length - 1));

  const choose = useCallback(
    (item: Item | undefined) => {
      if (!item || item.disabled) return;
      const range = { ...state.range };
      closeAtMenu(editor.view);
      if (item.picker) {
        if (range.to > range.from) editor.chain().focus().deleteRange(range).run();
        onPicker({ kind: item.picker, at: range.from });
        return;
      }
      item.run?.(range);
    },
    [editor, onPicker, state.range],
  );

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
        const row = k.flat[k.current];
        const section = k.sections.find((s) => s.rows.includes(row as Item));
        if (section?.more) {
          setExpanded(section.section);
          setHighlight(0);
          return true;
        }
        return false;
      }
      if (e.key === "ArrowLeft" && k.expanded) {
        setExpanded(null);
        setHighlight(0);
        return true;
      }
      if (e.key === "Escape") {
        closeAtMenu(view);
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
  if (!anchor) return null;
  // ":" shows nothing until a letter is typed.
  if (colon && !q) return null;
  const loading = (colon || (q && flat.length === 0)) && emoji === null;
  const failed = colon && emoji === "error";
  if (colon && !loading && !failed && flat.length === 0) return null;
  let index = -1;
  return (
    <FloatingBox anchor={anchor} className="docs-at-menu" role="listbox" label={t("docsInsert.insertMenu")} onDismiss={() => closeAtMenu(editor.view)}>
      <div ref={listRef} className="docs-at-scroll">
        {expanded && (
          <button
            type="button"
            className="docs-at-back"
            onClick={() => {
              setExpanded(null);
              setHighlight(0);
            }}
          >
            <ChevronLeftIcon size={20} />
            <span>{t(SECTION_TITLE[expanded])}</span>
          </button>
        )}
        {sections.map((sec) => (
          <div key={sec.section} className="docs-at-group" role="group" aria-label={t(SECTION_TITLE[sec.section])}>
            {!expanded && (
              <div className="docs-at-section">
                <span>{t(SECTION_TITLE[sec.section])}</span>
                {sec.more && (
                  <button
                    type="button"
                    className="docs-at-more"
                    aria-label={t("docsInsert.seeAll")}
                    data-tip={t("docsInsert.seeAll")}
                    onClick={() => {
                      setExpanded(sec.section);
                      setHighlight(0);
                    }}
                  >
                    <ChevronRightIcon size={20} />
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
                  className={`docs-at-row${mine === current ? " is-active" : ""}${item.sub ? " is-two-line" : ""}${item.disabled ? " is-disabled" : ""}`}
                  onMouseEnter={() => setHighlight(mine)}
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
        {loading && <div className="docs-at-state">{t("docsInsert.loading")}</div>}
        {failed && <div className="docs-at-state">{t("docsInsert.cantRetrieve")}</div>}
        {!loading && !failed && flat.length === 0 && <div className="docs-at-state">{t("docsInsert.noResults")}</div>}
      </div>
    </FloatingBox>
  );
}

/** The picker an item opened, at the place of its "@query". */
function PickerBox({ editor, ctx, picker, onClose }: { editor: Editor; ctx: InsertContext; picker: Picker; onClose: () => void }) {
  const t = useT();
  const anchor = anchorAt(editor, picker.at);
  const here: Range = { from: picker.at, to: picker.at };
  const caretHere = () => {
    const pos = Math.min(picker.at, editor.state.doc.content.size);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(pos))));
    editor.view.focus();
  };
  if (!anchor) return null;
  let body: ReactNode = null;
  switch (picker.kind) {
    case "date":
      body = (
        <DatePicker
          onPick={(iso, time) => {
            onClose();
            insertDateChip(editor, iso, ctx.lang, { range: here, time });
          }}
        />
      );
      break;
    case "dropdown":
      body = (
        <DropdownPicker
          editor={editor}
          onPick={(d) => {
            onClose();
            insertDropdownChip(editor, d, here);
          }}
          onNew={() => {
            onClose();
            caretHere();
            emitInsert(editor, { type: "dropdown-dialog", dropdownId: null, chipPos: null });
          }}
          onEdit={(id) => {
            onClose();
            caretHere();
            emitInsert(editor, { type: "dropdown-dialog", dropdownId: id, chipPos: null });
          }}
        />
      );
      break;
    case "table":
      body = (
        <TableGridPicker
          onPick={(rows, cols) => {
            onClose();
            caretHere();
            editor.chain().focus().insertDocsTable(rows, cols).run();
          }}
        />
      );
      break;
    case "emoji":
      body = (
        <EmojiPicker
          onPick={(char) => {
            onClose();
            insertInline(editor, { type: "text", text: char }, here);
          }}
        />
      );
      break;
    case "image":
      body = (
        <ImageSourcePicker
          onFile={(file) => {
            onClose();
            caretHere();
            void insertImageFrom(editor, { file });
          }}
          onUrl={(url) => {
            onClose();
            caretHere();
            void insertImageFrom(editor, { url });
          }}
        />
      );
      break;
    case "toc":
      body = (
        <div className="docs-toc-styles" role="menu">
          {TOC_STYLES.map((style: TocStyle) => (
            <button
              key={style}
              type="button"
              className="docs-toc-style"
              aria-label={t(style === "plain" ? "docsInsert.tocPlain" : style === "dotted" ? "docsInsert.tocDotted" : "docsInsert.tocLinks")}
              data-tip={t(style === "plain" ? "docsInsert.tocPlain" : style === "dotted" ? "docsInsert.tocDotted" : "docsInsert.tocLinks")}
              onClick={() => {
                onClose();
                insertTableOfContents(editor, style, here);
              }}
            >
              <TocThumb style={style} />
            </button>
          ))}
        </div>
      );
      break;
    case "code":
      body = (
        <div className="docs-code-langs" role="menu" aria-label={t("docsInsert.codeLanguage")}>
          <div className="docs-at-section">
            <span>{t("docsInsert.codeLanguage")}</span>
          </div>
          {[{ id: "", name: t("docsInsert.plainText") }, ...CODE_LANGUAGES].map((l) => (
            <button
              key={l.id || "plain"}
              type="button"
              className="docs-at-row"
              onClick={() => {
                onClose();
                insertCodeBlock(editor, l.id || null, here);
              }}
            >
              <span className="docs-at-icon">
                <CodeIcon />
              </span>
              <span className="docs-at-label">{l.name}</span>
            </button>
          ))}
        </div>
      );
      break;
  }
  return (
    <FloatingBox anchor={anchor} className={`docs-picker docs-picker-${picker.kind}`} onDismiss={onClose}>
      {body}
    </FloatingBox>
  );
}

/** A table of contents style, drawn small: lines, dots, or blue links. */
export function TocThumb({ style }: { style: TocStyle }) {
  return (
    <span className={`docs-toc-thumb docs-toc-thumb-${style}`} aria-hidden>
      {[0, 1, 1, 0, 1].map((level, i) => (
        <span key={i} className="docs-toc-thumb-line" data-level={level}>
          <span className="docs-toc-thumb-text" />
          {style !== "links" && <span className="docs-toc-thumb-leader" />}
          {style !== "links" && <span className="docs-toc-thumb-num" />}
        </span>
      ))}
    </span>
  );
}
