"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IMAGE_ACCEPT, MAX_IMAGE_BYTES } from "@/lib/images";
import { isImeKey } from "@/lib/ime";
import { useT } from "@/components/lang-provider";
import { Presence } from "@/components/presence";

// Photos and links on feedback (SPEC.md §18): the same caps the route holds.
const MAX_PHOTOS = 6;
const MAX_LINKS = 10;

type Photo = { id: string; url: string; name: string };

/** A link as the user typed it, or null when it is not an absolute http(s) URL. */
function parseLink(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed).href;
  } catch {
    return null;
  }
}

// Floating feedback button, mounted app-wide (release-edu pattern).
export function FeedbackButton() {
  const pathname = usePathname();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<"bug" | "idea" | "other">("bug");
  const [message, setMessage] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  // Photos already uploaded (POST /api/images), links added, the link being
  // typed, and the one note under the form about either.
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [linkDraft, setLinkDraft] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addPhotos(files: File[]) {
    setNote(null);
    const room = MAX_PHOTOS - photos.length - uploading;
    if (files.length > room) {
      setNote(t("works.feedbackPhotoLimit", { n: MAX_PHOTOS }));
      files = files.slice(0, Math.max(0, room));
    }
    for (const file of files) {
      if (file.size > MAX_IMAGE_BYTES) {
        setNote(t("works.feedbackPhotoFailed"));
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const res = await fetch("/api/images", { method: "POST", body: file });
        if (!res.ok) throw new Error();
        const image = (await res.json()) as { id: string; url: string };
        setPhotos((prev) => [...prev, { id: image.id, url: image.url, name: file.name }]);
      } catch {
        setNote(t("works.feedbackPhotoFailed"));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  function addLink() {
    const link = parseLink(linkDraft);
    if (!link) {
      setNote(linkDraft.trim() ? t("works.feedbackLinkInvalid") : null);
      return;
    }
    if (links.length >= MAX_LINKS) {
      setNote(t("works.feedbackLinkLimit", { n: MAX_LINKS }));
      return;
    }
    setNote(null);
    if (!links.includes(link)) setLinks([...links, link]);
    setLinkDraft("");
  }

  function reset() {
    setMessage("");
    setPhotos([]);
    setLinks([]);
    setLinkDraft("");
    setLinkOpen(false);
    setNote(null);
  }

  // Escape closes the dialog, like every popover.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImeKey(e)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (pathname.startsWith("/admin")) return null;

  // Wire values stay "bug" | "idea" | "other"; only the chip label translates.
  const categoryLabel = {
    bug: t("works.feedbackBug"),
    idea: t("works.feedbackIdea"),
    other: t("works.feedbackOther"),
  } as const;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || state === "busy" || uploading > 0) return;
    // A link typed but not added goes too.
    const pending = parseLink(linkDraft);
    const allLinks = pending && !links.includes(pending) ? [...links, pending] : links;
    setState("busy");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          message: trimmed,
          page: pathname,
          images: photos.map((p) => p.id),
          links: allLinks,
        }),
      });
      if (!res.ok) throw new Error();
      setState("sent");
      reset();
      setTimeout(() => {
        setState("idle");
        setOpen(false);
      }, 1200);
    } catch {
      setState("error");
    }
  }

  return (
    <>
      {/* Above the mobile bottom bar; on md+ above the rail's More button,
          which sits in the bottom-right corner. */}
      <button
        onClick={() => setOpen(!open)}
        aria-label={t("works.sendFeedback")}
        data-tip={t("works.sendFeedback")}
        className="fixed right-4 bottom-[calc(64px+env(safe-area-inset-bottom))] z-20 rounded-full bg-card px-4 py-2 text-sm text-sand-700 shadow-lift hover:bg-clay-100 hover:text-clay-800 md:bottom-[60px] print:hidden"
      >
        {t("works.feedback")}
      </button>
      <Presence show={open} exit="pop">
      {open && (
        <div className="pop-in fixed right-4 bottom-16 z-30 w-80 rounded-[28px] bg-card p-5 shadow-float print:hidden">
          <form onSubmit={submit} className="space-y-2">
            <div className="flex gap-1">
              {(["bug", "idea", "other"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setCategory(c)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    category === c
                      ? "bg-ink text-paper"
                      : "bg-sand-100 text-sand-600 hover:text-clay-800"
                  }`}
                >
                  {categoryLabel[c]}
                </button>
              ))}
            </div>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              // A pasted image goes in as a photo.
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
                if (files.length === 0) return;
                e.preventDefault();
                void addPhotos(files);
              }}
              placeholder={t("works.feedbackPlaceholder")}
              rows={4}
              className="w-full rounded-2xl bg-sand-100 p-3 text-sm outline-none placeholder:text-sand-500"
            />
            {/* Photos and links (SPEC.md §18): each one a chip with its ×. */}
            {(photos.length > 0 || uploading > 0) && (
              <div className="flex flex-wrap gap-1.5" data-feedback-photos>
                {photos.map((p) => (
                  <span key={p.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.url} alt={p.name} className="size-12 rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => setPhotos(photos.filter((x) => x.id !== p.id))}
                      aria-label={t("works.feedbackRemovePhoto")}
                      data-tip={t("works.feedbackRemovePhoto")}
                      className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-ink text-[10px] leading-none text-paper"
                    >
                      ×
                    </button>
                  </span>
                ))}
                {uploading > 0 && <span className="size-12 animate-pulse rounded-lg bg-sand-200" aria-hidden />}
              </div>
            )}
            {links.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" data-feedback-links>
                {links.map((link) => (
                  <li key={link} className="flex max-w-full items-center gap-1 rounded-full bg-sand-100 px-2.5 py-0.5 text-[11px] text-sand-700">
                    <span className="truncate">{link.replace(/^https?:\/\//i, "")}</span>
                    <button
                      type="button"
                      onClick={() => setLinks(links.filter((x) => x !== link))}
                      aria-label={t("works.feedbackRemoveLink")}
                      data-tip={t("works.feedbackRemoveLink")}
                      className="text-sand-500 hover:text-clay-800"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {linkOpen && (
              <input
                autoFocus
                type="url"
                value={linkDraft}
                onChange={(e) => setLinkDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (isImeKey(e)) return;
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addLink();
                  }
                }}
                onBlur={addLink}
                placeholder={t("works.feedbackLinkPlaceholder")}
                aria-label={t("works.feedbackAddLink")}
                className="w-full rounded-full bg-sand-100 px-3 py-1.5 text-xs outline-none placeholder:text-sand-500"
              />
            )}
            <div className="flex gap-1.5">
              <input
                ref={fileRef}
                type="file"
                accept={IMAGE_ACCEPT}
                multiple
                hidden
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? []);
                  e.target.value = "";
                  if (files.length > 0) void addPhotos(files);
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={photos.length + uploading >= MAX_PHOTOS}
                data-track="feedback-add-photo"
                data-tip={t("works.feedbackAddPhotoTitle")}
                className="rounded-full bg-sand-100 px-2.5 py-1 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
              >
                + {t("works.feedbackAddPhoto")}
              </button>
              <button
                type="button"
                onClick={() => setLinkOpen(true)}
                disabled={links.length >= MAX_LINKS}
                data-track="feedback-add-link"
                className="rounded-full bg-sand-100 px-2.5 py-1 text-[11px] font-semibold text-sand-700 hover:bg-clay-100 hover:text-clay-800 disabled:opacity-40"
              >
                + {t("works.feedbackAddLink")}
              </button>
            </div>
            {note && <p className="text-xs text-red-600">{note}</p>}
            {state === "error" && (
              <p className="text-xs text-red-600">{t("works.feedbackFailed")}</p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="rounded-full px-3 py-1 text-xs text-sand-600 hover:text-clay-700">
                {t("common.close")}
              </button>
              <button
                type="submit"
                disabled={state === "busy" || uploading > 0 || !message.trim()}
                className="rounded-full bg-clay px-4 py-1.5 text-xs font-semibold text-clay-fg hover:bg-clay-600 disabled:opacity-40"
              >
                {state === "sent"
                  ? t("works.feedbackSent")
                  : state === "busy"
                    ? t("works.feedbackSending")
                    : t("works.feedbackSend")}
              </button>
            </div>
          </form>
        </div>
      )}
      </Presence>
    </>
  );
}
