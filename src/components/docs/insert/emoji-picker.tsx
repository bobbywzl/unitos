"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { SearchIcon } from "@/components/docs/icons";
import type { EmojiEntry, EmojiGroup } from "@/components/docs/insert/emoji-data";
import { focusSoon } from "@/components/docs/insert/ui";
import type { TKey } from "@/lib/i18n/dictionaries";

// Google Docs' emoji picker (SPEC.md §29): a search field, a row of nine
// groups (the current one blue), each group under its uppercase title in a
// grid of nine a row, and the reader's frequently used emoji at the foot.

type Data = { EMOJIS: EmojiEntry[]; EMOJI_GROUPS: EmojiGroup[]; searchEmojis: (q: string, limit?: number) => EmojiEntry[] };

let loaded: Promise<Data> | null = null;

/** The emoji list, loaded once on first use. */
function loadEmojis(): Promise<Data> {
  if (!loaded) {
    loaded = import("@/components/docs/insert/emoji-data").catch((err: unknown) => {
      loaded = null;
      throw err;
    });
  }
  return loaded;
}

/** The emoji list once loaded: null while it loads, "error" when it cannot. */
export function useEmojiData(): Data | null | "error" {
  const [data, setData] = useState<Data | null | "error">(null);
  useEffect(() => {
    let live = true;
    loadEmojis().then(
      (d) => live && setData(d),
      () => live && setData("error"),
    );
    return () => {
      live = false;
    };
  }, []);
  return data;
}

const GROUP_LABEL: Record<EmojiGroup, TKey> = {
  smileys: "docsInsert.emojiSmileys",
  people: "docsInsert.emojiPeople",
  animals: "docsInsert.emojiAnimals",
  food: "docsInsert.emojiFood",
  travel: "docsInsert.emojiTravel",
  activities: "docsInsert.emojiActivities",
  objects: "docsInsert.emojiObjects",
  symbols: "docsInsert.emojiSymbols",
  flags: "docsInsert.emojiFlags",
};

const GROUP_ICON: Record<EmojiGroup, string> = {
  smileys: "😀",
  people: "👋",
  animals: "🐻",
  food: "🍔",
  travel: "✈️",
  activities: "⚽",
  objects: "💡",
  symbols: "❤️",
  flags: "🏁",
};

const RECENT_KEY = "unitos.docs.recentEmoji";

function readRecent(): string[] {
  try {
    const list: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((e): e is string => typeof e === "string").slice(0, 9) : [];
  } catch {
    return [];
  }
}

/** Remember an emoji as frequently used. */
export function rememberEmoji(char: string) {
  try {
    const next = [char, ...readRecent().filter((e) => e !== char)].slice(0, 9);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // Storage off: the row stays as it was.
  }
}

export function EmojiPicker({ onPick }: { onPick: (char: string) => void }) {
  const t = useT();
  const data = useEmojiData();
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<EmojiGroup>("smileys");
  const [recent] = useState<string[]>(() => (typeof window === "undefined" ? [] : readRecent()));
  const gridRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    focusSoon(searchRef.current);
  }, []);

  const byGroup = useMemo(() => {
    if (!data || data === "error") return null;
    const map = new Map<EmojiGroup, EmojiEntry[]>();
    for (const g of data.EMOJI_GROUPS) map.set(g, []);
    for (const e of data.EMOJIS) map.get(e.group)?.push(e);
    return map;
  }, [data]);

  const results = useMemo(() => {
    if (!data || data === "error" || !query.trim()) return null;
    return data.searchEmojis(query, 180);
  }, [data, query]);

  const pick = (char: string) => {
    rememberEmoji(char);
    onPick(char);
  };

  const button = (e: EmojiEntry) => (
    <button
      key={e.code + e.char}
      type="button"
      className="docs-emoji-cell"
      aria-label={`:${e.code}:`}
      data-tip={`:${e.code}:`}
      onClick={() => pick(e.char)}
    >
      {e.char}
    </button>
  );

  return (
    <div className="docs-emoji-picker">
      <label className="docs-emoji-search">
        <SearchIcon size={20} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("docsInsert.searchEmojis")}
          aria-label={t("docsInsert.searchEmojis")}
        />
      </label>
      {!query && (
        <div className="docs-emoji-groups" role="tablist">
          {(Object.keys(GROUP_ICON) as EmojiGroup[]).map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={group === g}
              className={`docs-emoji-group${group === g ? " is-on" : ""}`}
              aria-label={t(GROUP_LABEL[g])}
              data-tip={t(GROUP_LABEL[g])}
              onClick={() => {
                setGroup(g);
                gridRef.current?.querySelector(`[data-group="${g}"]`)?.scrollIntoView({ block: "start" });
              }}
            >
              {GROUP_ICON[g]}
            </button>
          ))}
        </div>
      )}
      <div
        ref={gridRef}
        className="docs-emoji-scroll"
        onScroll={(e) => {
          if (query) return;
          const top = e.currentTarget.getBoundingClientRect().top;
          let current: EmojiGroup = "smileys";
          for (const el of e.currentTarget.querySelectorAll<HTMLElement>("[data-group]")) {
            if (el.getBoundingClientRect().top - top <= 8) current = el.dataset.group as EmojiGroup;
          }
          if (current !== group) setGroup(current);
        }}
      >
        {data === null && <div className="docs-emoji-state">{t("common.loading")}</div>}
        {data === "error" && <div className="docs-emoji-state">{t("docsInsert.cantRetrieve")}</div>}
        {results && results.length === 0 && <div className="docs-emoji-state">{t("docsInsert.noResults")}</div>}
        {results && results.length > 0 && <div className="docs-emoji-grid">{results.map(button)}</div>}
        {!results &&
          byGroup &&
          [...byGroup.entries()].map(([g, list]) => (
            <section key={g} data-group={g}>
              <h3 className="docs-emoji-title">{t(GROUP_LABEL[g])}</h3>
              <div className="docs-emoji-grid">{list.map(button)}</div>
            </section>
          ))}
      </div>
      {recent.length > 0 && (
        <div className="docs-emoji-recent" aria-label={t("docsInsert.frequentlyUsed")}>
          {recent.map((char) => (
            <button key={char} type="button" className="docs-emoji-cell" onClick={() => pick(char)}>
              {char}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
