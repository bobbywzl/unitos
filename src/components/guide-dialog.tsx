"use client";

import { useEffect } from "react";

// The reader's guide: every selection tool and feature, in one place.
// Opened from the ? button in the header.
export function GuideDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const h = "font-display text-[15px] text-clay-800";
  const term = "font-semibold";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal
      aria-label="Guide"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-[560px] max-w-full flex-col gap-4 overflow-y-auto rounded-[24px] bg-card p-6 shadow-float"
      >
        <div className="flex items-center">
          <span className="font-display text-[20px]">How to dissect a document</span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex size-8 items-center justify-center rounded-full text-sand-500 hover:bg-clay-100 hover:text-clay-700"
          >
            ✕
          </button>
        </div>

        <section className="flex flex-col gap-1.5">
          <span className={h}>Select text — the tools appear on the left</span>
          <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-sand-800">
            <li>
              <span className={term}>Assistant</span> — type or speak a command about the
              selection (“highlight the key claim and add a note to Thesis”). It proposes a plan;
              in Ask mode you approve each action before it runs, in Auto mode it runs
              immediately. Auto-mode notes still land pending for your review. The reply opens
              a small chat beside the article — keep talking in it; every turn still applies
              to your selection. Drag its corner to resize it freely.
            </li>
            <li>
              <span className={term}>Explain</span> — a short explanation of the selection,
              tuned to your context. Saved under Annotations; click the highlighted text any
              time to reopen the bubble. When the AI cites a block, the tag renders as a
              ¶ chip — click it to jump there.
            </li>
            <li>
              <span className={term}>Simplify</span> — rewrites the selection in plain words,
              in a bubble beside the article. Each sentence in the bubble is lightly tinted:
              press one and it goes solid while the original sentences it restates light up
              in the text. The rewrite is saved under Simplified in the Annotations tab;
              click the highlighted text any time to reopen the bubble. Drag any bubble by
              its header to move it; a faint line ties each bubble to the text it came from.
            </li>
            <li>
              <span className={term}>Extract</span> — the note-taking tool. It turns the
              selection into a note: the AI condenses the passage, proposes which section of
              your corpus it belongs in, and keeps an anchor back to the exact words. The
              note lands <span className={term}>pending</span> — nothing enters your notes until
              you accept it (Enter) or reject it (Backspace). Use it whenever a passage should
              become part of your notes without copying by hand.
            </li>
            <li>
              <span className={term}>Colors</span> — highlight the selection. Type a comment
              first, then pick a color, and the note rides on the highlight.
            </li>
            <li>
              <span className={term}>Comment</span> — attach a comment to the selection without
              a highlight. A small comment icon sits beside the text; click it to open the
              comment in a card.
            </li>
            <li>
              <span className={term}>Add to</span> — file the selection verbatim as a note in a
              section you pick. No AI involved.
            </li>
            <li>
              <span className={term}>Link across texts</span> — connect this passage to a
              passage in this or another document. Select the other end and press Link here.
              Both ends become clickable and are listed under Annotations.
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className={h}>Reading</span>
          <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-sand-800">
            <li>
              <span className={term}>Add URL</span> (+ in the header) — rebuilds the page in the
              reader: headings, lists, tables, figures, images, videos, charts, and equations,
              all editable. A progress card shows each step while the cat dances.
            </li>
            <li>
              <span className={term}>Context</span> (top bar) — who you are, why you read, what
              the notes feed. Injected into every AI prompt: notes, extraction, analysis. Every
              field is optional; edit any time. Save it everywhere or for this corpus only.
            </li>
            <li>
              <span className={term}>Salience</span> (top right) — an overlay that marks the
              load-bearing passages of the document, so you can skim what matters.
            </li>
            <li>
              <span className={term}>Notes tray</span> (right) — pending notes wait in a queue:
              j/k to move, Enter to accept, Backspace to reject, Undo to take a rejection back.
            </li>
            <li>
              <span className={term}>Figure tools</span> — hold and draw a small circle on a
              figure or equation: Explain deciphers the visual, a highlight color adds a side
              label that jumps to Annotations, Comment and Link work like on text.
            </li>
            <li>
              <span className={term}>Print document</span> (+ in the header) — prints the open
              document, article only: no app chrome, full length, highlights kept.
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className={h}>Editing</span>
          <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-sand-800">
            <li>
              <span className={term}>Double-click</span> any paragraph — the page becomes
              editable in place: headings, bold, italic, underline, bulleted and numbered
              lists, indent and outdent, font, insert and remove paragraphs. Changed words
              show in the edited color. Done or Esc returns to reading.
            </li>
            <li>
              Selecting text while editing still opens the highlight and AI tools.
            </li>
            <li>
              <span className={term}>Edits tab</span> — every change, newest first. Revert a
              text edit; restore a removed paragraph.
            </li>
            <li>
              Highlights, comments, and links move with your edits. If the words they pointed at
              are gone, they say “Anchor unresolved” — they never point at the wrong words.
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-1.5">
          <span className={h}>Side panel</span>
          <p className="text-[13px] leading-relaxed text-sand-800">
            <span className={term}>Notes</span> — your sections and the pending queue.{" "}
            <span className={term}>Assistant</span> — ask questions at document, corpus, or
            corpora scope, and run checks (contradictions, gaps).{" "}
            <span className={term}>Summary</span> — the whole document summarized at the depth
            you pick: layman, intermediate, or professional. Each depth is kept once generated.{" "}
            <span className={term}>Annotations</span> — highlights, comments, explanations,
            links; Jump scrolls to the source. <span className={term}>Edits</span> — the edit
            history.
          </p>
        </section>
      </div>
    </div>
  );
}
