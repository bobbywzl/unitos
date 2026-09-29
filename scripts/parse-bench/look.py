# The look a reference's page shows beyond its words, measured on its PDF (PyMuPDF) and written into the
# reference (scripts/parse-bench/model.ts):
#   a paragraph's first-line indent in points (indentPt; the kind, `indent`, stays the reference's own);
#   the space under a paragraph or a list, beyond the line pitch, to the next one below it (spaceAfter);
#   a list's items justified (align) and the space between two items (itemSpace);
#   equations numbered at the left (labelSide), where most of a document's labels stand there.
# Each only where the page shows it plainly: a block whose lines are not found, a space with something set
# between (over two lines), a hanging or a block indent the reference does not name, stays unmeasured.
# The synthetic and arXiv builders run it on every reference they write; run it on a hand-made one.
#   python3 scripts/parse-bench/look.py <reference.json> [--write] [--quiet]
import collections, json, os, re, statistics, sys, unicodedata
import pymupdf

ref_path = sys.argv[1]
write = "--write" in sys.argv
quiet = "--quiet" in sys.argv
raw = open(ref_path).read()
ref = json.loads(raw)
# Keep the file's own indentation (hand references use one space, generated ones two).
INDENT = len(re.match(r"\{\n( *)", raw).group(1)) if re.match(r"\{\n( *)", raw) else 2
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
pdf_path = ref["source"].get("pdf")
if not pdf_path:
    print(f"{ref['id']}: no PDF"); sys.exit(0)
doc = pymupdf.open(os.path.join(ROOT, pdf_path))
first, last = ref.get("pages") or [1, doc.page_count]


def letters(t):
    t = unicodedata.normalize("NFKD", t)
    return re.sub(r"[^a-z0-9]", "", t.lower())


def page_lines(pno):
    """Visual lines: PyMuPDF lines joined when they share a baseline and nearly touch."""
    raw = []
    for b in doc[pno - 1].get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            spans = [s for s in l["spans"] if s["text"].strip()]
            if not spans or abs(l["dir"][0] - 1) > 0.01:
                continue
            raw.append({
                "page": pno,
                "x0": min(s["bbox"][0] for s in spans),
                "x1": max(s["bbox"][2] for s in spans),
                "y": statistics.median(s["origin"][1] for s in spans),
                "size": statistics.median(s["size"] for s in spans),
                "text": "".join(s["text"] for s in l["spans"]),
            })
    raw.sort(key=lambda r: (round(r["y"]), r["x0"]))
    out = []
    for r in raw:
        prev = out[-1] if out else None
        if prev and abs(prev["y"] - r["y"]) < 2 and -1 <= r["x0"] - prev["x1"] < 1.5 * r["size"]:
            prev["x1"] = max(prev["x1"], r["x1"]); prev["text"] += " " + r["text"]; continue
        out.append(dict(r))
    return out


def columns(lines, width):
    """The page's text columns (align-check.py): where three or more lines of a fifth of the page's width or
    more start; a column ends where most of the lines that start at its left edge end."""
    long = sorted((l for l in lines if l["x1"] - l["x0"] >= 0.2 * width), key=lambda l: l["x0"])
    starts = []
    for l in long:
        if starts and l["x0"] - starts[-1][-1]["x0"] <= 6: starts[-1].append(l)
        else: starts.append([l])
    cols = []
    for group in (g for g in starts if len(g) >= 3):
        left = min(l["x0"] for l in group)
        if cols and cols[-1][2] > left + 6:
            continue
        cols.append([left, max(l["x1"] for l in group), statistics.median(l["x1"] for l in group)])
    for k, c in enumerate(cols):
        nxt = cols[k + 1][0] if k + 1 < len(cols) else float("inf")
        ends = [l["x1"] for l in lines if abs(l["x0"] - c[0]) <= 2 and l["x1"] < nxt]
        if not ends:
            c[1] = c[2]; continue
        counts = collections.Counter(round(e) for e in ends)
        shared = [e for e, n in counts.items() if n >= 3 and e - c[0] >= 0.95 * (max(ends) - c[0])]
        c[1] = max(shared) if shared else max(ends)
    return [(c[0], c[1]) for c in cols] or [(0.0, width)]


ordered = []  # every line in range, in reading order: page, then column, then height
for p in range(first, last + 1):
    lines = page_lines(p)
    cols = columns(lines, doc[p - 1].rect.width)
    for l in lines:
        inside = [k for k, c in enumerate(cols) if c[0] - 6 <= l["x0"] <= c[1]]
        k = inside[0] if inside else min(range(len(cols)), key=lambda k: abs(cols[k][0] - l["x0"]))
        l["col"] = k
        l["left"], l["right"] = cols[k]
        # A line across the columns belongs to the page's width.
        if len(cols) > 1 and l["x1"] > cols[k][1] + 12:
            l["left"], l["right"] = cols[0][0], cols[-1][1]
    ordered += sorted(lines, key=lambda l: (l["col"], l["y"]))
for i, l in enumerate(ordered):
    l["i"] = i
    l["key"] = letters(l["text"])


class Lines(list):
    """A block's lines; `whole` when they reach its last letters (its last line is among them)."""
    whole = False


def locate(text, cursor):
    """The lines that print a block's words one after another: the first line's letters open the block's,
    each next line's follow on (a line of three letters or fewer, a formula's piece, only where its letters
    come next; else it is skipped). Searches from the cursor on, then from the start (a float set out of
    order)."""
    want = letters(text)
    if len(want) < 6:
        return None
    for start in list(range(cursor, len(ordered))) + list(range(0, cursor)):
        head = ordered[start]["key"]
        if len(head) < 4 or want.find(head[:24]) not in range(0, 4):
            continue
        found, at = Lines([ordered[start]]), want.find(head[:24]) + len(head)
        j = start + 1
        misses = 0
        while at < len(want) and j < len(ordered) and misses <= 3:
            t = ordered[j]["key"]
            k = want.find(t, max(0, at - 3)) if t else -1
            if 0 <= k <= at + (6 if len(t) >= 3 else 1):
                found.append(ordered[j]); at = k + len(t); misses = 0
            else:
                misses += 2 if len(t) >= 3 else 1
            j += 1
        if at >= 0.9 * len(want):
            found.whole = at >= len(want) - 1
            return found
    return None


def text_of(spans):
    return "".join(s.get("text", "") for s in spans)


# The document's line pitch: the median baseline step between the lines of one block.
steps = []
located = []
cursor = 0
for i, b in enumerate(ref["blocks"]):
    if b["kind"] in ("paragraph", "heading", "title", "quote", "footnote"):
        found = locate(text_of(b["spans"]), cursor)
        located.append((i, "block", found))
    elif b["kind"] == "list":
        items = []
        for it in b["items"]:
            found = locate((it.get("marker") or "") + " " + text_of(it["spans"]), cursor) or locate(text_of(it["spans"]), cursor)
            items.append(found)
            if found: cursor = found[-1]["i"] + 1
        located.append((i, "list", items))
        continue
    else:
        located.append((i, "other", None))
        continue
    if found:
        cursor = found[-1]["i"] + 1
        full = [l for l in found if len(l["key"]) >= 3]
        for a, c in zip(full, full[1:]):
            if a["page"] == c["page"] and a["col"] == c["col"] and 0 < c["y"] - a["y"] < 3 * a["size"]:
                steps.append(round(c["y"] - a["y"], 1))
pitch = statistics.median(steps) if steps else None


def own_pitch(lines):
    """A block's own line pitch, from its lines of words (a formula's piece on a line of its own, a limit
    under a sum, would shorten it)."""
    full = [l for l in lines if len(l["key"]) >= 3]
    s = [c["y"] - a["y"] for a, c in zip(full, full[1:]) if a["page"] == c["page"] and a["col"] == c["col"] and 0 < c["y"] - a["y"] < 3 * a["size"]]
    return statistics.median(s) if s else pitch


def gap(a_lines, b_lines):
    """The space between a block's last line and the next block's first, beyond the line pitch, in whole
    points; None when they are not one above the other in one column of one page."""
    a, c = a_lines[-1], b_lines[0]
    if a["page"] != c["page"] or a["col"] != c["col"] or c["y"] <= a["y"]:
        return None
    step = own_pitch(a_lines) or own_pitch(b_lines)
    if not step:
        return None
    # More than two lines' space: something the reference sets apart stands between (a float, a display).
    space = c["y"] - a["y"] - step
    return max(0, round(space)) if space <= 2 * step else None


report = []
changes = 0
ends_at = {}  # block index -> its last lines (for the space after)
starts_at = {}
for i, kind, found in located:
    b = ref["blocks"][i]
    if kind == "block" and found:
        # The space after needs the block's last line.
        if found.whole: ends_at[i] = found
        starts_at[i] = found
    # A list's first and last lines only where its first and last items are found.
    if kind == "list" and found:
        if found[-1] and found[-1].whole: ends_at[i] = found[-1]
        if found[0]: starts_at[i] = found[0]

for i, kind, found in located:
    b = ref["blocks"][i]
    if kind == "block" and b["kind"] == "paragraph" and found and b.get("align") not in ("center", "right"):
        f = found[0]
        rest = [l for l in found[1:] if l["page"] == f["page"] and l["col"] == f["col"]]
        left_edge = f["left"]
        # The wrapped lines' edge, where two of them or more start alike (a line may open with a formula's
        # piece, a sum's limit, further in); else the column's edge.
        xs = sorted(l["x0"] for l in rest)
        common = [x for x in xs if sum(1 for y in xs if abs(x - y) <= 1.5) >= 2]
        if common:
            other = min(common)
            left, first_ = other - left_edge, f["x0"] - other
        else:
            left, first_ = 0.0, f["x0"] - left_edge
        left, first_ = round(left), round(first_)
        if abs(first_) < 2: first_ = 0
        if abs(left) < 2 or left < 0: left = 0
        was = b.get("indent")
        kind_now = "first" if first_ > 0 else "hanging" if first_ < 0 else "block" if left > 0 else None
        # A first-line indent is measured anywhere; a hanging or a block indent only where the reference names
        # it (a wrapped line that opens with a formula's piece sits further in). A first line more than 50 pt
        # in is a line after something set beside it, not an indent.
        # Only the size: the kind (`indent`) stays the reference's own, since a reference that names some of its
        # indents and not others would count every other indent the candidate finds as wrong.
        if kind_now and ((kind_now == "first" and left == 0 and first_ <= 50) or kind_now == was):
            if b.get("indentPt") != {"left": left, "first": first_}:
                b["indentPt"] = {"left": left, "first": first_}; changes += 1
            if was and was != kind_now:
                report.append(f"block {i} indent {was}, measured {kind_now} ({left}/{first_} pt): {text_of(b['spans'])[:50]!r}")
        elif was:
            report.append(f"block {i} indent {was}, measured {left}/{first_}: {text_of(b['spans'])[:50]!r}")
    if kind == "list":
        items = [f for f in found if f]
        if not items:
            continue
        # Justified: an item that wraps fills every line but its last to the column's right edge.
        wrapped = [f for f in items if len(f) >= 2]
        if wrapped:
            full = all(abs(l["x1"] - l["right"]) <= 2 for f in wrapped for l in f[:-1])
            if full and b.get("align") != "justify":
                b["align"] = "justify"; changes += 1
                report.append(f"block {i} list justify ({len(wrapped)} wrapped items)")
        # Two items one after the other, both found, the first to its last line.
        spaces = [gap(a, c) for a, c in zip(found, found[1:]) if a and c and a.whole]
        spaces = [s for s in spaces if s is not None]
        if spaces:
            space = round(statistics.median(spaces))
            if b.get("itemSpace") != space:
                b["itemSpace"] = space; changes += 1
    # The space after: to the next paragraph or list right below it.
    if i in ends_at and i + 1 < len(ref["blocks"]) and ref["blocks"][i + 1]["kind"] in ("paragraph", "list") and b["kind"] in ("paragraph", "list") and (i + 1) in starts_at:
        g = gap(ends_at[i], starts_at[i + 1])
        if g is not None and b.get("spaceAfter") != g:
            b["spaceAfter"] = g; changes += 1

# Equation labels: the side most labels stand on, where the document is clear.
labels = [b for b in ref["blocks"] if b["kind"] == "equation" and b.get("label")]
if labels:
    sides = collections.Counter()
    words = []
    for p in range(first, last + 1):
        page = doc[p - 1]
        lines = page_lines(p)
        cols = columns(lines, page.rect.width)
        for w in page.get_text("words"):
            words.append((p, w, cols))
    for b in labels:
        want = re.sub(r"\s", "", b["label"])
        for p, w, cols in words:
            if re.sub(r"\s", "", w[4]) != want:
                continue
            # A display's label stands apart from its formula; a reference to it in a sentence has words
            # a space away on its line.
            beside = [o for q, o, _ in words if q == p and o is not w and abs((o[1] + o[3]) / 2 - (w[1] + w[3]) / 2) < 3]
            near_gap = min([max(o[0] - w[2], w[0] - o[2]) for o in beside], default=999)
            if near_gap < 15:
                continue
            col = min(cols, key=lambda c: abs((c[0] + c[1]) / 2 - (w[0] + w[2]) / 2))
            width = col[1] - col[0]
            if w[2] > col[1] - 0.12 * width: sides["right"] += 1
            elif w[0] < col[0] + 0.12 * width: sides["left"] += 1
    total = sum(sides.values())
    if total >= 1 and sides["left"] >= 0.7 * total:
        for b in labels:
            if b.get("labelSide") != "left":
                b["labelSide"] = "left"; changes += 1
        report.append(f"labels left ({dict(sides)})")
    elif total and not quiet:
        report.append(f"labels right ({dict(sides)})")

measured = collections.Counter()
for b in ref["blocks"]:
    for key in ("indentPt", "itemSpace", "spaceAfter", "labelSide"):
        if key in b: measured[key] += 1
    if b["kind"] == "list" and b.get("align") == "justify": measured["justified lists"] += 1
print(f"{ref['id']}: pitch {pitch}; {dict(measured)}; {changes} changes")
if not quiet:
    for r in report: print("  " + r)
if write and changes:
    json.dump(ref, open(ref_path, "w"), indent=INDENT, ensure_ascii=False)
    open(ref_path, "a").write("\n")
