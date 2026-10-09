"""The media benchmark's references (scripts/parse-bench/media.mts), read with
other code than the code under test:

  section a: ffprobe (FFmpeg) for the container, its streams, and every audio
             packet's byte position and time; mutagen for a second reading of
             the length and the type.
  section b: pysubs2 for SRT and TTML; YouTube's json3, srv3, and legacy
             timedtext XML read here from the format's own structure (events
             and segs, p and s, text). WebVTT is read in media.mts by vtt.js,
             the parser Firefox and video.js use.

  python3 -I scripts/parse-bench/media-ref.py <corpus.json> <files dir> <refs dir>

Writes <refs dir>/<id>.json for every file of sections a and b it can read.
"""

import html
import json
import os
import re
import subprocess
import sys
import xml.etree.ElementTree as ET


def ffprobe(path):
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
            capture_output=True, text=True, timeout=60,
        )
        info = json.loads(out.stdout or "{}")
    except Exception as err:  # noqa: BLE001
        return {"error": str(err)}
    if "format" not in info:
        return {"error": (out.stderr or "unreadable").strip().splitlines()[-1:]}
    streams = [
        {
            "type": s.get("codec_type"),
            "codec": s.get("codec_name"),
            "picture": bool(s.get("disposition", {}).get("attached_pic")),
            "sampleRate": int(s["sample_rate"]) if s.get("sample_rate") else None,
            "channels": s.get("channels"),
        }
        for s in info.get("streams", [])
    ]
    fmt = info["format"]
    return {
        "format": fmt.get("format_name"),
        "duration": float(fmt["duration"]) if fmt.get("duration") else None,
        "brand": (fmt.get("tags") or {}).get("major_brand"),
        "streams": streams,
    }


def packets(path):
    """Every audio packet of the first audio stream: byte position, time, duration."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries",
         "packet=pos,pts_time,duration_time,size", "-of", "csv=p=0", path],
        capture_output=True, text=True, timeout=120,
    )
    rows = []
    for line in out.stdout.splitlines():
        parts = line.split(",")
        if len(parts) < 4:
            continue
        pts, dur, size, pos = parts[0], parts[1], parts[2], parts[3]
        try:
            rows.append([int(pos), float(pts), float(dur), int(size)])
        except ValueError:
            continue
    return rows


def mutagen_of(path):
    try:
        import mutagen  # noqa: PLC0415
        f = mutagen.File(path)
    except Exception as err:  # noqa: BLE001
        return {"error": type(err).__name__}
    if f is None:
        return None
    info = getattr(f, "info", None)
    return {
        "mime": (f.mime or [None])[0],
        "length": getattr(info, "length", None),
        "sampleRate": getattr(info, "sample_rate", None),
        "channels": getattr(info, "channels", None),
    }


def section_a(path, file):
    ref = {"probe": ffprobe(path), "mutagen": mutagen_of(path)}
    if "error" not in ref["probe"] and any(s["type"] == "audio" for s in ref["probe"]["streams"]):
        ref["packets"] = packets(path)
    return ref


SPACE = re.compile(r"\s+")


def clean(text):
    return SPACE.sub(" ", text).strip()


def cue(start, end, text, words=None):
    out = {"start": round(start, 3), "end": round(end, 3), "text": clean(text)}
    if words:
        out["words"] = words
    return out


def json3(raw):
    data = json.loads(raw)
    cues = []
    for event in data.get("events", []):
        segs = event.get("segs")
        if not segs:
            continue
        start = event.get("tStartMs", 0)
        end = start + event.get("dDurationMs", 0)
        text = "".join(s.get("utf8", "") for s in segs)
        if clean(text) == "":
            continue
        words = None
        if len(segs) > 1 or any("tOffsetMs" in s for s in segs):
            words = [
                [round((start + s.get("tOffsetMs", 0)) / 1000, 3), clean(s.get("utf8", ""))]
                for s in segs if clean(s.get("utf8", ""))
            ]
        cues.append(cue(start / 1000, end / 1000, text, words))
    return cues


def srv3(raw):
    root = ET.fromstring(raw.lstrip("﻿"))
    cues = []
    for p in root.iter("p"):
        start = int(p.get("t", "0"))
        end = start + int(p.get("d", "0"))
        spans = list(p.iter("s"))
        if spans:
            # Word spans: the text is the spans' own, the whitespace between
            # the elements is the file's layout.
            text = "".join((s.text or "") for s in spans)
            words = [[round((start + int(s.get("t", "0"))) / 1000, 3), clean(s.text or "")] for s in spans if clean(s.text or "")]
        else:
            text = "".join(p.itertext())
            words = None
        if clean(text) == "":
            continue
        cues.append(cue(start / 1000, end / 1000, text, words))
    return cues


TAG = re.compile(r"<[^>]*>")


def timedtext(raw):
    root = ET.fromstring(raw)
    cues = []
    for t in root.iter("text"):
        start = float(t.get("start", "0"))
        end = start + float(t.get("dur", "0"))
        # The legacy format escapes its markup twice: once read, the text
        # carries <i> and &#39; as text, which are markup and a reference.
        text = html.unescape(TAG.sub("", t.text or ""))
        if clean(text) == "":
            continue
        cues.append(cue(start, end, text))
    return cues


def pysubs(path, fmt):
    import pysubs2  # noqa: PLC0415
    subs = pysubs2.load(path, format_=fmt)
    cues = []
    for line in subs:
        if line.is_comment:
            continue
        text = line.plaintext
        if clean(text) == "":
            continue
        cues.append(cue(line.start / 1000, line.end / 1000, text))
    return cues


def section_b(path, file):
    raw = open(path, encoding="utf-8-sig", errors="replace").read()
    fmt = file.get("format")
    if fmt == "json3":
        return {"cues": json3(raw)}
    if fmt == "srv3":
        return {"cues": srv3(raw)}
    if fmt == "timedtext":
        return {"cues": timedtext(raw)}
    if fmt == "srt":
        return {"cues": pysubs(path, "srt")}
    if fmt == "ttml":
        return {"cues": pysubs(path, "ttml")}
    return None


def main():
    corpus = json.load(open(sys.argv[1]))
    files_dir, refs_dir = sys.argv[2], sys.argv[3]
    os.makedirs(refs_dir, exist_ok=True)
    for file in corpus["files"]:
        path = os.path.join(files_dir, file["id"])
        if not os.path.exists(path):
            continue
        try:
            ref = section_a(path, file) if file["section"] == "a" else section_b(path, file) if file["section"] == "b" else None
        except Exception as err:  # noqa: BLE001
            ref = {"error": f"{type(err).__name__}: {err}"}
        if ref is None:
            continue
        with open(os.path.join(refs_dir, file["id"] + ".json"), "w") as out:
            json.dump(ref, out)


main()
