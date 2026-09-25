"use client";

import { useState } from "react";
import { useT } from "@/components/lang-provider";
import { CloseIcon } from "@/components/docs/icons";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";
import { setTypingPrefs, typingPrefs, type Substitution, type TypingPrefs } from "@/components/docs/typing/prefs";
import type { TKey } from "@/lib/i18n/dictionaries";

// Tools > Preferences, Google Docs' dialog (SPEC.md §29, typing): the General
// tab's switches and the Substitutions tab's list — the master switch, a
// Replace / With row that adds a pair, each pair with its switch and a
// remove button. OK keeps the changes (in this browser); Cancel drops them.

type Tab = "general" | "substitutions";

const SWITCHES: { key: keyof TypingPrefs; label: TKey }[] = [
  { key: "autoCapitalize", label: "docsTyping.autoCapitalize" },
  { key: "smartQuotes", label: "docsTyping.smartQuotes" },
  { key: "detectLinks", label: "docsTyping.detectLinks" },
  { key: "detectLists", label: "docsTyping.detectLists" },
  { key: "markdown", label: "docsTyping.enableMarkdown" },
  { key: "correctSpelling", label: "docsTyping.correctSpelling" },
  { key: "colonEmoji", label: "docsTyping.colonEmoji" },
];

export function PreferencesDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("general");
  const [draft, setDraft] = useState<TypingPrefs>(() => typingPrefs());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const setPairs = (fn: (pairs: Substitution[]) => Substitution[]) => setDraft((d) => ({ ...d, substitutions: fn(d.substitutions) }));
  const addPair = () => {
    const key = from.trim();
    if (!key || !to) return;
    setPairs((pairs) => [{ from: key, to, enabled: true }, ...pairs.filter((s) => s.from.toLowerCase() !== key.toLowerCase())]);
    setFrom("");
    setTo("");
  };
  const save = () => {
    const key = from.trim();
    const pending = key && to ? [{ from: key, to, enabled: true }] : [];
    setTypingPrefs({ ...draft, substitutions: [...pending, ...draft.substitutions] });
    onClose();
  };

  return (
    <ToolbarDialog
      title={t("docsTyping.preferences")}
      onClose={onClose}
      className="docs-prefs"
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <DialogButton primary onClick={save}>
            {t("docs.ok")}
          </DialogButton>
        </>
      }
    >
      <div role="tablist" className="docs-prefs-tabs">
        {(["general", "substitutions"] as const).map((id) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className="docs-prefs-tab" onClick={() => setTab(id)}>
            {t(id === "general" ? "docsTyping.general" : "docsTyping.substitutions")}
          </button>
        ))}
      </div>
      {tab === "general" ? (
        <div className="docs-prefs-body" role="tabpanel">
          {SWITCHES.map((s) => (
            <label key={s.key} className="docs-ty-check">
              <input type="checkbox" checked={Boolean(draft[s.key])} onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.checked }))} />
              {t(s.label)}
            </label>
          ))}
        </div>
      ) : (
        <div className="docs-prefs-body" role="tabpanel">
          <label className="docs-ty-check">
            <input type="checkbox" checked={draft.substitute} onChange={(e) => setDraft((d) => ({ ...d, substitute: e.target.checked }))} />
            {t("docsTyping.automaticSubstitution")}
          </label>
          <div className="docs-subs" aria-disabled={!draft.substitute}>
            <div className="docs-subs-row docs-subs-entry">
              <span />
              {[
                { value: from, set: setFrom, label: t("docsTyping.replaceField") },
                { value: to, set: setTo, label: t("docsTyping.withField") },
              ].map((field) => (
                <input
                  key={field.label}
                  value={field.value}
                  placeholder={field.label}
                  aria-label={field.label}
                  onChange={(e) => field.set(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPair()}
                  className="docs-tb-field"
                  disabled={!draft.substitute}
                />
              ))}
              <DialogButton disabled={!draft.substitute || !from.trim() || !to} onClick={addPair}>
                {t("common.add")}
              </DialogButton>
            </div>
            <div className="docs-subs-list">
              {draft.substitutions.map((s, i) => (
                <div key={`${s.from}-${i}`} className="docs-subs-row">
                  <input
                    type="checkbox"
                    className="docs-subs-box"
                    checked={s.enabled}
                    disabled={!draft.substitute}
                    aria-label={`${s.from} → ${s.to}`}
                    onChange={(e) => setPairs((pairs) => pairs.map((p, j) => (j === i ? { ...p, enabled: e.target.checked } : p)))}
                  />
                  <span className="docs-subs-text">{s.from}</span>
                  <span className="docs-subs-text">{s.to}</span>
                  <button
                    type="button"
                    className="docs-icon-btn"
                    aria-label={t("common.remove")}
                    data-tip={t("common.remove")}
                    disabled={!draft.substitute}
                    onClick={() => setPairs((pairs) => pairs.filter((_, j) => j !== i))}
                  >
                    <CloseIcon size={18} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </ToolbarDialog>
  );
}
