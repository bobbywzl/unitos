"""The images and scans benchmark's downloads and references
(scripts/parse-bench/images.mts --fetch). Independent of the code under test:
Pillow reads the images, PyMuPDF (MuPDF) reads and draws the PDFs.

  python3 -I scripts/parse-bench/images-ref.py <corpus.json> <root> [--force]

<root>/files/<id>  the file (downloaded, copied from .bench/real, or derived)
<root>/refs/<id>.json  the reference:
  section b (an image): whether Pillow opens it, its format, mode, stored
    size, frame count, EXIF orientation, the upright size (EXIF applied), and
    the upright first frame on white as a small RGB thumbnail (96 px on the
    long side) to compare the page against.
  section a (a PDF): the page count, and for every page its size with
    /Rotate applied, the share of inked pixels, a small gray thumbnail, and
    the text layer's characters and the share of one-letter words.

Needs Pillow, pillow-heif (HEIC), PyMuPDF and img2pdf (pip).
"""
import base64
import io
import json
import os
import re
import shutil
import sys
import tarfile
import urllib.request

from PIL import Image, ImageFile, ImageOps

try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
except ImportError:  # HEIC references stay unreadable without it
    pass
Image.MAX_IMAGE_PIXELS = None
# A file cut short draws as far as it goes, as a browser draws it; the
# reference says so (truncated).
ImageFile.LOAD_TRUNCATED_IMAGES = True

corpus_path, root = sys.argv[1], sys.argv[2]
force = "--force" in sys.argv
repo_root = os.path.abspath(os.path.join(os.path.dirname(corpus_path), "..", ".."))
corpus = json.load(open(corpus_path))
FILES = os.path.join(root, "files")
REFS = os.path.join(root, "refs")
ARCHIVES = os.path.join(root, "archives")
for d in (FILES, REFS, ARCHIVES):
    os.makedirs(d, exist_ok=True)

THUMB = 96


def sdist(spec):
    name, version = spec[len("pypi:"):].split("==")
    meta = json.load(urllib.request.urlopen(f"https://pypi.org/pypi/{name}/{version}/json"))
    url = next(u["url"] for u in meta["urls"] if u["packagetype"] == "sdist")
    out = os.path.join(ARCHIVES, url.rsplit("/", 1)[-1])
    if not os.path.exists(out):
        urllib.request.urlretrieve(url, out)
    return out


_tars = {}


def member(archive, path):
    if archive not in _tars:
        _tars[archive] = tarfile.open(archive)
    f = _tars[archive].extractfile(path)
    if f is None:
        raise FileNotFoundError(path)
    return f.read()


def fetch(f, out):
    src = corpus["sources"][f["source"]]
    if src["from"].startswith("pypi:"):
        data = member(sdist(src["from"]), src["root"] + f["path"])
    elif src["from"].startswith("local:"):
        path = os.path.join(repo_root, src["from"][len("local:"):], f["path"])
        # A file the PDF bench keeps: linked, not copied.
        if os.path.lexists(out):
            os.remove(out)
        os.symlink(os.path.realpath(path), out)
        return
    else:
        data = urllib.request.urlopen(src["from"] + f["path"]).read()
    with open(out, "wb") as fh:
        fh.write(data)


def fileof(fid):
    return os.path.join(FILES, fid)


def derive(f, out):
    d = f["derived"]
    op = d["op"]
    srcs = [fileof(s) for s in d["from"]]
    for s in srcs:
        if not os.path.exists(s):
            raise FileNotFoundError(s)
    if op == "img2pdf":
        import img2pdf

        with open(out, "wb") as fh:
            fh.write(img2pdf.convert(srcs))
    elif op == "junk-layer":
        import pymupdf

        doc = pymupdf.open(srcs[0])
        runs = ["rightrightfracleftleftsqrtfracrightleft", "leftbracerightbracesumsubscriptsuperscript", "fracfracleftrightsqrtrightleftbraceleft"]
        for page in doc:
            y = 30
            for i in range(14):
                # Invisible text (render mode 3), as recognition layers are.
                page.insert_text((20, y), " ".join(runs[(i + j) % 3] for j in range(2)) + " x2 = 4", fontsize=6, render_mode=3)
                y += 14
        doc.save(out)
    elif op == "progressive":
        im = Image.open(srcs[0])
        im.save(out, "JPEG", quality=90, progressive=True, exif=im.info.get("exif", b""))
    elif op == "huge-jpeg":
        im = Image.open(srcs[0]).convert("RGB").resize((12000, 9000), Image.BILINEAR)
        exif = Image.Exif()
        exif[0x0112] = 6
        im.save(out, "JPEG", quality=80, exif=exif.tobytes())
    elif op == "huge-png":
        im = Image.open(srcs[0]).convert("RGB")
        w = 7000
        im.resize((w, round(im.height * w / im.width)), Image.BILINEAR).save(out, "PNG", compress_level=6)
    elif op == "long-screenshot":
        im = Image.open(srcs[0]).convert("RGB")
        w = 1170
        part = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        canvas = Image.new("RGB", (w, 16000), "white")
        y = 0
        while y < 16000:
            canvas.paste(part, (0, y))
            y += part.height
        canvas.save(out, "PNG")
    elif op == "panorama":
        im = Image.open(srcs[0]).convert("RGB")
        band = im.crop((0, im.height // 3, im.width, im.height // 3 + im.width // 9))
        band.resize((9000, 1000), Image.LANCZOS).save(out, "JPEG", quality=88)
    elif op == "webp-lossless":
        Image.open(srcs[0]).save(out, "WEBP", lossless=True)
    else:
        raise ValueError(f"unknown op {op}")


def thumb_rgb(im):
    """An RGB image on white, fitted to THUMB px on its long side, as base64."""
    if im.mode in ("RGBA", "LA", "PA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        ground = Image.new("RGBA", im.size, (255, 255, 255, 255))
        im = Image.alpha_composite(ground, im).convert("RGB")
    elif im.mode == "I;16" or im.mode.startswith("I"):
        # 16-bit gray: Pillow's convert clips; scale to 8 bits first.
        im = im.point(lambda v: v / 256).convert("L").convert("RGB")
    else:
        im = im.convert("RGB")
    scale = THUMB / max(im.size)
    size = (max(1, round(im.width * scale)), max(1, round(im.height * scale)))
    t = im.resize(size, Image.BOX if scale < 1 else Image.NEAREST)
    return {"w": t.width, "h": t.height, "rgb": base64.b64encode(t.tobytes()).decode()}


def image_ref(path):
    ref = {"opens": False}
    try:
        im = Image.open(path)
        ref.update(format=im.format, mode=im.mode, width=im.width, height=im.height, frames=getattr(im, "n_frames", 1))
        ref["orientation"] = im.getexif().get(0x0112)
        im.seek(0)
        try:
            ImageFile.LOAD_TRUNCATED_IMAGES = False
            Image.open(path).load()
        except Exception:  # noqa: BLE001
            ref["truncated"] = True
        finally:
            ImageFile.LOAD_TRUNCATED_IMAGES = True
        im.load()
        up = ImageOps.exif_transpose(im)
        ref.update(uprightWidth=up.width, uprightHeight=up.height, thumb=thumb_rgb(up), opens=True)
    except Exception as e:  # noqa: BLE001 — the reference records what Pillow says
        ref["error"] = str(e)[:200]
    return ref


def pdf_ref(path):
    import pymupdf

    doc = pymupdf.open(path)
    ref = {"opens": True, "pageCount": len(doc), "encrypted": bool(doc.needs_pass), "pages": []}
    if doc.needs_pass:
        return ref
    for page in doc:
        text = page.get_text()
        words = re.findall(r"[^\W\d_]+", text)
        r = page.rect  # /Rotate applied
        z = THUMB / max(r.width, r.height)
        pix = page.get_pixmap(matrix=pymupdf.Matrix(z, z), colorspace=pymupdf.csGRAY, alpha=False)
        gray = pix.samples
        inked = sum(1 for v in gray if v < 200) / max(1, len(gray))
        ref["pages"].append(
            {
                "width": round(r.width, 2),
                "height": round(r.height, 2),
                "rotate": page.rotation,
                "chars": len(text.strip()),
                "oneLetter": round(sum(1 for w in words if len(w) == 1) / max(1, len(words)), 3),
                "ink": round(inked, 4),
                "thumb": {"w": pix.width, "h": pix.height, "gray": base64.b64encode(gray).decode()},
            }
        )
    return ref


failed = []
# Sources first: a derived file is made from fetched ones.
for f in sorted(corpus["files"], key=lambda f: "derived" in f):
    out = fileof(f["id"])
    try:
        if force or not os.path.lexists(out):
            if "derived" in f:
                derive(f, out)
            else:
                fetch(f, out)
    except Exception as e:  # noqa: BLE001
        failed.append(f"{f['id']}: {e}")
        continue
    ref_path = os.path.join(REFS, f["id"] + ".json")
    if force or not os.path.exists(ref_path):
        ref = pdf_ref(out) if f["section"] == "a" else image_ref(out)
        with open(ref_path, "w") as fh:
            json.dump(ref, fh)

on_disk = [f for f in corpus["files"] if os.path.lexists(fileof(f["id"]))]
size = sum(os.path.getsize(fileof(f["id"])) for f in on_disk if not os.path.islink(fileof(f["id"])))
print(f"{len(on_disk)} of {len(corpus['files'])} files on disk, {size / 1e6:.1f} MB (links to .bench/real not counted)")
for line in failed:
    print("  not fetched:", line)
