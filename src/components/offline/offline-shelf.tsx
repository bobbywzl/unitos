"use client";

import { useEffect, useState } from "react";
import { useLang, useT } from "@/components/lang-provider";
import { listSaved, subscribeSaved, type SavedProject } from "@/lib/offline/saved";

// The offline page's shelf (SPEC.md §17, Unitos Ultra): the projects this
// browser holds a copy of, this account's only, newest copy first. A plain
// link opens each one as a full page load, which the service worker answers
// from the copy. When the browser is back online the page goes to Projects.
export function OfflineShelf() {
  const t = useT();
  const lang = useLang();
  const [rows, setRows] = useState<SavedProject[] | null>(null);

  useEffect(() => {
    const update = () => void listSaved().then(setRows);
    update();
    const online = () => window.location.replace("/");
    window.addEventListener("online", online);
    const unsubscribe = subscribeSaved(update);
    return () => {
      window.removeEventListener("online", online);
      unsubscribe();
    };
  }, []);

  const dateOf = (at: number) =>
    new Date(at).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    });

  return (
    <>
      <h1 className="mb-3 text-[34px] sm:text-[46px]">{t("common.offlineTitle")}</h1>
      <p className="mb-11 max-w-[560px] text-sm text-sand-700">{t("common.offlinePageBody")}</p>
      {rows && rows.length === 0 && (
        <p className="max-w-[560px] rounded-2xl bg-card p-5 text-sm text-sand-700 shadow-soft">
          {t("common.offlineEmpty")}
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {rows.map((row) => (
            <li key={row.id} className="relative list-none">
              <a
                href={`/n/${row.id}`}
                className="relative flex aspect-[5.5/8.5] flex-col rounded-[18px] bg-sand-100 px-[18px] pt-6 pb-[18px] text-center shadow-soft transition-[transform,box-shadow] duration-300 hover:-translate-y-[5px] hover:shadow-lift"
              >
                <span
                  aria-hidden
                  className="absolute top-3 bottom-3 left-[13px] w-[3px] rounded-full bg-sand-300"
                />
                <span className="mt-14 px-2 font-display text-[22px] leading-[1.25]">{row.title}</span>
                <span className="mt-1.5 px-2 text-xs text-sand-600">
                  {t("common.offlineSavedAt", { date: dateOf(row.savedAt) })}
                </span>
                <span aria-hidden className="mx-auto mt-4 size-2 rounded-full bg-sage-500" />
                <span className="mt-auto flex flex-wrap justify-center gap-1.5">
                  <span className="rounded-full bg-sand-200 px-3 py-1 text-xs font-semibold text-sand-700">
                    {t(row.sectionCount === 1 ? "works.sectionCountOne" : "works.sectionCountOther", {
                      n: row.sectionCount,
                    })}
                  </span>
                  <span className="rounded-full bg-sand-200 px-3 py-1 text-xs font-semibold text-sand-700">
                    {t(
                      row.documentCount === 1 ? "works.documentCountOne" : "works.documentCountOther",
                      { n: row.documentCount },
                    )}
                  </span>
                  <span className="rounded-full bg-sage-200 px-3 py-1 text-xs font-semibold text-sage-800">
                    {t("works.offlineBadge")}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
