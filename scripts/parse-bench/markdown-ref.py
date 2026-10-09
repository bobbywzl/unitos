"""The Markdown and text file benchmark's references (scripts/parse-bench/markdown.mts).

    python3 -I scripts/parse-bench/markdown-ref.py [--force]

Fetches the corpus (markdown-corpus.json) into .bench/markdown/files/ and
writes one reference per file into .bench/markdown/refs/. The reference is
built without the code under test:

- A Markdown file is read by markdown-it (markdown-it-py, CommonMark with
  GFM tables and strikethrough, task lists, footnotes, front matter, and
  dollar math), and its HTML walked into units.
- A spec example's units are walked from the spec's own expected HTML.
- A text file's words are its bytes decoded in the encoding the corpus
  names. Where the corpus names a twin (Project Gutenberg's HTML edition of
  the same book), the twin's HTML is walked into units: its headings, its
  paragraphs, and its verse lines. A file marked lines (a log, a field
  list) has one unit per line of the file. An RFC's units are its section
  headings, found from its own layout (a line at the margin that opens
  with a section number).

A unit is {k, l, t, br}: k the kind (h heading, p paragraph, q quote, li
list item, code, cell, hr, math, line), l the level (a heading's 1 to 6, a
list item's depth from 1), t the text, br the word offsets where a line
break falls inside the unit (null when the reference does not know them).
Links are [text, href] pairs, figures the absolute image URLs.

Needs: python3 -m pip install markdown-it-py mdit-py-plugins
"""

import hashlib
import html
import json
import os
import re
import subprocess
import sys
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BENCH = os.path.join(ROOT, ".bench", "markdown")
FILES = os.path.join(BENCH, "files")
REFS = os.path.join(BENCH, "refs")
CORPUS = os.path.join(HERE, "markdown-corpus.json")
REF_VERSION = 3


# ── Fetch ────────────────────────────────────────────────────────────────────


def curl(url, dest):
    tmp = dest + ".part"
    subprocess.run(["curl", "-sSfL", "--retry", "2", "-o", tmp, url], check=True)
    os.replace(tmp, dest)


def file_path(entry):
    return os.path.join(FILES, entry["id"] + ".bin")


def derive(source_bytes, how, source_encoding):
    text = source_bytes.decode(source_encoding)
    if text.startswith("﻿"):
        text = text[1:]
    if how == "crlf-utf-8-bom":
        return b"\xef\xbb\xbf" + text.replace("\r\n", "\n").replace("\n", "\r\n").encode("utf-8")
    if how == "utf-16le-bom":
        return b"\xff\xfe" + text.encode("utf-16-le")
    if how == "utf-16be-bom":
        return b"\xfe\xff" + text.encode("utf-16-be")
    if how == "windows-1252":
        return text.encode("cp1252", errors="replace")
    raise ValueError(how)


def encoding_of(entry, by_id):
    if "derive" in entry:
        how = entry["derive"]["as"]
        return {"crlf-utf-8-bom": "utf-8-sig", "utf-16le-bom": "utf-16", "utf-16be-bom": "utf-16", "windows-1252": "cp1252"}[how]
    return entry.get("encoding", "utf-8")


def fetch(corpus):
    os.makedirs(FILES, exist_ok=True)
    by_id = {e["id"]: e for e in corpus["files"]}
    for spec in corpus["spec"]:
        dest = os.path.join(FILES, "spec-" + spec["id"] + ".txt")
        if not os.path.exists(dest):
            print("fetch", spec["id"], file=sys.stderr)
            curl(spec["url"], dest)
    for entry in corpus["files"]:
        if "url" in entry:
            dest = file_path(entry)
            if not os.path.exists(dest):
                print("fetch", entry["id"], file=sys.stderr)
                curl(entry["url"], dest)
            if entry.get("twin"):
                twin = os.path.join(FILES, entry["id"] + ".twin.htm")
                if not os.path.exists(twin):
                    curl(entry["twin"], twin)
    for entry in corpus["files"]:
        if "derive" in entry:
            dest = file_path(entry)
            if os.path.exists(dest):
                continue
            src = by_id[entry["derive"]["from"]]
            with open(file_path(src), "rb") as f:
                data = derive(f.read(), entry["derive"]["as"], encoding_of(src, by_id))
            with open(dest, "wb") as f:
                f.write(data)


# ── HTML → units ─────────────────────────────────────────────────────────────

BLOCK_LEAVES = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "td", "th", "dt", "dd", "figcaption", "summary", "caption"}
CONTAINERS = {"div", "blockquote", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "section", "article", "body", "html",
              "details", "dl", "figure", "header", "footer", "nav", "aside", "main", "center", "picture", "hr"}
SKIP = {"script", "style", "head", "title", "template", "noscript"}
VOID = {"br", "img", "hr", "input", "meta", "link", "source", "wbr", "col", "area", "base", "embed", "param", "track"}
WORD_RX = re.compile(r"[぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]|[^\W_぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]+", re.UNICODE)


def words(text):
    return WORD_RX.findall(text.replace("­", ""))


def absolute(url):
    return bool(re.match(r"^(https?:|mailto:)", url or "", re.I))


class Walker(HTMLParser):
    """HTML → units. A leaf (p, h1-6, pre, td, ...) is one unit; text
    outside any leaf (inside a div, a list item, a quote) is a unit of its
    own; a list item's own words are a list item unit at its depth."""

    def __init__(self, options=None):
        super().__init__(convert_charrefs=True)
        self.options = options or {}
        self.units = []
        self.links = []
        self.figures = []
        self.stack = []  # open tags
        self.skip = 0
        self.leaf = None  # {k, l, parts, br, tag}
        self.lists = []  # "ul" / "ol"
        self.quote = 0
        self.row = 0
        self.col = 0
        self.link = None  # [href, start text length]
        self.task = None
        self.pre = 0
        self.math = 0
        self.poem = 0

    # A unit starts where a leaf opens, or where loose text meets no leaf.
    def open_leaf(self, kind, level=0, tag=None):
        self.close_leaf()
        self.leaf = {"k": kind, "l": level, "parts": [], "br": [], "tag": tag}

    def close_leaf(self):
        leaf = self.leaf
        if leaf is None:
            return
        self.leaf = None
        raw = "".join(leaf["parts"])
        if leaf["k"] == "code":
            text = raw[:-1] if raw.endswith("\n") else raw
            if text.strip() or self.options.get("empty_code"):
                self.units.append({"k": "code", "l": 0, "t": text, "br": None})
            return
        if leaf["k"] == "math":
            text = raw.strip()
            if text:
                self.units.append({"k": "math", "l": 0, "t": text, "br": None})
            return
        # Breaks: the word offsets where a <br> (or a verse line's end) falls.
        segments = raw.split("\x00")
        br = []
        n = 0
        for seg in segments[:-1]:
            n += len(words(seg))
            if n > 0 and (not br or br[-1] != n):
                br.append(n)
        text = re.sub(r"\s+", " ", raw.replace("\x00", " ")).strip()
        total = len(words(text))
        br = [b for b in br if 0 < b < total]
        if not text:
            return
        unit = {"k": leaf["k"], "l": leaf["l"], "t": text, "br": br}
        if leaf["k"] == "li":
            unit["lt"] = "task" if self.task is not None else (self.lists[-1] if self.lists else "ul")
        if leaf["k"] == "cell":
            unit["row"] = leaf.get("row", 0)
            unit["col"] = leaf.get("col", 0)
        self.units.append(unit)

    def ensure_leaf(self):
        if self.leaf is not None:
            return
        if self.lists:
            self.open_leaf("li", len(self.lists))
        elif self.quote:
            self.open_leaf("q")
        else:
            self.open_leaf("p")

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class") or ""
        if tag in SKIP:
            self.skip += 1
            return
        if self.skip:
            return
        if tag not in VOID:
            self.stack.append(tag)
        if self.pre:
            return
        if self.math:
            return
        if tag in ("ul", "ol"):
            self.close_leaf()
            self.lists.append(tag)
            return
        if tag == "li":
            self.close_leaf()
            self.task = None
            return
        if tag == "blockquote":
            self.close_leaf()
            self.quote += 1
            return
        if tag == "tr":
            self.close_leaf()
            self.row += 1
            self.col = 0
            return
        if tag == "table":
            self.close_leaf()
            self.row = 0
            return
        if tag in ("td", "th"):
            self.col += 1
            self.open_leaf("cell", 0)
            self.leaf["row"] = self.row
            self.leaf["col"] = self.col
            return
        if tag == "pre":
            self.open_leaf("code")
            self.pre = 1
            return
        if "math" in cls.split() and ("block" in cls.split() or "display" in cls.split()):
            self.open_leaf("math")
            self.math = 1
            return
        if tag == "eq" or (tag == "span" and "math" in cls.split() and "inline" in cls.split()):
            self.ensure_leaf()
            self.leaf["parts"].append("$")
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.open_leaf("h", int(tag[1]))
            return
        if tag == "p" or tag in ("dt", "dd", "figcaption", "summary", "caption"):
            if self.lists:
                self.open_leaf("li", len(self.lists))
            elif self.quote:
                self.open_leaf("q")
            else:
                self.open_leaf("p")
            return
        if tag == "hr":
            self.close_leaf()
            self.units.append({"k": "hr", "l": 0, "t": "", "br": None})
            return
        if tag in ("div", "section", "article", "details", "figure", "center", "header", "footer", "aside", "nav", "main", "dl"):
            self.close_leaf()
            if self.options.get("poems") and re.search(r"\b(poem|stanza|verse)\b", cls):
                self.poem += 1
            return
        if tag == "br":
            if self.leaf is not None:
                self.leaf["parts"].append("\x00")
            return
        if tag == "input" and (a.get("type") or "").lower() == "checkbox":
            self.task = "checked" in a
            return
        if tag == "img":
            src = a.get("src") or ""
            if absolute(src):
                self.figures.append(src)
            return
        if tag == "a":
            href = a.get("href")
            if href is not None and (absolute(href) or href.startswith("#")) and not re.search(r"footnote", cls):
                self.ensure_leaf()
                self.link = [href, len("".join(self.leaf["parts"]))]
            return

    def handle_endtag(self, tag):
        if tag in SKIP:
            self.skip = max(0, self.skip - 1)
            return
        if self.skip:
            return
        # Close up to the matching tag.
        if tag in self.stack:
            while self.stack and self.stack[-1] != tag:
                self.stack.pop()
            if self.stack:
                self.stack.pop()
        else:
            return
        if tag == "pre":
            self.pre = 0
            self.close_leaf()
            return
        if self.pre:
            return
        if self.math and tag in ("div", "section", "p", "span"):
            self.math = 0
            self.close_leaf()
            return
        if tag == "eq" or (tag == "span" and self.leaf is not None and self.leaf["parts"] and False):
            if self.leaf is not None:
                self.leaf["parts"].append("$")
            return
        if tag == "a" and self.link is not None:
            if self.leaf is not None:
                text = "".join(self.leaf["parts"])[self.link[1]:].replace("\x00", " ")
                text = re.sub(r"\s+", " ", text).strip()
                if text:
                    self.links.append([text, self.link[0]])
            self.link = None
            return
        if tag in ("ul", "ol"):
            self.close_leaf()
            if self.lists:
                self.lists.pop()
            return
        if tag == "li":
            self.close_leaf()
            return
        if tag == "blockquote":
            self.close_leaf()
            self.quote = max(0, self.quote - 1)
            return
        if tag in BLOCK_LEAVES or tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self.close_leaf()
            return
        if tag in ("div", "section", "article", "details", "figure", "center", "header", "footer", "aside", "nav", "main", "dl", "table", "tr"):
            self.close_leaf()
            return

    def handle_data(self, data):
        if self.skip:
            return
        if self.pre or self.math:
            if self.leaf is not None:
                self.leaf["parts"].append(data)
            return
        if not data.strip() and self.leaf is None:
            return
        self.ensure_leaf()
        if self.poem and self.leaf is not None and "\n" in data.strip():
            # A verse line's end inside a poem block of the twin.
            data = data.replace("\n", "\x00")
        self.leaf["parts"].append(data)

    def result(self):
        self.close_leaf()
        return {"units": self.units, "links": self.links, "figures": self.figures}


def walk_html(source, options=None):
    w = Walker(options)
    w.feed(source)
    w.close()
    return w.result()


# ── Markdown → HTML (markdown-it) ────────────────────────────────────────────


def markdown_it():
    from markdown_it import MarkdownIt
    from mdit_py_plugins.dollarmath import dollarmath_plugin
    from mdit_py_plugins.footnote import footnote_plugin
    from mdit_py_plugins.front_matter import front_matter_plugin
    from mdit_py_plugins.tasklists import tasklists_plugin

    md = MarkdownIt("commonmark", {"html": True, "linkify": False}).enable(["table", "strikethrough"])
    md.use(front_matter_plugin).use(footnote_plugin).use(tasklists_plugin)
    md.use(dollarmath_plugin, allow_space=False, allow_digits=False, double_inline=True)
    return md


def front_matter_title(text):
    m = re.match(r"^---\n([\s\S]*?)\n---\n?", text)
    if not m:
        return None
    line = re.search(r"^title:\s*(.+)$", m.group(1), re.M)
    if not line:
        return None
    title = line.group(1).strip().strip("'\"").strip()
    return title or None


def markdown_ref(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    if text.startswith("﻿"):
        text = text[1:]
    md = markdown_it()
    rendered = md.render(text)
    out = walk_html(rendered)
    title = front_matter_title(text)
    if title:
        out["title"] = title
    return out


# ── Text files ───────────────────────────────────────────────────────────────

RFC_HEADING_RX = re.compile(r"^(?:\d+(?:\.\d+)*\.?|Appendix [A-Z](?:\.\d+)*\.?|[A-Z](?:\.\d+)+\.?)\s+\S")
RFC_NAMED = {"Abstract", "Status of this Memo", "Status of This Memo", "Copyright Notice", "Table of Contents", "Introduction",
             "References", "Acknowledgements", "Acknowledgments", "Full Copyright Statement", "Intellectual Property",
             "Authors' Addresses", "Author's Address", "Security Considerations", "Index"}
RFC_FOOTER_RX = re.compile(r"\[Page \d+\]\s*$")


def rfc_units(text):
    """An RFC's section headings, from its own layout: a line at the margin
    that opens with a section number (or names a standard section), no
    dot leaders (a contents line), outside the page furniture. The page
    footers and headers are optional words: a parse may drop them."""
    units = []
    optional = []
    lines = text.split("\n")
    for i, line in enumerate(lines):
        stripped = line.rstrip()
        if RFC_FOOTER_RX.search(stripped) or (i > 0 and lines[i - 1].startswith("\f")) or line.startswith("\f"):
            optional.append(stripped.replace("\f", ""))
            continue
        if not stripped.strip():
            continue
        if re.search(r"\.{3,}|\.( \.){2,}", stripped):
            continue
        prev_blank = i == 0 or not lines[i - 1].strip()
        next_blank = i + 1 >= len(lines) or not lines[i + 1].strip()
        # A heading at the margin; an older RFC indents its subsections, so
        # an indented numbered line stands alone between blank lines.
        at_margin = not stripped[0].isspace()
        body = stripped.strip()
        numbered = RFC_HEADING_RX.match(body)
        if (at_margin and (numbered or body in RFC_NAMED)) or (numbered and re.match(r"\d+\.\d+", body) and next_blank and len(stripped) - len(body) <= 9 and not body.endswith(".")):
            if prev_blank and len(body) <= 72:
                units.append({"k": "h", "l": 0, "t": re.sub(r"\s+", " ", body), "br": None})
    return units, optional


def text_ref(entry, data, encoding):
    text = data.decode(encoding)
    if text.startswith("﻿"):
        text = text[1:]
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    out = {"text": text, "units": [], "links": [], "figures": [], "headingsOnly": False}
    if entry.get("lines"):
        out["units"] = [{"k": "line", "l": 0, "t": re.sub(r"\s+", " ", ln).strip(), "br": None} for ln in text.split("\n") if ln.strip()]
    elif entry["id"].startswith("rfc"):
        units, optional = rfc_units(text)
        out["units"] = units
        out["optional"] = optional
        out["headingsOnly"] = True
    return out


def twin_ref(entry):
    path = os.path.join(FILES, entry["id"] + ".twin.htm")
    with open(path, "rb") as f:
        raw = f.read()
    m = re.search(rb"charset=[\"']?([A-Za-z0-9_-]+)", raw[:4096])
    charset = m.group(1).decode() if m else "utf-8"
    try:
        source = raw.decode(charset)
    except (LookupError, UnicodeDecodeError):
        source = raw.decode("utf-8", errors="replace")
    # The book only: between Project Gutenberg's start and end lines, which
    # the text edition carries too.
    start = re.search(r"\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG[^\n]*?\*\*\*", source, re.I)
    end = re.search(r"\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG", source, re.I)
    body = source[start.end() if start else 0:end.start() if end else len(source)]
    # A start or end line inside an element: drop the cut tag's remains.
    body = re.sub(r"^[^<]*>", "", body)
    walked = walk_html(body, {"poems": True})
    return walked["units"]


# ── Spec examples ────────────────────────────────────────────────────────────

EXAMPLE_RX = re.compile(r"^`{32} example(?: ([a-z ]+))?\n([\s\S]*?)^\.\n([\s\S]*?)^`{32}$", re.M)


def spec_examples(path, extensions_only):
    with open(path, encoding="utf-8") as f:
        text = f.read()
    out = []
    # The spec's own headings: those outside the examples.
    outside = EXAMPLE_RX.sub(lambda m: " " * len(m.group(0)), text)
    heading_at = [(m.start(), m.group(2).strip()) for m in re.finditer(r"^(#{1,2}) (.+)$", outside, re.M)]
    n = 0
    for m in EXAMPLE_RX.finditer(text):
        n += 1
        ext = (m.group(1) or "").strip()
        if extensions_only and not ext:
            continue
        section = ""
        for at, name in heading_at:
            if at < m.start():
                section = name
        md = m.group(2).replace("→", "\t")
        expected = m.group(3).replace("→", "\t")
        walked = walk_html(expected)
        out.append({"n": n, "section": section, "extension": ext or None, "md": md, **walked})
    return out


# ── Main ─────────────────────────────────────────────────────────────────────


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()


def main():
    force = "--force" in sys.argv
    with open(CORPUS, encoding="utf-8") as f:
        corpus = json.load(f)
    fetch(corpus)
    os.makedirs(REFS, exist_ok=True)
    for spec in corpus["spec"]:
        dest = os.path.join(REFS, "spec-" + spec["id"] + ".json")
        if current(dest) and not force:
            continue
        cases = spec_examples(os.path.join(FILES, "spec-" + spec["id"] + ".txt"), spec["id"] == "gfm")
        with open(dest, "w", encoding="utf-8") as f:
            json.dump({"version": REF_VERSION, "cases": cases}, f, ensure_ascii=False)
        print("ref", spec["id"], len(cases), "examples", file=sys.stderr)
    by_id = {e["id"]: e for e in corpus["files"]}
    for entry in corpus["files"]:
        dest = os.path.join(REFS, entry["id"] + ".json")
        if current(dest) and not force:
            continue
        path = file_path(entry)
        with open(path, "rb") as f:
            data = f.read()
        # A derived file has its source's shape: its twin, its lines.
        shape = by_id[entry["derive"]["from"]] if "derive" in entry else entry
        if entry["kind"] == "md":
            text = data.decode(encoding_of(entry, None))
            ref = markdown_ref(text)
            ref["text"] = text.lstrip("﻿").replace("\r\n", "\n")
        else:
            ref = text_ref({**entry, "lines": shape.get("lines"), "id": shape["id"]}, data, encoding_of(entry, None))
            if shape.get("twin"):
                ref["units"] = twin_ref(shape)
                ref["twin"] = True
        ref["version"] = REF_VERSION
        ref["sha256"] = sha256(path)
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(ref, f, ensure_ascii=False)
        print("ref", entry["id"], len(ref["units"]), "units", file=sys.stderr)


def current(dest):
    """A reference built by this version of the builder."""
    if not os.path.exists(dest):
        return False
    with open(dest, encoding="utf-8") as f:
        return json.load(f).get("version") == REF_VERSION


if __name__ == "__main__":
    main()
