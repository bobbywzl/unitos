"use client";

import { useRef, useState } from "react";
import { useT } from "@/components/lang-provider";
import { ImageIcon, LinkIcon, UploadIcon } from "@/components/docs/icons";
import { MenuItem } from "@/components/docs/menu";
import { DropBtn } from "@/components/docs/toolbar/controls";
import { DialogButton, ToolbarDialog } from "@/components/docs/toolbar/dialog";

// Insert image (SPEC.md §29): Upload from computer and By URL. By URL opens
// Google Docs' dialog: a field for the address, a preview of the image, and
// Insert image once the image loads.

export type ImageSource = { file: File } | { url: string };

export function ImageMenu({
  disabled,
  onInsert,
  onDone,
}: {
  disabled: boolean;
  onInsert: (source: ImageSource) => void;
  /** The page takes the focus back. */
  onDone: () => void;
}) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [dialog, setDialog] = useState(false);
  return (
    <>
      <DropBtn
        id="image"
        label={t("docs.insertImage")}
        track="image"
        disabled={disabled}
        arrow={false}
        className="docs-tb-menu-btn"
        face={<ImageIcon />}
      >
        {(close) => (
          <>
            <MenuItem
              icon={<UploadIcon size={18} />}
              onSelect={() => {
                close();
                fileRef.current?.click();
              }}
              track="docs:image-upload"
            >
              {t("docs.uploadFromComputer")}
            </MenuItem>
            <MenuItem
              icon={<LinkIcon size={18} />}
              onSelect={() => {
                close();
                setDialog(true);
              }}
              track="docs:image-url"
            >
              {t("docs.imageByUrl")}
            </MenuItem>
          </>
        )}
      </DropBtn>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) onInsert({ file });
        }}
      />
      {dialog && (
        <ImageUrlDialog
          onClose={() => {
            setDialog(false);
            onDone();
          }}
          onInsert={(url) => {
            setDialog(false);
            onInsert({ url });
          }}
        />
      )}
    </>
  );
}

export function ImageUrlDialog({ onClose, onInsert }: { onClose: () => void; onInsert: (url: string) => void }) {
  const t = useT();
  const [url, setUrl] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const clean = url.trim();
  const valid = /^https?:\/\/\S+$/i.test(clean);
  const ready = valid && loaded === clean;
  return (
    <ToolbarDialog
      title={t("docs.insertImage")}
      onClose={onClose}
      className="docs-image-dialog"
      actions={
        <>
          <DialogButton onClick={onClose}>{t("docs.cancel")}</DialogButton>
          <DialogButton primary disabled={!ready} onClick={() => onInsert(clean)}>
            {t("docs.insertImageAction")}
          </DialogButton>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onInsert(clean);
        }}
      >
        <input
          className="docs-tb-field"
          value={url}
          placeholder={t("docs.imageUrlPlaceholder")}
          aria-label={t("docs.imageByUrl")}
          onChange={(e) => setUrl(e.target.value)}
        />
      </form>
      <div className="docs-image-preview">
        {valid && failed !== clean ? (
          // eslint-disable-next-line @next/next/no-img-element -- a preview of any address the reader pastes
          <img
            src={clean}
            alt=""
            onLoad={() => setLoaded(clean)}
            onError={() => setFailed(clean)}
            referrerPolicy="no-referrer"
          />
        ) : failed === clean ? (
          <span>{t("docs.imageLoadFailed")}</span>
        ) : (
          <ImageIcon size={48} />
        )}
      </div>
      <p className="docs-image-note">{t("docs.imageRights")}</p>
    </ToolbarDialog>
  );
}
