"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import {
  categoryFallback,
  DOCS_FONTS,
  fontStack,
  loadGoogleFont,
  setUserFonts,
  userFonts,
  type UserFont,
} from "@/components/docs/fonts";
import { CheckIcon, CloseIcon, SearchIcon } from "@/components/docs/icons";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { googleFonts, SCRIPTS, type FontCategory, type GoogleFont, type Script } from "@/components/docs/toolbar/google-fonts";
import type { TKey } from "@/lib/i18n/dictionaries";

// The Fonts dialog (More fonts, SPEC.md §29): Google Fonts' families,
// searched, filtered by script and kind, and sorted as Google Docs sorts
// them; a press on a family adds it to My fonts or takes it out. OK keeps
// My fonts in this browser, and the font menu lists them.

const SCRIPT_KEYS: Record<Script, TKey> = {
  arabic: "docs.scriptArabic",
  bengali: "docs.scriptBengali",
  "chinese-hongkong": "docs.scriptChineseHongKong",
  "chinese-simplified": "docs.scriptChineseSimplified",
  "chinese-traditional": "docs.scriptChineseTraditional",
  cyrillic: "docs.scriptCyrillic",
  "cyrillic-ext": "docs.scriptCyrillicExtended",
  devanagari: "docs.scriptDevanagari",
  greek: "docs.scriptGreek",
  "greek-ext": "docs.scriptGreekExtended",
  gujarati: "docs.scriptGujarati",
  gurmukhi: "docs.scriptGurmukhi",
  hebrew: "docs.scriptHebrew",
  japanese: "docs.scriptJapanese",
  kannada: "docs.scriptKannada",
  khmer: "docs.scriptKhmer",
  korean: "docs.scriptKorean",
  latin: "docs.scriptLatin",
  "latin-ext": "docs.scriptLatinExtended",
  malayalam: "docs.scriptMalayalam",
  myanmar: "docs.scriptMyanmar",
  oriya: "docs.scriptOriya",
  sinhala: "docs.scriptSinhala",
  tamil: "docs.scriptTamil",
  telugu: "docs.scriptTelugu",
  thai: "docs.scriptThai",
  tibetan: "docs.scriptTibetan",
  vietnamese: "docs.scriptVietnamese",
};

const SHOWS: { value: FontCategory | "all"; key: TKey }[] = [
  { value: "all", key: "docs.showAllFonts" },
  { value: "display", key: "docs.showDisplay" },
  { value: "handwriting", key: "docs.showHandwriting" },
  { value: "monospace", key: "docs.showMonospace" },
  { value: "serif", key: "docs.showSerif" },
  { value: "sans-serif", key: "docs.showSansSerif" },
];

type Sort = "popularity" | "alphabetical" | "added" | "trending";
const SORTS: { value: Sort; key: TKey }[] = [
  { value: "popularity", key: "docs.sortPopularity" },
  { value: "alphabetical", key: "docs.sortAlphabetical" },
  { value: "added", key: "docs.sortDateAdded" },
  { value: "trending", key: "docs.sortTrending" },
];

const PAGE = 120;

function FontRow({ font, mine, onToggle }: { font: GoogleFont; mine: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  // A family's name is drawn in the family once its row scrolls into view.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        loadGoogleFont(font.name, [400], true);
        observer.disconnect();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [font.name]);
  return (
    <button
      ref={ref}
      type="button"
      role="checkbox"
      aria-checked={mine}
      onClick={onToggle}
      className="docs-fonts-row"
      style={{ fontFamily: `'${font.name}', ${categoryFallback(font.category)}` }}
    >
      {mine && <CheckIcon size={20} />}
      {font.name}
    </button>
  );
}

export function FontsDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const all = useMemo(() => googleFonts(), []);
  const [query, setQuery] = useState("");
  const [script, setScript] = useState<Script | "all">("all");
  const [show, setShow] = useState<FontCategory | "all">("all");
  const [sort, setSort] = useState<Sort>("popularity");
  const [mine, setMine] = useState<UserFont[]>(() => userFonts());
  const [limit, setLimit] = useState(PAGE);
  const listRef = useRef<HTMLDivElement>(null);

  const defaults = useMemo(() => new Set(DOCS_FONTS.map((f) => f.name.toLowerCase())), []);
  const mineSet = new Set([...defaults, ...mine.map((f) => f.name.toLowerCase())]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const bit = script === "all" ? 0 : 1 << SCRIPTS.indexOf(script);
    const list = all.filter(
      (f) =>
        (!q || f.name.toLowerCase().includes(q)) &&
        (show === "all" || f.category === show) &&
        (bit === 0 || (f.scripts & bit) !== 0),
    );
    const sorted = [...list];
    if (sort === "alphabetical") sorted.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "added") sorted.sort((a, b) => b.added - a.added || a.popularity - b.popularity);
    else if (sort === "trending") sorted.sort((a, b) => a.trending - b.trending);
    return sorted;
  }, [all, query, script, show, sort]);

  // A new search starts at the top of the list.
  useEffect(() => {
    setLimit(PAGE);
    listRef.current?.scrollTo({ top: 0 });
  }, [query, script, show, sort]);

  const toggle = (font: GoogleFont) => {
    const key = font.name.toLowerCase();
    if (defaults.has(key)) return;
    setMine((list) =>
      list.some((f) => f.name.toLowerCase() === key)
        ? list.filter((f) => f.name.toLowerCase() !== key)
        : [...list, { name: font.name, fallback: categoryFallback(font.category), weights: font.weights }],
    );
  };

  const myList = [
    ...DOCS_FONTS.map((f) => ({ name: f.name, removable: false })),
    ...mine.map((f) => ({ name: f.name, removable: true })),
  ].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ToolbarDialog
      title={t("docs.fontsTitle")}
      onClose={onClose}
      className="docs-fonts-dialog"
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <DialogButton
            primary
            onClick={() => {
              setUserFonts(mine);
              for (const f of mine) loadGoogleFont(f.name, [400], true);
              onClose();
            }}
          >
            {t("docs.ok")}
          </DialogButton>
        </>
      }
    >
      <div className="docs-fonts-bar">
        <label className="docs-fonts-search">
          <SearchIcon size={20} />
          <input
            className="docs-tb-field"
            value={query}
            placeholder={t("docs.fontsSearch")}
            aria-label={t("docs.fontsSearch")}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="docs-fonts-clear" aria-label={t("docs.clearSearch")} onClick={() => setQuery("")}>
              <CloseIcon size={18} />
            </button>
          )}
        </label>
        <select
          className="docs-fonts-select"
          aria-label={t("docs.scripts")}
          value={script}
          onChange={(e) => setScript(e.target.value as Script | "all")}
        >
          <option value="all">{t("docs.allScripts")}</option>
          {[...SCRIPTS]
            .map((s) => ({ s, label: t(SCRIPT_KEYS[s]) }))
            .sort((a, b) => a.label.localeCompare(b.label))
            .map(({ s, label }) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
        </select>
        <select
          className="docs-fonts-select"
          aria-label={t("docs.show")}
          value={show}
          onChange={(e) => setShow(e.target.value as FontCategory | "all")}
        >
          {SHOWS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.key)}
            </option>
          ))}
        </select>
        <select
          className="docs-fonts-select"
          aria-label={t("docs.sort")}
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          {SORTS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.key)}
            </option>
          ))}
        </select>
      </div>
      <div className="docs-fonts-lists">
        <div
          ref={listRef}
          className="docs-fonts-all"
          onScroll={(e) => {
            const el = e.currentTarget;
            if (el.scrollTop + el.clientHeight > el.scrollHeight - 400 && limit < matches.length) setLimit((n) => n + PAGE);
          }}
        >
          {matches.length === 0 && <div className="docs-fonts-empty">{t("docs.noFonts")}</div>}
          {matches.slice(0, limit).map((f) => (
            <FontRow key={f.name} font={f} mine={mineSet.has(f.name.toLowerCase())} onToggle={() => toggle(f)} />
          ))}
        </div>
        <div className="docs-fonts-mine">
          <h3>{t("docs.myFonts")}</h3>
          <ul>
            {myList.map((f) => (
              <li key={f.name} style={{ fontFamily: fontStack(f.name) }}>
                <span>{f.name}</span>
                {f.removable && (
                  <button
                    type="button"
                    className="docs-fonts-remove"
                    aria-label={t("docs.removeFont", { name: f.name })}
                    data-tip={t("docs.removeFont", { name: f.name })}
                    onClick={() => setMine((list) => list.filter((m) => m.name !== f.name))}
                  >
                    <CloseIcon size={18} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ToolbarDialog>
  );
}
