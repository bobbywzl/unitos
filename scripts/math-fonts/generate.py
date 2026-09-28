#!/usr/bin/env python3
"""Writes src/lib/parse/pdf/math-fonts.ts: for each TeX math family, what each
character code draws — its LaTeX command, its Unicode character, its math
class, and its box from the font's metrics.

The PDF parser reads a math glyph by its code, not by the text layer, whose
string depends on how the PDF was made (P0-F memo §1.2). The data comes from
TeX Live itself, so the next run regenerates it rather than anyone editing it:

- glyph names from each font's built-in encoding (the .pfb files, fontTools);
- LaTeX commands from the \\DeclareMathSymbol, \\DeclareMathDelimiter, and
  \\DeclareMathAccent lines of fontmath.ltx, amssymb.sty, amsfonts.sty,
  latexsym.sty, amsmath.sty, and esint.sty, spelled as KaTeX spells them;
- Unicode from pdfTeX's glyphtounicode.tex, its font-specific entries first,
  and for esint's integrals from unicode-math's table;
- heights and depths from tftopl, and the display size of an integral from
  its NEXTLARGER.

Needs TeX Live (kpsewhich, tftopl) and fontTools; the app never runs it.
Run from anywhere: python3 scripts/math-fonts/generate.py
Check the result: npx tsx scripts/math-fonts/check.mts
"""

import json
import re
import subprocess
from pathlib import Path

from fontTools import t1Lib

OUT = Path(__file__).resolve().parents[2] / "src/lib/parse/pdf/math-fonts.ts"

# Each family and the font its codes are read from (the 10 pt design size).
FONTS = {
    "oml": "cmmi10",
    "oms": "cmsy10",
    "omx": "cmex10",
    "msa": "msam10",
    "msb": "msbm10",
    "euf": "eufm10",
    "rsfs": "rsfs10",
    "lasy": "lasy10",
    "esint": "esint10",
    "ot1": "cmr10",
}
# LaTeX's symbol fonts, as the declarations name them.
SYMBOL_FONTS = {
    "letters": "oml",
    "symbols": "oms",
    "largesymbols": "omx",
    "operators": "ot1",
    "AMSa": "msa",
    "AMSb": "msb",
    "lasy": "lasy",
    "largesymbolsA": "esint",
}
CLASSES = {
    "mathord": "ord",
    "mathalpha": "ord",
    "mathop": "op",
    "mathbin": "bin",
    "mathrel": "rel",
    "mathopen": "open",
    "mathclose": "close",
    "mathpunct": "punct",
}
# Commands KaTeX does not know, and KaTeX's spelling for some of them.
KATEX_MISSING = {
    "\\lhook", "\\rhook", "\\varbigtriangleup", "\\varbigtriangledown", "\\mapstochar", "\\arrowvert",
    "\\Arrowvert", "\\bracevert", "\\mathsection", "\\mathparagraph", "\\ointop", "\\braceld", "\\bracerd",
    "\\bracelu", "\\braceru", "\\mathdollar", "\\intop", "\\smallint", "\\sqrtsign", "\\lmoustache",
    "\\rmoustache", "\\lgroup", "\\rgroup", "\\mathsterling", "\\mathunderscore", "\\mathellipsis",
}
KATEX_SPELLING = {
    "\\mathsection": "\\S", "\\mathparagraph": "\\P", "\\ointop": "\\oint", "\\intop": "\\int",
    "\\mathdollar": "\\$", "\\varbigtriangleup": "\\bigtriangleup", "\\varbigtriangledown": "\\bigtriangledown",
    "\\smallint": "\\int", "\\mathsterling": "\\pounds", "\\mathunderscore": "\\_",
    "\\iintop": "\\iint", "\\iiintop": "\\iiint", "\\oiintop": "\\oiint",
}
# esint's integrals KaTeX has no command for: they read by their character.
KATEX_MISSING |= {
    "\\iiiintop", "\\dotsintop", "\\sqintop", "\\sqiintop", "\\ointctrclockwiseop", "\\ointclockwiseop",
    "\\varointclockwiseop", "\\varointctrclockwiseop", "\\fintop", "\\varoiintop", "\\landupintop", "\\landdownintop",
}
# esint's integrals unicode-math's table has no character for: the
# character of the integral each draws a variant of.
ESINT_UNLISTED = {
    "\\ointclockwise": "∲", "\\varointctrclockwise": "∳", "\\varoiint": "∯", "\\sqiint": "∬",
    "\\dotsint": "∫⋯∫", "\\landupint": "∫", "\\landdownint": "∫",
}
# The command a glyph is written with when several name it.
PREFERRED = [
    "|",  # a bar is | (|x|); the layout reads \\mid from the space around it
    "\\leq", "\\geq", "\\rightarrow", "\\leftarrow", "\\lbrace", "\\rbrace", "\\wedge", "\\vee", "\\neg", "\\ni",
    "\\ast", "\\langle", "\\rangle", "\\setminus", "\\triangle", "\\bot", "\\square", "\\vartriangleright",
    "\\vartriangleleft", "\\trianglerighteq", "\\trianglelefteq", "\\upharpoonright", "\\rightsquigarrow",
    "\\doteqdot", "\\Cup", "\\Cap", "\\lll", "\\ggg", "\\circledR", "\\Box", "\\Diamond", "\\emptyset",
    "\\|", "\\{", "\\}", "\\lfloor", "\\rfloor", "\\lceil", "\\rceil", "\\backslash",
]
# The characters of glyphs whose names pdfTeX's list lacks (latexsym's
# glyphs are named a1…a61), by command, as KaTeX draws them.
UNLISTED_UNICODE = {
    "\\lhd": "⊲", "\\unlhd": "⊴", "\\rhd": "⊳", "\\unrhd": "⊵", "\\mho": "℧", "\\Join": "⋈", "\\Box": "□",
    "\\Diamond": "◇", "\\leadsto": "⇝", "\\sqsubset": "⊏", "\\sqsupset": "⊐", "\\centerdot": "⋅",
    "\\lnsim": "⋦", "\\gnsim": "⋧", "\\varsubsetneqq": "⫋", "\\varsupsetneqq": "⫌", "\\nshortmid": "∤",
    "\\nshortparallel": "∦", "\\shortmid": "∣", "\\shortparallel": "∥",
}
GREEK_CAPITALS = ["Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega"]
GREEK_CAPITAL_LETTERS = "ΓΔΘΛΞΠΣΥΦΨΩ"
ACCENTS = {  # OT1 accent codes and the combining mark each draws
    0x12: ("\\grave", "\u0300"), 0x13: ("\\acute", "\u0301"), 0x14: ("\\check", "\u030C"),
    0x15: ("\\breve", "\u0306"), 0x16: ("\\bar", "\u0304"), 0x17: ("\\mathring", "\u030A"),
    0x5E: ("\\hat", "\u0302"), 0x5F: ("\\dot", "\u0307"), 0x7E: ("\\tilde", "\u0303"), 0x7F: ("\\ddot", "\u0308"),
}
OT1_PUNCTUATION = {
    0x2B: ("+", "bin"), 0x3D: ("=", "rel"), 0x28: ("(", "open"), 0x29: (")", "close"), 0x5B: ("[", "open"),
    0x5D: ("]", "close"), 0x3A: (":", "rel"), 0x3B: (";", "punct"), 0x21: ("!", "close"), 0x3F: ("?", "close"),
    0x2C: (",", "punct"), 0x2E: (".", "ord"), 0x2F: ("/", "ord"), 0x27: ("'", "ord"), 0x2D: ("-", "bin"),
}
# Mathematical alphanumerics: the first capital (and small letter) of each
# alphabet, and the letters Unicode had already given a code of their own.
ALPHABETS = {
    "cal": (0x1D49C, None, {"B": "ℬ", "E": "ℰ", "F": "ℱ", "H": "ℋ", "I": "ℐ", "L": "ℒ", "M": "ℳ", "R": "ℛ"}),
    "frak": (0x1D504, 0x1D51E, {"C": "ℭ", "H": "ℌ", "I": "ℑ", "R": "ℜ", "Z": "ℨ"}),
    "bb": (0x1D538, None, {"C": "ℂ", "H": "ℍ", "N": "ℕ", "P": "ℙ", "Q": "ℚ", "R": "ℝ", "Z": "ℤ"}),
}


def kpse(name):
    return subprocess.check_output(["kpsewhich", name], text=True).strip()


def glyph_names(font):
    """Code → glyph name, from the Type 1 font's built-in encoding. TeX's
    fonts have 128 codes; the copies of the low codes some encodings repeat
    above 160 are for other programs."""
    t1 = t1Lib.T1Font(kpse(font + ".pfb"))
    t1.parse()
    return {code: name for code, name in enumerate(t1.font["Encoding"][:128]) if name and name != ".notdef"}


def declarations():
    """(kind, command, class, family, code) for every declared math symbol,
    each delimiter's small and large glyph, and every math accent. Commented
    lines count too: amssymb comments out \\angle and \\rightleftharpoons,
    whose glyphs its fonts still draw under those names."""
    arg = r"\{((?:[^{}]|\{[^{}]*\})*)\}"
    command = r"(?:\{((?:[^{}]|\{[^{}]*\})*)\}|(\\[A-Za-z@]+|\\.))"
    sep = r"(?:\s|%[^\n]*\n)*"

    def code(text):
        text = text.strip()
        if "#" in text:
            return None  # inside a macro's definition
        if text.startswith('"'):
            return int(text[1:], 16)
        if text.startswith("'"):
            return int(text[1:], 8)
        if text.startswith("`"):
            return ord(text[2]) if text[1] == "\\" else ord(text[1])
        return int(text)

    out = []
    for file in ["fontmath.ltx", "amssymb.sty", "amsfonts.sty", "latexsym.sty", "amsmath.sty", "esint.sty"]:
        text = Path(kpse(file)).read_text()
        for kind, count in (("sym", 3), ("delim", 5), ("accent", 3)):
            name = {"sym": "Symbol", "delim": "Delimiter", "accent": "Accent"}[kind]
            # esint declares through a wrapper, \re@DeclareMathSymbol.
            pattern = r"\\(?:re@)?DeclareMath" + name + sep + command + (sep + arg) * count
            for m in re.finditer(pattern, text):
                cmd = (m.group(1) or m.group(2)).strip()
                rest = [g.strip() for g in m.groups()[2:]]
                cls = rest[0].lstrip("\\")
                if "@" in cmd or re.fullmatch(r"[A-Za-z0-9]", cmd):
                    continue  # internal names; letters and digits come from glyph names
                if kind == "delim":
                    small, large = code(rest[2]), code(rest[4])
                    if small is not None and rest[1] in SYMBOL_FONTS:
                        out.append(("delim-small", cmd, cls, SYMBOL_FONTS[rest[1]], small))
                    if large is not None and rest[3] in SYMBOL_FONTS:
                        out.append(("delim-large", cmd, cls, SYMBOL_FONTS[rest[3]], large))
                elif rest[1] in SYMBOL_FONTS and code(rest[2]) is not None:
                    out.append((kind, cmd, cls, SYMBOL_FONTS[rest[1]], code(rest[2])))
    return out


def unicode_of_names():
    """Glyph name → Unicode, and "tfm:font/name" → Unicode for the entries
    pdfTeX keeps per font (CMMI's phi is ϕ, its phi1 is φ)."""
    table = {}
    for m in re.finditer(r"\\pdfglyphtounicode\{([^}]*)\}\{([0-9A-F ]+)\}", Path(kpse("glyphtounicode.tex")).read_text()):
        units = m.group(2).split()
        # Four hex digits a group are UTF-16 (a surrogate pair for 𝒜); longer ones are code points.
        if all(len(u) <= 4 for u in units):
            table[m.group(1)] = b"".join(int(u, 16).to_bytes(2, "big") for u in units).decode("utf-16-be", "replace")
        else:
            table[m.group(1)] = "".join(chr(int(u, 16)) for u in units)
    return table


def unicode_math():
    """Command → Unicode, from unicode-math's table."""
    table = {}
    for m in re.finditer(r'\\UnicodeMathSymbol\{"([0-9A-F]+)\}\{(\\[A-Za-z]+)\s*\}', Path(kpse("unicode-math-table.tex")).read_text()):
        table.setdefault(m.group(2), chr(int(m.group(1), 16)))
    return table


def metrics(font):
    """Code → (height, depth, next larger code), from the font's TFM; heights
    and depths in em."""
    pl = subprocess.check_output(["tftopl", kpse(font + ".tfm")], text=True)
    out = {}
    for m in re.finditer(r"\(CHARACTER ([OC]) (\S+)(.*?)\n   \)", pl, re.S):
        code = int(m.group(2), 8) if m.group(1) == "O" else ord(m.group(2))
        height = re.search(r"\(CHARHT R ([-\d.]+)\)", m.group(3))
        depth = re.search(r"\(CHARDP R ([-\d.]+)\)", m.group(3))
        larger = re.search(r"\(NEXTLARGER ([OC]) (\S+)\)", m.group(3))
        out[code] = (
            float(height.group(1)) if height else 0.0,
            float(depth.group(1)) if depth else 0.0,
            (int(larger.group(2), 8) if larger.group(1) == "O" else ord(larger.group(2))) if larger else None,
        )
    return out


def letter(alphabet, name):
    capital, small, holes = ALPHABETS[alphabet]
    if name in holes:
        return holes[name]
    if name.isupper():
        return chr(capital + ord(name) - ord("A"))
    return chr(small + ord(name) - ord("a"))


def build():
    names = {family: glyph_names(font) for family, font in FONTS.items()}
    to_unicode = unicode_of_names()
    commands = {}  # (family, code) → [(command, class, kind)]
    for kind, cmd, cls, family, code in declarations():
        commands.setdefault((family, code), []).append((cmd, cls, kind))

    def unicode_of(family, code):
        name = names[family].get(code)
        return to_unicode.get(f"tfm:{FONTS[family]}/{name}", to_unicode.get(name, ""))

    def command_of(family, code):
        """The KaTeX command for a glyph, and the class it is declared with."""
        options = [(KATEX_SPELLING.get(c, c), cls) for c, cls, _ in commands.get((family, code), [])]
        known = [c for c, _ in options if c not in KATEX_MISSING]
        latex = next((p for p in PREFERRED if p in known), known[0] if known else "")
        cls = next((cls for c, cls in options if c == latex), options[0][1] if options else "")
        return latex, CLASSES.get(cls, "ord")

    table = {family: {} for family in FONTS}

    def put(family, code, latex, cls, unicode, **extra):
        unicode = unicode or UNLISTED_UNICODE.get(latex, "")
        table[family][code] = dict(latex=latex or "", unicode=unicode, cls=cls, **extra)

    # OML: math italic letters, Greek, old-style digits, and a few symbols.
    for code, name in names["oml"].items():
        if code <= 0x0A:
            put("oml", code, "\\var" + GREEK_CAPITALS[code], "ord", GREEK_CAPITAL_LETTERS[code])
        elif re.fullmatch(r"[A-Za-z]", name):
            put("oml", code, name, "ord", name)
        elif 0x30 <= code <= 0x39:
            put("oml", code, str(code - 0x30), "ord", str(code - 0x30))
        elif code == 0x2C:
            put("oml", code, "", "piece", "", piece="lhook")
        elif code == 0x2D:
            put("oml", code, "", "piece", "", piece="rhook")
        elif code == 0x7E:
            put("oml", code, "\\vec", "accent", "\u20D7")
        elif code == 0x7F:
            put("oml", code, "", "accent", "\u2040")  # the tie: no math command
        else:
            latex, cls = command_of("oml", code)
            # pdfTeX's list reads mu as the micro sign.
            put("oml", code, latex, cls, "μ" if name == "mu" else unicode_of("oml", code))

    # OMS: symbols, calligraphic capitals, and the pieces of composites.
    for code, name in names["oms"].items():
        if 0x41 <= code <= 0x5A:
            put("oms", code, "\\mathcal{%s}" % name, "ord", letter("cal", name))
        elif code == 0x36:
            put("oms", code, "\\not", "piece", "\u0338", piece="not")
        elif code == 0x37:
            put("oms", code, "", "piece", "", piece="mapstochar")
        elif code == 0x70:
            put("oms", code, "", "radical", "√", piece="radical")
        elif code == 0x30:
            put("oms", code, "\\prime", "ord", "′")
        else:
            latex, cls = command_of("oms", code)
            # Angle brackets are the mathematical ones, not the CJK ones.
            # \cdot, \circ, and \bullet keep the characters every PDF gives
            # them (· ◦ •): LaTeX's list items open with these glyphs, and the
            # parser knows a list by them.
            fixed = {0x68: "⟨", 0x69: "⟩", 0x01: "·", 0x0D: "◯", 0x0E: "◦", 0x0F: "•"}
            put("oms", code, latex, cls, fixed.get(code, unicode_of("oms", code)))

    # OMX: sized delimiters (TFM NEXTLARGER chains, small to large), big
    # operators in their text and display forms, wide accents, radicals, and
    # the pieces of extensible delimiters and braces.
    chains = {
        "(": [0x00, 0x10, 0x12, 0x20], ")": [0x01, 0x11, 0x13, 0x21], "[": [0x02, 0x68, 0x14, 0x22],
        "]": [0x03, 0x69, 0x15, 0x23], "\\lfloor": [0x04, 0x6A, 0x16, 0x24], "\\rfloor": [0x05, 0x6B, 0x17, 0x25],
        "\\lceil": [0x06, 0x6C, 0x18, 0x26], "\\rceil": [0x07, 0x6D, 0x19, 0x27], "\\{": [0x08, 0x6E, 0x1A, 0x28],
        "\\}": [0x09, 0x6F, 0x1B, 0x29], "\\langle": [0x0A, 0x44, 0x1C, 0x2A], "\\rangle": [0x0B, 0x45, 0x1D, 0x2B],
        "/": [0x0E, 0x2E, 0x1E, 0x2C], "\\backslash": [0x0F, 0x2F, 0x1F, 0x2D],
    }
    delimiter_unicode = {
        "(": "(", ")": ")", "[": "[", "]": "]", "\\lfloor": "⌊", "\\rfloor": "⌋", "\\lceil": "⌈", "\\rceil": "⌉",
        "\\{": "{", "\\}": "}", "\\langle": "⟨", "\\rangle": "⟩", "/": "/", "\\backslash": "\\",
    }
    for delim, codes in chains.items():
        cls = "open" if delim in ("(", "[", "\\lfloor", "\\lceil", "\\{", "\\langle") else "ord" if delim in ("/", "\\backslash") else "close"
        for size, code in enumerate(codes, start=1):
            put("omx", code, delim, cls, delimiter_unicode[delim], size=size)
    put("omx", 0x0C, "|", "ord", "|", piece="vrep")
    put("omx", 0x0D, "\\|", "ord", "‖", piece="vrep")
    operators = [
        ("\\bigsqcup", 0x46, 0x47, "⨆"), ("\\oint", 0x48, 0x49, "∮"), ("\\bigodot", 0x4A, 0x4B, "⨀"),
        ("\\bigoplus", 0x4C, 0x4D, "⨁"), ("\\bigotimes", 0x4E, 0x4F, "⨂"), ("\\sum", 0x50, 0x58, "∑"),
        ("\\prod", 0x51, 0x59, "∏"), ("\\int", 0x52, 0x5A, "∫"), ("\\bigcup", 0x53, 0x5B, "⋃"),
        ("\\bigcap", 0x54, 0x5C, "⋂"), ("\\biguplus", 0x55, 0x5D, "⨄"), ("\\bigwedge", 0x56, 0x5E, "⋀"),
        ("\\bigvee", 0x57, 0x5F, "⋁"), ("\\coprod", 0x60, 0x61, "∐"),
    ]
    for latex, text_code, display_code, unicode in operators:
        put("omx", text_code, latex, "op", unicode)
        put("omx", display_code, latex, "op", unicode, display=True)
    for code in (0x62, 0x63, 0x64):
        put("omx", code, "\\widehat", "accent", "\u0302", wide=True)
    for code in (0x65, 0x66, 0x67):
        put("omx", code, "\\widetilde", "accent", "\u0303", wide=True)
    for code in (0x70, 0x71, 0x72, 0x73):
        put("omx", code, "", "radical", "√", piece="radical", size=code - 0x6F)
    pieces = {
        0x30: "lparen-top", 0x31: "rparen-top", 0x40: "lparen-bot", 0x41: "rparen-bot", 0x42: "lparen-rep",
        0x43: "rparen-rep", 0x32: "lbrack-top", 0x33: "rbrack-top", 0x34: "lbrack-bot", 0x35: "rbrack-bot",
        0x36: "lbrack-rep", 0x37: "rbrack-rep", 0x38: "lbrace-top", 0x39: "rbrace-top", 0x3A: "lbrace-bot",
        0x3B: "rbrace-bot", 0x3C: "lbrace-mid", 0x3D: "rbrace-mid", 0x3E: "brace-rep", 0x3F: "arrow-rep",
        0x74: "radical-bot", 0x75: "radical-rep", 0x76: "radical-top", 0x77: "dblarrow-rep", 0x78: "arrow-top",
        0x79: "arrow-bot", 0x7A: "hbrace-down-left", 0x7B: "hbrace-down-right", 0x7C: "hbrace-up-left",
        0x7D: "hbrace-up-right", 0x7E: "dblarrow-top", 0x7F: "dblarrow-bot",
    }
    for code, piece in pieces.items():
        put("omx", code, "", "piece", "", piece=piece)

    # OT1 in math: upright Greek capitals, letters, digits, punctuation, accents.
    for code, name in names["ot1"].items():
        if code <= 0x0A:
            put("ot1", code, "\\" + GREEK_CAPITALS[code], "ord", GREEK_CAPITAL_LETTERS[code])
        elif code in ACCENTS:
            put("ot1", code, ACCENTS[code][0], "accent", ACCENTS[code][1])
        elif re.fullmatch(r"[A-Za-z]", name):
            put("ot1", code, name, "ord", name, upright=True)
        elif 0x30 <= code <= 0x39:
            put("ot1", code, str(code - 0x30), "ord", str(code - 0x30))
        elif code in OT1_PUNCTUATION:
            latex, cls = OT1_PUNCTUATION[code]
            put("ot1", code, latex, cls, latex)

    # The AMS fonts: symbols, blackboard capitals, and a few names amssymb
    # leaves out of its declarations.
    for family in ("msa", "msb"):
        for code, name in names[family].items():
            if family == "msb" and 0x41 <= code <= 0x5A:
                put(family, code, "\\mathbb{%s}" % name, "ord", letter("bb", name))
                continue
            latex, cls = command_of(family, code)
            put(family, code, latex, cls, unicode_of(family, code))
    for code, latex, cls, unicode in [
        (0x55, "\\yen", "ord", "¥"), (0x58, "\\checkmark", "ord", "✓"), (0x70, "\\ulcorner", "open", "⌜"),
        (0x71, "\\urcorner", "close", "⌝"), (0x72, "\\circledR", "ord", "®"), (0x78, "\\llcorner", "open", "⌞"),
        (0x79, "\\lrcorner", "close", "⌟"), (0x7A, "\\maltese", "ord", "✠"), (0x40, "\\sqsubset", "rel", "⊏"),
        (0x41, "\\sqsupset", "rel", "⊐"),
    ]:
        put("msa", code, latex, cls, unicode)
    for code, piece in [(0x39, "dash"), (0x4B, "dash-arrow-right"), (0x4C, "dash-arrow-left")]:
        put("msa", code, "", "piece", "", piece=piece)
    for code in (0x5B, 0x5C):
        put("msb", code, "\\widehat", "accent", "\u0302", wide=True)
    for code in (0x5D, 0x5E):
        put("msb", code, "\\widetilde", "accent", "\u0303", wide=True)
    put("msb", 0x66, "\\mho", "ord", "℧")
    put("msb", 0x7E, "\\hbar", "ord", "ℏ")
    put("msb", 0x7D, "\\hslash", "ord", "ℏ")

    # Fraktur, script, and latexsym.
    for code, name in names["euf"].items():
        if code < 128 and re.fullmatch(r"[A-Za-z]", name):
            put("euf", code, "\\mathfrak{%s}" % name, "ord", letter("frak", name))
    for code, name in names["rsfs"].items():
        if re.fullmatch(r"[A-Z]", name):
            put("rsfs", code, "\\mathscr{%s}" % name, "ord", letter("cal", name))
    for (family, code), _ in sorted(commands.items()):
        if family == "lasy":
            latex, cls = command_of("lasy", code)
            if latex:
                put("lasy", code, latex, cls, unicode_of("lasy", code))

    # esint: each integral in its text size, and in its display size, the
    # text size's next larger glyph. Its font's glyph names say nothing (the
    # text layer reads \int as an acute accent, a display \int as a
    # circumflex): the character comes from the command, esint's \intop
    # being \int.
    esint_metrics = metrics(FONTS["esint"])
    by_command = unicode_math()
    for (family, code), options in sorted(commands.items()):
        if family != "esint":
            continue
        latex, cls = command_of("esint", code)
        command = options[0][0].removesuffix("op")
        unicode = by_command.get(command, ESINT_UNLISTED.get(command, ""))
        put("esint", code, latex, cls, unicode)
        larger = esint_metrics[code][2]
        if larger is not None:
            put("esint", larger, latex, cls, unicode, display=True)

    # Every entry's box.
    for family, font in FONTS.items():
        font_metrics = metrics(font)
        for code, entry in table[family].items():
            height, depth, _ = font_metrics.get(code, (0.0, 0.0, None))
            entry["box"] = [round(height, 3), round(depth, 3)]
    return table


def write(table):
    def js(value):
        return json.dumps(value, ensure_ascii=False)

    lines = []
    for family, entries in table.items():
        lines.append(f"  {family}: {{")
        for code in sorted(entries):
            e = entries[code]
            extra = {k: e[k] for k in ("size", "display", "piece", "wide", "upright") if k in e}
            row = [e["latex"], e["unicode"], e["cls"], e["box"][0], e["box"][1]] + ([extra] if extra else [])
            lines.append(f"    0x{code:02x}: {js(row)},")
        lines.append("  },")
    OUT.write_text(
        f"""// Generated by scripts/math-fonts/generate.py from TeX Live's fonts,
// declarations, and pdfTeX's glyph-to-Unicode list. Do not edit: change the
// generator and run it again.
//
// What each character code of a TeX math family draws. A math glyph's code
// names its symbol whatever the PDF maps it to: without a Unicode map the
// text layer reads ϵ as a control character and ℓ as a backtick, and with
// pdfTeX's map the big operators read as letters (P0-F memo §1.2).

import type {{ MathFamily }} from "@/lib/parse/pdf/glyphs";

export type MathClass = "ord" | "op" | "bin" | "rel" | "open" | "close" | "punct" | "accent" | "radical" | "piece";
export type MathGlyph = {{
  latex: string; // KaTeX's command; "" for a piece with no command of its own
  unicode: string; // the character a reader sees; "" for a piece
  cls: MathClass;
  size?: number; // a sized delimiter or radical: 1 (\\big) to 4 (\\Bigg)
  display?: true; // the display form of a big operator
  piece?: string; // a part of a composite: "not", "mapstochar", "lhook", "lparen-top", "radical", …
  wide?: true; // a wide accent (\\widehat, \\widetilde)
  upright?: true; // an upright letter (an operator name, \\mathrm)
  box: [number, number]; // height and depth in em (tftopl): big operators hang below their origin
}};

type Row = [string, string, MathClass, number, number, Pick<MathGlyph, "size" | "display" | "piece" | "wide" | "upright">?];

// code: [latex, unicode, class, height, depth, extras]
const TABLE: Record<MathFamily, Record<number, Row>> = {{
{chr(10).join(lines)}
}};

// Each entry is built once, as the module loads: a long book asks for its
// glyphs' entries millions of times, and no caller changes one.
const GLYPHS = Object.fromEntries(
  Object.entries(TABLE).map(([family, rows]) => [
    family,
    Object.fromEntries(
      Object.entries(rows).map(([code, [latex, unicode, cls, height, depth, extra]]) => [code, {{ latex, unicode, cls, box: [height, depth], ...extra }}]),
    ),
  ]),
) as Record<MathFamily, Record<number, MathGlyph>>;

export function mathGlyph(family: MathFamily, code: number): MathGlyph | null {{
  return GLYPHS[family][code] ?? null;
}}
"""
    )
    print(f"{OUT}: " + ", ".join(f"{family} {len(entries)}" for family, entries in table.items()))


if __name__ == "__main__":
    write(build())
