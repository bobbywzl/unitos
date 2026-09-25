"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/lang-provider";
import { CloseIcon } from "@/components/docs/icons";
import { setTypingPrefs, typingPrefs, type Substitution, type TypingPrefs } from "@/components/docs/typing/prefs";
import type { TKey } from "@/lib/i18n/dictionaries";

// Tools > Preferences, Google Docs' dialog (SPEC.md §29, typing): the General
// tab's automatic formatting switches and the Substitutions tab's list —
// the master switch, a Replace / With row that adds a pair, and each pair
// with its own switch and a remove button. OK keeps the changes (in this
// browser); Cancel drops them.

type Tab = "general" | "substitutions";

const SWITCHES: { key: keyof TypingPrefs; label: TKey }[] = [
  { key: "autoCapitalize", label: "docsTyping.autoCapitalize" },
  { key: "smartQuotes", label: "docsTyping.smartQuotes" },
  { key: "detectLinks", label: "docsTyping.detectLinks" },
  { key: "detectLists", label: "docsTyping.detectLists" },
  { key: "markdown", label: "docsTyping.enableMarkdown" },
  { key: "correctSpelling", label: "docsTyping.correctSpelling" },
];

export function PreferencesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("general");
  const [draft, setDraft] = useState<TypingPrefs>(() => typingPrefs());
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDraft(typingPrefs());
      setTab("general");
      setFrom("");
      setTo("");
    }
  }
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) okRef.current?.focus();
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  const setPair = (i: number, patch: Partial<Substitution>) =>
    setDraft((d) => ({ ...d, substitutions: d.substitutions.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  const addPair = () => {
    const key = from.trim();
    if (!key || !to) return;
    setDraft((d) => ({
      ...d,
      substitutions: [{ from: key, to, enabled: true }, ...d.substitutions.filter((s) => s.from.toLowerCase() !== key.toLowerCase())],
    }));
    setFrom("");
    setTo("");
  };
  const save = () => {
    const key = from.trim();
    const pending = key && to ? [{ from: key, to, enabled: true }] : [];
    setTypingPrefs({ ...draft, substitutions: [...pending, ...draft.substitutions] });
    onClose();
  };

  return createPortal(
    <div
      className="docs-ty-backdrop"
      data-edit-control
      data-docs-typing
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onMouseUp={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div role="dialog" aria-modal="true" aria-label={t("docsTyping.preferences")} className="docs-ty-card docs-prefs">
        <div className="docs-ty-head">
          <h2>{t("docsTyping.preferences")}</h2>
          <button type="button" className="docs-find-btn" aria-label={t("docsTyping.close")} onClick={onClose}>
            <CloseIcon size={24} />
          </button>
        </div>
        <div role="tablist" className="docs-prefs-tabs">
          {(["general", "substitutions"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className="docs-prefs-tab"
              onClick={() => setTab(id)}
            >
              {t(id === "general" ? "docsTyping.general" : "docsTyping.substitutions")}
            </button>
          ))}
        </div>
        {tab === "general" ? (
          <div className="docs-prefs-body" role="tabpanel">
            {SWITCHES.map((s) => (
              <label key={s.key} className="docs-ty-check">
                <input
                  type="checkbox"
                  checked={Boolean(draft[s.key])}
                  onChange={(e) => setDraft((d) => ({ ...d, [s.key]: e.target.checked }))}
                />
                {t(s.label)}
              </label>
            ))}
          </div>
        ) : (
          <div className="docs-prefs-body" role="tabpanel">
            <label className="docs-ty-check">
              <input
                type="checkbox"
                checked={draft.substitute}
                onChange={(e) => setDraft((d) => ({ ...d, substitute: e.target.checked }))}
              />
              {t("docsTyping.automaticSubstitution")}
            </label>
            <div className="docs-subs" aria-disabled={!draft.substitute}>
              <div className="docs-subs-row docs-subs-entry">
                <span className="docs-subs-box" />
                <input
                  value={from}
                  placeholder={t("docsTyping.replaceField")}
                  aria-label={t("docsTyping.replaceField")}
                  onChange={(e) => setFrom(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPair()}
                  className="docs-subs-input"
                  disabled={!draft.substitute}
                />
                <input
                  value={to}
                  placeholder={t("docsTyping.withField")}
                  aria-label={t("docsTyping.withField")}
                  onChange={(e) => setTo(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPair()}
                  className="docs-subs-input"
                  disabled={!draft.substitute}
                />
                <button
                  type="button"
                  className="docs-ty-button docs-subs-add"
                  disabled={!draft.substitute || !from.trim() || !to}
                  onClick={addPair}
                >
                  {t("docsTyping.addPair")}
                </button>
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
                      onChange={(e) => setPair(i, { enabled: e.target.checked })}
                    />
                    <span className="docs-subs-text">{s.from}</span>
                    <span className="docs-subs-text">{s.to}</span>
                    <button
                      type="button"
                      className="docs-find-btn"
                      aria-label={t("docsTyping.removePair")}
                      data-tip={t("docsTyping.removePair")}
                      disabled={!draft.substitute}
                      onClick={() => setDraft((d) => ({ ...d, substitutions: d.substitutions.filter((_, j) => j !== i) }))}
                    >
                      <CloseIcon size={18} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        <div className="docs-ty-actions">
          <button type="button" className="docs-ty-button" onClick={onClose}>
            {t("docsTyping.cancel")}
          </button>
          <button ref={okRef} type="button" className="docs-ty-button docs-ty-primary" onClick={save}>
            {t("docsTyping.ok")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
