"""Recompute images-baseline.json's totals from its per-file scores (after an
--only run saved a few files): a section's total is the mean of its files in
the corpus, the overall total the mean of the sections. Prints the totals.

  python3 -I scripts/parse-bench/images-retotal.py
"""
import json
import os

here = os.path.dirname(os.path.abspath(__file__))
corpus = json.load(open(os.path.join(here, "images-corpus.json")))
path = os.path.join(here, "images-baseline.json")
base = json.load(open(path))
ids = {f["id"]: f["section"] for f in corpus["files"]}
base["files"] = {k: v for k, v in base["files"].items() if k in ids}
total = {}
for s in ("a", "b"):
    scores = [v for k, v in base["files"].items() if ids[k] == s]
    if scores:
        total[s] = round(sum(scores) / len(scores), 3)
total["all"] = round(sum(total[s] for s in ("a", "b") if s in total) / len([s for s in ("a", "b") if s in total]), 3)
base["total"] = total
with open(path, "w") as f:
    f.write(json.dumps(base, indent=1, ensure_ascii=False) + "\n")
print(total)
