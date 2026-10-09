"""The slides benchmark's reference (scripts/parse-bench/slides.mts): each
.pptx read straight from its XML with lxml, apart from the code under test.

For every slide in the presentation's order (p:sldIdLst), what PowerPoint
shows as the slide's own words:

- every shape of the slide's shape tree, groups walked with their transform
  (a rotated or flipped group turns and flips its children about its center),
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


# What a symbol font draws for each code 0x20-0xFF (a letter typed in the
# font, or the private-use code U+F020-U+F0FF PowerPoint writes for a symbol
# inserted from it): the Symbol font's Adobe encoding (Greek, math), and
# Wingdings as Unicode maps it. "\0" = no glyph known.
SYMBOL_FONT = (
    " !∀#∃%&∋()∗+,−./0123456789:;<=>?"
    "≅ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ[∴]⊥_"
    "‾αβχδεφγηιϕκλμνοπθρστυϖωξψζ{|}∼\0"
    + "\0" * 32
    + "€ϒ′≤⁄∞ƒ♣♦♥♠↔←↑→↓°±″≥×∝∂•÷≠≡≈…⏐⎯↵"
    "ℵℑℜ℘⊗⊕∅∩∪⊃⊇⊄⊂⊆∈∉∠∇®©™∏√⋅¬∧∨⇔⇐⇑⇒⇓"
    "◊〈®©™∑⎛⎜⎝⎡⎢⎣⎧⎨⎩⎪\0〉∫⌠⎮⌡⎞⎟⎠⎤⎥⎦⎫⎬⎭\0"
)
WINGDINGS_FONT = list(
    " ✏✂✁👓🕭🕮🕯🕿✆🖂🖃📪📫📬📭📁📂📄🗏🗐🗄⌛🖮🖰🖲🖳🖴🖫🖬✇✍"
    "🖎✌👌👍👎☜☞☝☟🖐☺😐☹💣☠🏳🏱✈☼💧❄🕆✞🕈✠✡☪☯ॐ☸♈♉"
    "♊♋♌♍♎♏♐♑♒♓🙰🙵●🔾■□🞐❑❒⬧⧫◆❖⬥⌧⮹⌘🏵🏶🙶🙷\0"
    "⓪①②③④⑤⑥⑦⑧⑨⑩⓿❶❷❸❹❺❻❼❽❾❿🙢🙠🙡🙣🙞🙜🙝🙟·•"
    "▪⚪🞆🞈◉◎🔿▪◻🟂✦★✶✴✹✵⯐⌖⟡⌑⯑✪✰🕐🕑🕒🕓🕔🕕🕖🕗🕘"
    "🕙🕚🕛⮰⮱⮲⮳⮴⮵⮶⮷🙪🙫🙕🙔🙗🙖🙐🙑🙒🙓⌫⌦⮘⮚⮙⮛⮈⮊⮉⮋🡨"
    "🡪🡩🡫🡬🡭🡯🡮🡸🡺🡹🡻🡼🡽🡿🡾⇦⇨⇧⇩⬄⇳⬀⬁⬃⬂▭▫✗✓☒☑\0"
)
assert len(SYMBOL_FONT) == 224 and len(WINGDINGS_FONT) == 224
# The parse draws a few Wingdings codes with the common glyph of the same
# shape (its bullets do too): a font without the newer arrows and shapes
# still draws them.
for code, glyph in {0x6D: "❍", 0x70: "◻", 0xA1: "○", 0xA8: "◻", 0xD8: "➢", 0xE0: "➔", 0xE8: "➔"}.items():
    WINGDINGS_FONT[code - 0x20] = glyph


def symbol_text(text, font, whole):
    """A run's text as a symbol font draws it: every character when the run
    is set in the font (whole), else only the private-use codes U+F020-F0FF
    (a:sym, the font for symbols)."""
    f = (font or "").lower()
    table = SYMBOL_FONT if f == "symbol" else WINGDINGS_FONT if f == "wingdings" else None
    if table is None:
        return text
    out = []
    for ch in text:
        c = ord(ch)
        code = c - 0xF000 if 0xF020 <= c <= 0xF0FF else c if whole and 0x20 <= c <= 0xFF else None
        g = table[code - 0x20] if code is not None else "\0"
        out.append(ch if g == "\0" else g)
    return "".join(out)


def run_text(r):
    t = clean(kid(r, "t").text if kid(r, "t") is not None else "")
    rpr = kid(r, "rPr")
    latin = lattr(kid(rpr, "latin"), "typeface")
    sym = lattr(kid(rpr, "sym"), "typeface")
    if latin and latin.lower() in ("symbol", "wingdings"):
        return symbol_text(t, latin, True)
    return symbol_text(t, sym, False) if sym else t


def para_text(p):
    out = []
    for node in p:
        if not isinstance(node.tag, str):
            continue
        name = local(node)
        if name in ("r", "fld"):
            out.append(run_text(node))
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
                        out.append(run_text(c))
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

    def han(v):
        # 1 一, 10 十, 11 十一, 20 二十, 105 一百零五: the ideographic count.
        digits = "零一二三四五六七八九"
        if v <= 0 or v >= 10000:
            return str(v)
        out = ""
        zero = False
        for unit, sym in ((1000, "千"), (100, "百"), (10, "十"), (1, "")):
            d = v // unit
            v %= unit
            if d == 0:
                zero = bool(out)
                continue
            if zero:
                out += "零"
                zero = False
            out += ("" if (unit == 10 and d == 1 and not out) else digits[d]) + sym
        return out

    # The East Asian schemes (ECMA-376 Part 1, 20.1.10.61): ideographic
    # numbers (Simplified and Traditional Chinese, Japanese and Korean),
    # full-width digits, and circled numbers; "Db" is a double-byte period.
    if scheme.startswith("ea1"):
        core = han(n)
        return core + ("．" if scheme.endswith("DbPeriod") else "." if scheme.endswith("Period") else "")
    if scheme.startswith("arabicDb"):
        core = "".join(chr(0xFF10 + int(c)) for c in str(n))
        return core + ("．" if scheme.endswith("Period") else "")
    if scheme.startswith("circleNum"):
        if scheme == "circleNumWdBlackPlain":
            return chr(0x2776 + n - 1) if 1 <= n <= 10 else chr(0x24EB + n - 11) if n <= 20 else str(n)
        return chr(0x2460 + n - 1) if 1 <= n <= 20 else chr(0x3251 + n - 21) if n <= 35 else chr(0x32B1 + n - 36) if n <= 50 else str(n)
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


DATE_CODE = re.compile(r"^(?:\[[^\]]*\])*[dmy/.\- ,]+$", re.I)


def fmt_date(x, code):
    """An Excel date serial (1900 system) in a code of d, m, y parts and
    separators: m/d/yy shows 37261 as 1/5/02."""
    import datetime

    day = datetime.date(1899, 12, 30) + datetime.timedelta(days=int(x))
    code = re.sub(r"^(?:\[[^\]]*\])*", "", code)
    out = ""
    for tok in re.findall(r"y+|m+|d+|[^ymd]+", code, re.I):
        t = tok.lower()
        if t[0] == "y":
            out += str(day.year) if len(t) > 2 else "%02d" % (day.year % 100)
        elif t[0] == "m":
            out += [str(day.month), "%02d" % day.month, day.strftime("%b"), day.strftime("%B")][min(len(t), 4) - 1]
        elif t[0] == "d":
            out += [str(day.day), "%02d" % day.day, day.strftime("%a"), day.strftime("%A")][min(len(t), 4) - 1]
        else:
            out += tok
    return out


def fmt_general(x):
    """A number in the General format: at most 11 characters, the leading
    zero and the decimal point among them (the sign not), as Excel and the
    charts it draws show it: 1/3 reads 0.333333333, 9 significant digits,
    and 4.2073549240 reads 4.207354924, 10. ECMA-376 Part 1, 18.8.30
    (numFmt, General); Microsoft's Open XML SDK NumberingFormat notes say
    the same. A number past 11 digits shows in scientific notation."""
    a = abs(x)
    sign = "-" if x < 0 else ""
    if a == int(a) and a < 1e11:
        return sign + str(int(a))
    if a >= 1e11 or a < 1e-9:
        mant, exp = ("%.5E" % a).split("E")
        mant = mant.rstrip("0").rstrip(".")
        return "%s%sE%s%02d" % (sign, mant, exp[0], int(exp[1:]))
    for d in range(10, -1, -1):
        s = ("%.*f" % (d, a)).rstrip("0").rstrip(".") if d else "%.0f" % a
        if len(s) <= 11:
            return sign + s
    return sign + "%.0f" % a


def fmt_number(v, code):
    try:
        x = float(v)
    except (TypeError, ValueError):
        return v or ""
    code = (code or "General").split(";")[0]
    if DATE_CODE.match(code) and re.search(r"[dmy]", code, re.I):
        return fmt_date(x, code)
    if code == "General" or not re.search(r"[0#?]", code):
        return fmt_general(x)
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


def lvl_pts(lvl):
    """A chartex level's points by index, as text."""
    count = iattr(lvl, "ptCount", 0) or 0
    pts = kids(lvl, "pt")
    vals = [""] * max(count, len(pts))
    for i, pt in enumerate(pts):
        idx = iattr(pt, "idx", i)
        if idx is not None and idx < len(vals):
            vals[idx] = pt.text or ""
    return vals


def chartex_ref(doc):
    """An Office 2016 chart (cx:chartSpace: waterfall, box and whisker,
    sunburst, treemap, histogram, funnel). Its data sits in cx:chartData, one
    cx:data per series: string dimensions (the categories, a level per
    column, the first level innermost) and number dimensions (the values).
    PowerPoint shows "Chart Title" for a title element without words, one
    series or several (the files' own thumbnails)."""
    root = doc.getroot() if hasattr(doc, "getroot") else doc
    data = {d.get("id"): d for d in desc(root, "data")}
    chart = kid(root, "chart")
    title_el = kid(chart, "title")
    title = ""
    if title_el is not None:
        rich = desc(title_el, "rich")
        if rich:
            title = "\n".join(para_text(p) for p in kids(rich[0], "p")).strip()
        else:
            title = " ".join((v.text or "") for v in desc(title_el, "v")).strip()
        if not title:
            title = "Chart Title"
    words, values, shown = [], [], []
    have_cats = False
    for ser in desc(chart, "series"):
        if ser.get("hidden") == "1":
            continue
        name = desc(kid(ser, "tx"), "v") if kid(ser, "tx") is not None else []
        words.extend((v.text or "") for v in name if v.text)
        did = kid(ser, "dataId")
        d = data.get(did.get("val")) if did is not None else None
        if d is None:
            continue
        for dim in kids(d, "strDim"):
            if have_cats:
                break
            for lvl in kids(dim, "lvl"):
                words.extend(v for v in lvl_pts(lvl) if v)
            have_cats = True
        for dim in kids(d, "numDim"):
            for lvl in kids(dim, "lvl")[:1]:
                code = lvl.get("formatCode")
                for v in lvl_pts(lvl):
                    if v and re.match(r"^-?[\d.eE+-]+$", v):
                        values.append(float(v))
                        shown.append(fmt_number(v, code))
    return {"titleText": title, "words": words, "values": values, "shown": shown}


def chart_ref(pkg, path):
    doc = pkg.xml(path)
    if doc is None:
        return None
    if desc(doc, "chartData"):
        return chartex_ref(doc)
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
    # A series the chart filter hides (c15:filteredBarSeries,
    # c15:filteredScatterSeries, ... in the plot's extLst) is not drawn and
    # shows no words: PowerPoint keeps it only to bring it back.
    series = [s for s in desc(chart, "ser") if not any(isinstance(a.tag, str) and local(a).startswith("filtered") for a in s.iterancestors())]
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
                        # A date category shows as its date: words, no
                        # number to find.
                        is_date = bool(info[0] and DATE_CODE.match(info[0]) and re.search(r"[dmy]", info[0], re.I))
                        if not is_date:
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
    # name when the chart has one named series, else "Chart Title" (one
    # unnamed series too: PowerPoint's thumbnail of chart-theme-override).
    if title_el is not None and not title:
        first, _ = cache_pts(kid(series[0], "tx")) if len(series) == 1 else ([], None)
        title = first[0] if len(series) == 1 and first and first[0] else "Chart Title"
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
        # A node in mc:AlternateContent is written twice, the same modelId
        # in the Choice and in the Fallback for older readers: the Choice
        # is the node.
        if any(isinstance(a.tag, str) and local(a) == "Fallback" for a in pt.iterancestors()):
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


def xfrm_raw(xfrm):
    """An xfrm as [x, y, w, h, rotation in degrees, flipH, flipV], or None."""
    if xfrm is None:
        return None
    off, ext = kid(xfrm, "off"), kid(xfrm, "ext")
    if off is None or ext is None:
        return None
    return [iattr(off, "x", 0), iattr(off, "y", 0), iattr(ext, "cx", 0), iattr(ext, "cy", 0),
            (iattr(xfrm, "rot", 0) or 0) / 60000, xfrm.get("flipH") in ("1", "true"), xfrm.get("flipV") in ("1", "true")]


def covered(x, y, w, h, rot):
    """A rotated shape covers its rotated box: the reading order sees that."""
    r = math.radians(rot)
    if r:
        rw = abs(w * math.cos(r)) + abs(h * math.sin(r))
        rh = abs(w * math.sin(r)) + abs(h * math.cos(r))
        x, y, w, h = x + (w - rw) / 2, y + (h - rh) / 2, rw, rh
    return [x, y, w, h]


# A group's transform maps its children's coordinates onto the slide: the
# child space scaled into the group's box, then flipped and turned about the
# box's center, as PowerPoint draws a rotated or flipped group (a child turns
# with it). t = (a, b, c, d, e, f, rot, mirror, sx, sy): the affine map
# x' = a x + c y + e, y' = b x + d y + f; the turn and the mirror a child
# takes on; the scale of a child's width and height.
IDENTITY = (1, 0, 0, 1, 0, 0, 0, False, 1, 1)


def apply(box, t):
    """A child's raw box mapped by the group transform: the box it covers."""
    a, b, c, d, e, f, rot, mirror, sx, sy = t
    x, y, w, h, r = box[:5]
    cx, cy = x + w / 2, y + h / 2
    mx, my = a * cx + c * cy + e, b * cx + d * cy + f
    w2, h2 = w * sx, h * sy
    return covered(mx - w2 / 2, my - h2 / 2, w2, h2, rot + (-r if mirror else r))


def group_t(grp, t):
    xfrm = kid(grp, "grpSpPr", "xfrm")
    box = xfrm_raw(xfrm)
    choff, chext = kid(xfrm, "chOff"), kid(xfrm, "chExt")
    if box is None or choff is None or chext is None:
        return t
    x, y, w, h, gr, fh, fv = box
    cw = iattr(chext, "cx", 0) or w or 1
    ch = iattr(chext, "cy", 0) or h or 1
    kx, ky = w / cw, h / ch
    ox, oy = iattr(choff, "x", 0), iattr(choff, "y", 0)
    gx, gy = x + w / 2, y + h / 2
    # Local map: scale into the box, flip and turn about its center.
    th = math.radians(gr)
    cos, sin = math.cos(th), math.sin(th)
    fx, fy = (-1 if fh else 1), (-1 if fv else 1)
    # p -> (x + (px - ox) kx, ...) -> g + R F (q - g)
    la, lb, lc, ld = cos * fx * kx, sin * fx * kx, -sin * fy * ky, cos * fy * ky
    qx0, qy0 = x - ox * kx - gx, y - oy * ky - gy  # q - g at child (0, 0)
    le = gx + cos * fx * qx0 - sin * fy * qy0
    lf = gy + sin * fx * qx0 + cos * fy * qy0
    a, b, c, d, e, f, rot, mirror, sx, sy = t
    na, nb = a * la + c * lb, b * la + d * lb
    nc, nd = a * lc + c * ld, b * lc + d * ld
    ne, nf = a * le + c * lf + e, b * le + d * lf + f
    lrot, lmirror = (gr + 180, False) if fh and fv else (gr + 180, True) if fv else (gr, fh)
    return (na, nb, nc, nd, ne, nf, rot + (-lrot if mirror else lrot), mirror != lmirror, sx * kx, sy * ky)


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
            b = xfrm_raw(kid(el, "spPr", "xfrm"))
            if b is not None:
                box = apply(b, t) if el is sp else covered(*b[:5])
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
        b = xfrm_raw(kid(fr, "xfrm"))
        box = apply(b, t) if b else None
        data = kid(fr, "graphic", "graphicData")
        tbl = kid(data, "tbl")
        rels = self.pkg.rels(self.part)
        if tbl is not None:
            rows = []
            # The rows holding an equation: its notation (spaces, brackets,
            # fraction bars) is the writer's, so the bench finds such a row
            # by its letters and digits.
            math_rows = []
            for tr in kids(tbl, "tr"):
                if desc(tr, "oMath"):
                    math_rows.append(len(rows))
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
                self.shapes.append({"kind": "table", "title": False, "box": box, "rows": rows, "mathRows": math_rows})
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
            ref.walk(tree[0], IDENTITY)
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
