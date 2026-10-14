# Tally a round's blind pairs: python3 scripts/eval/structure/tally.py r13 r13b
import json, sys
from pathlib import Path
root = Path(".eval/structure")
wins = losses = ties = mw = ml = 0
for r in sys.argv[1:]:
    for d in sorted((root / r).iterdir()):
        p, k = d / "pair.json", d / "pair-key.json"
        if not p.exists() or not k.exists():
            continue
        pair, key = json.loads(p.read_text()), json.loads(k.read_text())
        side = key.get(pair.get("winner"), "tie")
        m = int(pair.get("margin") or 0)
        if side == "candidate": wins += 1; mw += m
        elif side == "base": losses += 1; ml += m
        else: ties += 1
        print(f"{r:6} {d.name:24} {side:9} {m}  {pair.get('why','')[:160]}")
print(f"wins {wins}, losses {losses}, ties {ties}; margins {mw} to {ml}")
