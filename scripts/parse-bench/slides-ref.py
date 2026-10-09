"""The slides benchmark's reference (scripts/parse-bench/slides.mts): each
.pptx read straight from its XML with lxml, apart from the code under test.

For every slide in the presentation's order (p:sldIdLst), what PowerPoint
shows as the slide's own words:

- every shape of the slide's shape tree, groups walked with their transform,
  mc:AlternateContent read through its first Choice, a hidden shape
  (cNvPr hidden="1") left out, and the furniture placeholders (slide number,
  footer, date, header) left out, as SPEC.md section 27 skips them;
- a text shape's paragraphs: the runs' and fields' a:t, a line break as a
  newline, an equation (a14:m, OMML) as its m:t text in order, and the
  bullet PowerPoint draws: the paragraph's own pPr, then the shape's
  lstStyle, then the layout's and the master's placeholder lstStyle, then
  the master's title, body, or other text style;
- a table's cells (a merged-away cell empty), a chart's title, series names,
  categories, and values formatted by their number format, a SmartArt
  diagram's node texts from its data part;
- the speaker notes: the notes slide's body placeholder.

Usage: python3 -I slides-ref.py <file.pptx> [...]  (or "-": the paths on
stdin, one per line) -> one JSON object on stdout, keyed by path.
"""
import json
import math
import posixpath
import re
import sys
import zipfile

from lxml import etree

NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "dgm": "http://schemas.openxmlformats.org/drawingml/2006/diagram",
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
}
FURNITURE = {"sldNum", "ftr", "dt", "hdr"}

# What a symbol font's bullet letter draws (the glyphs decks use for bullets).
SYMBOL_BULLETS = {
    "wingdings": {"l": "●", "n": "■", "q": "❑", "v": "❖", "u": "◆", "Ø": "➢", "§": "▪", "ü": "✓", "þ": "☑", "o": "□", "Ÿ": "•", "": "▪", "": "➢", "": "●", "": "■", "": "❑", "": "❖", "": "✓"},
    "symbol": {"·": "•", "": "•", "Þ": "⇒", "®": "→", "": "•"},
}


def local(el):
    return etree.QName(el).localname


def kids(el, name):
    return [c for c in el if isinstance(c.tag, str) and local(c) == name] if el is not None else []


def kid(el, *path):
    for name in path:
        if el is None:
            return None
        found = None
        for c in el:
            if isinstance(c.tag, str) and local(c) == name:
                found = c
                break
        el = found
    return el


def desc(el, name):
    if el is None:
        return []
    return [d for d in el.iter() if isinstance(d.tag, str) and local(d) == name]


def lattr(el, name):
    if el is None:
        return None
    for k, v in el.attrib.items():
        if k == name or k.endswith("}" + name):
            return v
    return None


def rattr(el, name):
    """A relationship attribute (r:id, r:embed): namespaced, transitional or strict."""
    if el is None:
        return None
    for k, v in el.attrib.items():
        if k.startswith("{") and k.endswith("}" + name):
            return v
    return None


def iattr(el, name, default=None):
    v = lattr(el, name)
    try:
        return int(v) if v is not None else default
    except ValueError:
        return default


class Pkg:
    def __init__(self, path):
        self.z = zipfile.ZipFile(path)
        self.names = set(self.z.namelist())
        self.cache = {}

    def xml(self, name):
        if name not in self.cache:
            if name not in self.names:
                self.cache[name] = None
            else:
                try:
                    self.cache[name] = etree.fromstring(self.z.read(name), etree.XMLParser(recover=True, huge_tree=True))
                except Exception:
                    self.cache[name] = None
        return self.cache[name]

    def rels(self, part):
        d, f = posixpath.split(part)
        doc = self.xml(posixpath.join(d, "_rels", f + ".rels"))
        out = {}
        if doc is None:
            return out
        for rel in doc:
            if not isinstance(rel.tag, str):
                continue
            rid, typ, target = rel.get("Id"), rel.get("Type", ""), rel.get("Target", "")
            ext = rel.get("TargetMode") == "External"
            if not ext:
                target = target[1:] if target.startswith("/") else posixpath.normpath(posixpath.join(d, target))
            out[rid] = (typ.rsplit("/", 1)[-1], target, ext)
        return out

    def rel_of_type(self, part, typ):
        for _, (t, target, ext) in self.rels(part).items():
            if t == typ and not ext:
                return target
        return None


# ── Placeholders and list styles ────────────────────────────────────────────


def ph_of(shape):
    nv = None
    for c in shape:
        if isinstance(c.tag, str) and local(c).startswith("nv"):
            nv = c
            break
    ph = desc(nv, "ph")
    if not ph:
        return None
    t = ph[0].get("type") or "body"
    return {"raw": ph[0].get("type"), "type": norm_ph(t), "idx": ph[0].get("idx")}


def norm_ph(t):
    return {"ctrTitle": "title", "subTitle": "body", "obj": "body"}.get(t, t)


def placeholders(doc):
    out = []
    tree = desc(doc, "spTree")
    for sp in desc(tree[0] if tree else None, "sp"):
        ph = ph_of(sp)
        if ph:
            out.append((ph, sp))
    return out


def find_ph(lst, ph, by_idx=True):
    if by_idx and ph["idx"] is not None:
        for p, sp in lst:
            if p["idx"] == ph["idx"]:
                return sp
    for p, sp in lst:
        if p["type"] == ph["type"]:
            return sp
    return None


def lvl_ppr(lst_style, level):
    return kid(lst_style, "lvl%dpPr" % (level + 1)) if lst_style is not None else None


def bullet_of_ppr(ppr):
    """The bullet a pPr sets: ('none',), ('char', c, font), ('auto', scheme), or None."""
    if ppr is None:
        return None
    if kid(ppr, "buNone") is not None:
        return ("none",)
    bc = kid(ppr, "buChar")
    if bc is not None:
        return ("char", bc.get("char", "•"), lattr(kid(ppr, "buFont"), "typeface"))
    ba = kid(ppr, "buAutoNum")
    if ba is not None:
        return ("auto", ba.get("type", "arabicPeriod"), iattr(ba, "startAt", 1))
    return None


def font_of_ppr(ppr):
    if ppr is None:
        return None
    return lattr(kid(ppr, "buFont"), "typeface")


def shown_char(char, font):
    f = (font or "").lower()
    for key, table in SYMBOL_BULLETS.items():
        if f.startswith(key):
            return table.get(char)  # None: a symbol glyph the table does not know
    return char


# ── Text ────────────────────────────────────────────────────────────────────


def math_text(el):
    """An equation's characters: each run's m:t, a space between the parts
    of a structure (a fraction's numerator and denominator, a script and
    its base), so the characters of two parts never join into one word."""
    out = []
    for c in el:
        if not isinstance(c.tag, str):
            continue
        name = local(c)
        if name == "r":
            out.append("".join(t.text or "" for t in kids(c, "t")))
        elif not name.endswith("Pr"):
            out.append(" " + math_text(c) + " ")
    return "".join(out)


def clean(s):
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", s or "")


def para_text(p):
    out = []
    for node in p:
        if not isinstance(node.tag, str):
            continue
        name = local(node)
        if name in ("r", "fld"):
            out.append(clean(kid(node, "t").text if kid(node, "t") is not None else ""))
        elif name == "br":
            out.append("\n")
        elif name == "m":
            out.append(math_text(node))
        elif name == "AlternateContent":
            choice = kid(node, "Choice")
            if choice is not None:
                for c in choice:
                    if isinstance(c.tag, str) and local(c) == "m":
                        out.append(math_text(c))
                    elif isinstance(c.tag, str) and local(c) == "r":
                        out.append(clean(kid(c, "t").text if kid(c, "t") is not None else ""))
    return "".join(out)


def text_paras(tx_body, chains):
    """Paragraphs with words: text, level, and the bullet PowerPoint draws."""
    out = []
    for p in kids(tx_body, "p"):
        text = para_text(p)
        ppr = kid(p, "pPr")
        level = max(0, min(8, iattr(ppr, "lvl", 0) or 0))
        bullet = bullet_of_ppr(ppr)
        font = font_of_ppr(ppr)
        for style in chains:
            lp = lvl_ppr(style, level)
            if bullet is None:
                bullet = bullet_of_ppr(lp)
            if font is None:
                font = font_of_ppr(lp)
        if bullet and bullet[0] == "char":
            bullet = ("char", bullet[1], font)
        has_math = any(local(n) in ("m", "AlternateContent") and desc(n, "oMath") for n in p if isinstance(n.tag, str))
        out.append({"text": text, "level": level, "bullet": list(bullet) if bullet else None, "math": has_math})
    # Empty paragraphs carry no words: kept out.
    return [q for q in out if q["text"].strip()]


def label_of(paras):
    """The bullet text PowerPoint shows per paragraph: a char (mapped from a
    symbol font), a number label, or ''. None = a symbol glyph not mapped.

    Numbering as PowerPoint counts it (the numbers LibreOffice's test
    testTdf173712 records from PowerPoint): a numbered paragraph continues
    its level's count while the scheme and the start stay the same; a
    paragraph of that level with words and no number, a new scheme, or a
    new start begins again at the start; a shallower paragraph ends the
    deeper counts, and a deeper one leaves the count alone."""
    counters = {}
    for q in paras:
        b = q.pop("bullet")
        lvl = q["level"]
        for k in [k for k in counters if k > lvl]:
            del counters[k]
        if not b or b[0] != "auto":
            counters.pop(lvl, None)
            q["bullet"] = "" if not b or b[0] == "none" else shown_char(b[1], b[2])
            continue
        scheme, start = b[1], b[2] or 1
        last = counters.get(lvl)
        n = last[0] + 1 if last and last[1] == scheme and last[2] == start else start
        counters[lvl] = (n, scheme, start)
        q["bullet"] = auto_label(scheme, n)
    return paras


def auto_label(scheme, n):
    def roman(v):
        out = ""
        for val, sym in [(1000, "M"), (900, "CM"), (500, "D"), (400, "CD"), (100, "C"), (90, "XC"), (50, "L"), (40, "XL"), (10, "X"), (9, "IX"), (5, "V"), (4, "IV"), (1, "I")]:
            while v >= val:
                out += sym
                v -= val
        return out

    def alpha(v):
        out = ""
        while v > 0:
            v -= 1
            out = chr(97 + v % 26) + out
            v //= 26
        return out

    if scheme.startswith("alphaLc"):
        core = alpha(n)
    elif scheme.startswith("alphaUc"):
        core = alpha(n).upper()
    elif scheme.startswith("romanLc"):
        core = roman(n).lower()
    elif scheme.startswith("romanUc"):
        core = roman(n)
    else:
        core = str(n)
    if scheme.endswith("ParenBoth"):
        return "(%s)" % core
    if scheme.endswith("ParenR"):
        return core + ")"
    if scheme.endswith("Period"):
        return core + "."
    if scheme.endswith("Minus"):
        return core + " -"
    return core


# ── Charts ──────────────────────────────────────────────────────────────────


def fmt_number(v, code):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return v or ""
    code = (code or "General").split(";")[0]
    if code == "General" or not re.search(r"[0#?]", code):
        if x == int(x) and abs(x) < 1e15:
            return str(int(x))
        return ("%.10g" % x)
    pctm = "%" in code
    if pctm:
        x *= 100
    m = re.search(r"\.([0#?]+)", code)
    decimals = len(m.group(1)) if m else 0
    s = ("{:,.%df}" if re.search(r"[0#],[0#]", code) else "{:.%df}") % decimals
    s = s.format(x)
    lit = re.findall(r'"([^"]*)"', code)
    prefix = "".join(re.findall(r"^[\$€£¥]", code.replace('"', "")))
    return prefix + s + ("%" if pctm else "") + (lit[-1] if lit and code.rstrip().endswith('"') else "")


def cache_pts(container):
    if container is None:
        return [], None
    for cache_name in ("strCache", "numCache", "multiLvlStrCache", "strLit", "numLit"):
        cache = desc(container, cache_name)
        if cache:
            cache = cache[0]
            code = kid(cache, "formatCode")
            code = code.text if code is not None else None
            count = iattr(kid(cache, "ptCount"), "val", 0) or 0
            if cache_name == "multiLvlStrCache":
                # The first level is the innermost category, one per point.
                lvls = kids(cache, "lvl")
                pts = kids(lvls[0] if lvls else cache, "pt")
            else:
                pts = kids(cache, "pt")
            vals = [None] * max(count, len(pts))
            for i, pt in enumerate(pts):
                idx = iattr(pt, "idx", i)
                if idx is not None and idx < len(vals):
                    v = kid(pt, "v")
                    vals[idx] = (v.text or "") if v is not None else ""
            return vals, (code, cache_name.startswith("num"))
    v = desc(container, "v")
    return ([v[0].text or ""] if v else []), None


def chart_ref(pkg, path):
    doc = pkg.xml(path)
    if doc is None:
        return None
    chart = desc(doc, "chart")
    chart = chart[0] if chart else None
    title_el = kid(chart, "title")
    title = ""
    if title_el is not None:
        rich = desc(title_el, "rich")
        if rich:
            title = "\n".join(para_text(p) for p in kids(rich[0], "p")).strip()
        else:
            vals, _ = cache_pts(kid(title_el, "tx"))
            title = " ".join(v for v in vals if v)
    words = []
    values = []
    shown = []
    series = desc(chart, "ser")
    have_cats = False
    for ser in series:
        name, _ = cache_pts(kid(ser, "tx"))
        words.extend(v for v in name if v)
        # The categories show once, along the axis: the first series' list
        # (every series repeats it).
        cat = kid(ser, "cat") if kid(ser, "cat") is not None else kid(ser, "xVal")
        cats, info = cache_pts(cat)
        if cats and not have_cats:
            have_cats = True
            if info and info[1]:
                for c in cats:
                    if c not in (None, "") and re.match(r"^-?[\d.eE+-]+$", c):
                        values.append(float(c))
                        shown.append(fmt_number(c, info[0]))
            else:
                words.extend(c for c in cats if c)
        val = kid(ser, "val") if kid(ser, "val") is not None else kid(ser, "yVal")
        vals, info = cache_pts(val)
        code = info[0] if info else None
        for v in vals:
            if v not in (None, "") and re.match(r"^-?[\d.eE+-]+$", v):
                values.append(float(v))
                shown.append(fmt_number(v, code))
    # A title element without words is the automatic title: the series'
    # name when the chart has one series, else "Chart Title".
    if title_el is not None and not title:
        first, _ = cache_pts(kid(series[0], "tx")) if len(series) == 1 else ([], None)
        title = (first[0] if first and first[0] else "") if len(series) == 1 else "Chart Title"
    seen = words
    return {"titleText": title, "words": seen, "values": values, "shown": shown}


# ── SmartArt ────────────────────────────────────────────────────────────────


def smartart_ref(pkg, data_path):
    doc = pkg.xml(data_path)
    if doc is None:
        return []
    out = []
    for pt in desc(doc, "pt"):
        if pt.get("type") not in (None, "node"):
            continue
        t = kid(pt, "t")
        if t is None:
            continue
        for p in kids(t, "p"):
            s = para_text(p)
            if s.strip():
                out.append(s)
    return out


# ── Shapes ──────────────────────────────────────────────────────────────────


def xfrm_box(xfrm):
    if xfrm is None:
        return None
    off, ext = kid(xfrm, "off"), kid(xfrm, "ext")
    if off is None or ext is None:
        return None
    x, y, w, h = iattr(off, "x", 0), iattr(off, "y", 0), iattr(ext, "cx", 0), iattr(ext, "cy", 0)
    # A rotated shape covers its rotated box: the reading order sees that.
    rot = math.radians((iattr(xfrm, "rot", 0) or 0) / 60000)
    if rot:
        rw = abs(w * math.cos(rot)) + abs(h * math.sin(rot))
        rh = abs(w * math.sin(rot)) + abs(h * math.cos(rot))
        x, y, w, h = x + (w - rw) / 2, y + (h - rh) / 2, rw, rh
    return [x, y, w, h]


def apply(box, t):
    ox, oy, sx, sy, cx, cy = t
    return [ox + (box[0] - cx) * sx, oy + (box[1] - cy) * sy, box[2] * sx, box[3] * sy]


def group_t(grp, t):
    xfrm = kid(grp, "grpSpPr", "xfrm")
    box = xfrm_box(xfrm)
    choff, chext = kid(xfrm, "chOff"), kid(xfrm, "chExt")
    if box is None or choff is None or chext is None:
        return t
    outer = apply(box, t)
    cw = iattr(chext, "cx", 0) or box[2] or 1
    ch = iattr(chext, "cy", 0) or box[3] or 1
    return (outer[0], outer[1], outer[2] / cw, outer[3] / ch, iattr(choff, "x", 0), iattr(choff, "y", 0))


def hidden(shape):
    for c in shape:
        if isinstance(c.tag, str) and local(c).startswith("nv"):
            pr = kid(c, "cNvPr")
            return pr is not None and pr.get("hidden") in ("1", "true")
    return False


class SlideRef:
    def __init__(self, pkg, part):
        self.pkg = pkg
        self.part = part
        layout = pkg.rel_of_type(part, "slideLayout")
        self.layout = pkg.xml(layout) if layout else None
        master = pkg.rel_of_type(layout, "slideMaster") if layout else None
        self.master = pkg.xml(master) if master else None
        self.layout_ph = placeholders(self.layout) if self.layout is not None else []
        self.master_ph = placeholders(self.master) if self.master is not None else []
        tx = desc(self.master, "txStyles")
        tx = tx[0] if tx else None
        self.title_style = kid(tx, "titleStyle")
        self.body_style = kid(tx, "bodyStyle")
        self.other_style = kid(tx, "otherStyle")
        self.shapes = []

    def inherited(self, ph):
        out = []
        if ph is None:
            return out
        a = find_ph(self.layout_ph, ph)
        if a is not None:
            out.append(a)
        b = find_ph(self.master_ph, ph, by_idx=False)
        if b is not None:
            out.append(b)
        return out

    def walk(self, tree, t):
        for node in tree:
            if not isinstance(node.tag, str):
                continue
            name = local(node)
            if name == "AlternateContent":
                choice = kid(node, "Choice")
                if choice is None:
                    choice = kid(node, "Fallback")
                if choice is not None:
                    self.walk(choice, t)
                continue
            if name not in ("sp", "grpSp", "graphicFrame", "pic", "cxnSp", "contentPart"):
                continue
            if hidden(node):
                continue
            if name == "grpSp":
                self.walk(node, group_t(node, t))
            elif name == "sp":
                self.sp(node, t)
            elif name == "graphicFrame":
                self.frame(node, t)

    def sp(self, sp, t):
        ph = ph_of(sp)
        if ph and ph["raw"] in FURNITURE:
            return
        inh = self.inherited(ph)
        box = None
        for el in [sp] + inh:
            b = xfrm_box(kid(el, "spPr", "xfrm"))
            if b is not None:
                box = apply(b, t) if el is sp else b
                break
        chains = [kid(el, "txBody", "lstStyle") for el in [sp] + inh]
        if ph is None:
            chains.append(self.other_style)
        elif ph["type"] == "title":
            chains.append(self.title_style)
        else:
            chains.append(self.body_style)
        paras = label_of(text_paras(kid(sp, "txBody"), [c for c in chains if c is not None]))
        if paras:
            self.shapes.append({"kind": "text", "title": bool(ph and ph["type"] == "title"), "box": box, "paras": paras})

    def frame(self, fr, t):
        b = xfrm_box(kid(fr, "xfrm"))
        box = apply(b, t) if b else None
        data = kid(fr, "graphic", "graphicData")
        tbl = kid(data, "tbl")
        rels = self.pkg.rels(self.part)
        if tbl is not None:
            rows = []
            for tr in kids(tbl, "tr"):
                row = []
                for tc in kids(tr, "tc"):
                    if tc.get("hMerge") in ("1", "true") or tc.get("vMerge") in ("1", "true"):
                        row.append("")
                        continue
                    ps = cell_paras(kid(tc, "txBody"))
                    while ps and not ps[0].strip():
                        ps.pop(0)
                    while ps and not ps[-1].strip():
                        ps.pop()
                    row.append("\n".join(ps))
                rows.append(row)
            if any(c.strip() for r in rows for c in r):
                self.shapes.append({"kind": "table", "title": False, "box": box, "rows": rows})
            return
        ch = kid(data, "chart")
        if ch is not None:
            rel = rels.get(rattr(ch, "id"))
            if rel and not rel[2]:
                ref = chart_ref(self.pkg, rel[1])
                if ref and (ref["titleText"] or ref["words"] or ref["values"]):
                    self.shapes.append({"kind": "chart", "title": False, "box": box, **ref})
            return
        ids = kid(data, "relIds")
        if ids is not None:
            rel = rels.get(rattr(ids, "dm"))
            if rel and not rel[2]:
                texts = smartart_ref(self.pkg, rel[1])
                if texts:
                    self.shapes.append({"kind": "smartart", "title": False, "box": box, "texts": texts})


def cell_paras(tx_body):
    """A table cell's paragraphs, each with the bullet its own pPr sets."""
    out = []
    count = 0
    for p in kids(tx_body, "p"):
        text = para_text(p)
        b = bullet_of_ppr(kid(p, "pPr"))
        label = ""
        if text.strip() and b and b[0] == "char":
            label = shown_char(b[1], b[2]) or "•"
        elif text.strip() and b and b[0] == "auto":
            count += 1
            label = auto_label(b[1], b[2] + count - 1)
        out.append(label + " " + text if label else text)
    return out


def notes_ref(pkg, slide_part):
    path = pkg.rel_of_type(slide_part, "notesSlide")
    doc = pkg.xml(path) if path else None
    if doc is None:
        return ""
    rows = []
    tree = desc(doc, "spTree")
    for sp in desc(tree[0] if tree else None, "sp"):
        ph = ph_of(sp)
        if not ph or ph["type"] != "body":
            continue
        ps = [para_text(p) for p in kids(kid(sp, "txBody"), "p")]
        text = "\n".join(ps).strip()
        if text:
            rows.append(text)
    return "\n".join(rows)


def reference(path):
    pkg = Pkg(path)
    pres_path = "ppt/presentation.xml"
    root_rels = pkg.rels("")  # _rels/.rels
    for _, (t, target, ext) in root_rels.items():
        if t == "officeDocument" and not ext:
            pres_path = target
    pres = pkg.xml(pres_path)
    if pres is None:
        return {"error": "no presentation part"}
    rels = pkg.rels(pres_path)
    slides = []
    for sid in desc(pres, "sldId"):
        rel = rels.get(rattr(sid, "id"))
        if rel and not rel[2]:
            slides.append(rel[1])
    sz = desc(pres, "sldSz")
    w = iattr(sz[0], "cx", 9144000) if sz else 9144000
    h = iattr(sz[0], "cy", 6858000) if sz else 6858000
    out = {"slideW": w, "slideH": h, "slides": []}
    for i, part in enumerate(slides):
        doc = pkg.xml(part)
        if doc is None:
            out["slides"].append({"n": i + 1, "missing": True, "shapes": [], "notes": ""})
            continue
        ref = SlideRef(pkg, part)
        tree = desc(kid(doc, "cSld"), "spTree")
        if tree:
            ref.walk(tree[0], (0, 0, 1, 1, 0, 0))
        out["slides"].append({
            "n": i + 1,
            "hidden": doc.get("show") in ("0", "false"),
            "shapes": ref.shapes,
            "notes": notes_ref(pkg, part),
        })
    return out


if __name__ == "__main__":
    result = {}
    paths = sys.argv[1:]
    if paths == ["-"]:
        paths = [line.rstrip("\n") for line in sys.stdin if line.strip()]
    for f in paths:
        try:
            result[f] = reference(f)
        except Exception as e:  # a broken file is a reference error, reported
            result[f] = {"error": "%s: %s" % (type(e).__name__, str(e)[:200])}
    json.dump(result, sys.stdout, ensure_ascii=False)
