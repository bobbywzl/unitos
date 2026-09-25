"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { LinkIcon, UploadIcon } from "@/components/docs/icons";
import type { ImageSource } from "@/components/docs/toolbar/image-menu";

// Google Docs' image sources (SPEC.md §29) as the "@" menu and Replace image
// open them: Upload from computer, and By URL with its field.

export function ImageSourcePicker({ onPick }: { onPick: (source: ImageSource) => void }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [byUrl, setByUrl] = useState(false);
  const [url, setUrl] = useState("");
  const valid = /^https?:\/\/\S+$/i.test(url.trim());
  return (
    <div className="docs-image-source">
      <button type="button" className="docs-at-row" onClick={() => fileRef.current?.click()}>
        <span className="docs-at-icon">
          <UploadIcon />
        </span>
        <span className="docs-at-label">{t("docs.uploadFromComputer")}</span>
      </button>
      <button type="button" className="docs-at-row" aria-expanded={byUrl} onClick={() => setByUrl((b) => !b)}>
        <span className="docs-at-icon">
          <LinkIcon />
        </span>
        <span className="docs-at-label">{t("docs.imageByUrl")}</span>
      </button>
      {byUrl && (
        <form
          className="docs-image-url-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onPick({ url: url.trim() });
          }}
        >
          <input
            className="docs-field"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("docs.imageUrlPlaceholder")}
            aria-label={t("docs.imageByUrl")}
            autoFocus
          />
          <button type="submit" className="docs-button-primary" disabled={!valid}>
            {t("docs.insertImageAction")}
          </button>
        </form>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onPick({ file });
        }}
      />
    </div>
  );
}
