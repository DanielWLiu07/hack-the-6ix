"""Targeted augmentation for FarmHand's observed failure mode: the model
over-clarifies on typo'd / terse commands instead of committing to the action.

Generates {"input","output"} rows that map misspelled / slangy / terse commands
to the correct action JSON, deterministically (no RNG - fixed lists + typo rules),
so re-running is byte-identical. Writes dataset/augment.jsonl; environment.py
concatenates it with train.jsonl for v2 runs.

Design: cover the exact shapes we missed ("collect the ripe fruit" -> fruit any,
typo'd stop like "kil it now") plus broad typo coverage of the core verbs/nouns.
"""
import json
from pathlib import Path

OUT = Path(__file__).parent / "dataset" / "augment.jsonl"

def act(task, fruit="any", filt="any", zone="any"):
    return json.dumps({"task": task, "fruit": fruit, "filter": filt, "zone": zone})

rows = []

# --- "the fruit" / generic-fruit terse commands -> fruit any (the miss class) ---
generic = ["the fruit", "the fruits", "some fruit", "any fruit", "fruit", "whatever fruit"]
for g in generic:
    rows.append(("collect the ripe " + g.split("the ")[-1], act("pick", "any", "ripe")))
    rows.append(("grab " + g, act("pick", "any", "any")))
    rows.append(("pick " + g + " that is ripe", act("pick", "any", "ripe")))
    rows.append(("get me " + g, act("pick", "any", "any")))
    rows.append(("sort " + g, act("sort", "any", "any")))

# --- typo'd verbs (misspellings of the core actions) ---
pick_typos = ["pik", "pcik", "grabb", "gra b", "colect", "collct", "harvst", "snag", "snatch", "fetchh"]
stop_typos = ["stpo", "stp", "halt it", "hault", "kil it", "kil it now", "freeze it", "emergency stop", "abrt", "cancel it"]
drive_typos = ["dirve", "drivee", "mov forward", "go fwd", "rev", "reverse it", "roll out"]
sort_typos = ["srot", "sorrt", "orgnize", "organise them", "bin them", "seperate them"]
fruits = [("apple", ["aple", "appel", "appl", "red one", "apples"]),
          ("banana", ["banan", "bannana", "nana", "yellow one", "bananas"])]
filts = [("ripe", ["ripe", "rip", "ready", "read", "red-ripe"]),
         ("unripe", ["unripe", "unrpe", "not ripe", "green", "raw"])]

for v in pick_typos:
    rows.append((v + " a ripe apple", act("pick", "apple", "ripe")))
    rows.append((v + " the unripe bananas", act("pick", "banana", "unripe")))
    rows.append((v + " everything ripe", act("pick", "any", "ripe")))
for v in stop_typos:
    rows.append((v, act("stop")))
for v in drive_typos:
    rows.append((v, act("drive", zone="forward")))
    rows.append((v + " then back", act("drive", zone="backward")))
for v in sort_typos:
    rows.append((v, act("sort", "any", "any")))
    rows.append((v + " the apples", act("sort", "apple", "any")))

# --- fruit x filter typo grid on pick ---
for fruit, fts in fruits:
    for ftok in fts:
        for filt, gts in filts:
            for gtok in gts:
                rows.append(("pik " + gtok + " " + ftok, act("pick", fruit, filt)))

# --- zone typos on drive ---
zone_toks = {"forward": ["fowrard", "foward", "ahead", "straght"],
             "backward": ["bakward", "backwrd", "reverse", "back up"],
             "left": ["lft", "to the lft"], "right": ["rght", "to teh right"],
             "home": ["hom", "base", "charging staton", "dock"]}
for zone, toks in zone_toks.items():
    for tok in toks:
        rows.append(("go " + tok, act("drive", zone=zone)))
        rows.append(("drive " + tok, act("drive", zone=zone)))

# exclude any exact held-out eval command (no teaching-to-the-test)
EVAL = Path(__file__).parent.parent / "data" / "eval_set.jsonl"
eval_texts = {json.loads(l)["text"].strip().lower() for l in EVAL.read_text().splitlines() if l.strip()}

# dedup + drop eval leakage, keep order
seen = set(); uniq = []
for inp, out in rows:
    if inp.strip().lower() in eval_texts:
        continue
    k = (inp.lower(), out)
    if k not in seen:
        seen.add(k); uniq.append((inp, out))

OUT.parent.mkdir(exist_ok=True)
with OUT.open("w") as f:
    for inp, out in uniq:
        f.write(json.dumps({"input": inp, "output": out}) + "\n")
print(f"wrote {len(uniq)} augmentation rows -> {OUT}")
