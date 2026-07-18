#!/usr/bin/env python3
"""FarmHand eval: score a model on the 30 held-out commands in eval_set.jsonl.

Prediction sources (pick one):
  --endpoint URL      POST {"text": <command>} per command; response must be the
                      action JSON, or {"action": {...}}, or chat-style
                      {"choices":[{"message":{"content": "..."}}]} - the first
                      JSON object found in the content is used.
  --predictions FILE  JSONL, one line per eval row IN ORDER. Each line is either
                      the action JSON itself or {"output": "<raw model text>"}.
  --baseline          Built-in regex baseline (no model). Default if nothing given.

Scoring: exact match (all 4 fields) + per-field accuracy. Missing fields in a
prediction default to "any" (the schema's "unspecified" value). Prints a
markdown table ready for the Devpost writeup.

Examples:
  python3 eval.py --baseline
  python3 eval.py --endpoint http://localhost:8000/farmhand
  python3 eval.py --predictions preds.jsonl
"""

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
FIELDS = ["task", "fruit", "filter", "zone"]
DEFAULTS = {"task": None, "fruit": "any", "filter": "any", "zone": "any"}


def load_eval_set(path):
    rows = []
    for line in Path(path).read_text().splitlines():
        if line.strip():
            rows.append(json.loads(line))
    return rows


def extract_action(raw):
    """Pull an action dict out of raw model output (string or dict)."""
    if isinstance(raw, dict):
        if "action" in raw and isinstance(raw["action"], dict):
            return normalize(raw["action"])
        if "task" in raw:
            return normalize(raw)
        if "choices" in raw:  # OpenAI-style chat response
            try:
                raw = raw["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError):
                return None
        elif "output" in raw:
            raw = raw["output"]
        else:
            return None
    if not isinstance(raw, str):
        return None
    m = re.search(r"\{.*?\}", raw, re.DOTALL)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    return normalize(obj) if isinstance(obj, dict) else None


def normalize(a):
    out = {}
    for f in FIELDS:
        v = a.get(f, DEFAULTS[f])
        out[f] = v.strip().lower() if isinstance(v, str) else v
    return out


# ------------------------------------------------------------------ baseline

def baseline_predict(text):
    """Keyword-rules baseline - the number the trained model has to beat."""
    t = text.lower()
    if re.search(r"\b(stop|halt|freeze|abort|cancel|e-?stop|kill?\s*it|stand down|brakes|cease|don'?t move)\b", t):
        return {"task": "stop", "fruit": "any", "filter": "any", "zone": "any"}

    zone = "any"
    if re.search(r"\b(left)\b", t):
        zone = "left"
    elif re.search(r"\b(right)\b", t):
        zone = "right"
    elif re.search(r"\b(back(ward|wards)?( up)?|reverse)\b", t):
        zone = "backward"
    elif re.search(r"\b(forward|ahead|straight)\b", t):
        zone = "forward"
    elif re.search(r"\b(home|base|charging station|come back|return)\b", t):
        zone = "home"

    fruit = "any"
    has_apple = re.search(r"\bap+les?\b|\bred\b", t)
    has_banana = re.search(r"\bbanana?s?\b|\bnan+(a|er)s?\b|\byellow\b", t)
    if has_apple and not has_banana:
        fruit = "apple"
    elif has_banana and not has_apple:
        fruit = "banana"

    filt = "any"
    if re.search(r"\b(unripe|underripe|green|not ripe|aren'?t ripe|immature|isn'?t ripe|still green)\b", t):
        filt = "unripe"
    elif re.search(r"\b(ripe|ready|mature|red|yellow)\b", t):
        filt = "ripe"

    if re.search(r"\b(sort|organi[sz]e|separate|categori[sz]e|bin(s)? them|put away)\b", t):
        task = "sort"
    elif re.search(r"\b(pick|grab|get|fetch|collect|harvest|gather|pluck|snag|bring|take|round up|scoop)\b", t):
        task = "pick"
    elif re.search(r"\b(drive|go|move|head|roll|cruise|scoot|steer|back up|come)\b", t):
        task = "drive"
    else:
        task = "pick"
    if task == "drive":
        fruit, filt = "any", "any"
    return {"task": task, "fruit": fruit, "filter": filt, "zone": zone}


# ------------------------------------------------------------------ sources

def predict_endpoint(url, rows, timeout):
    preds = []
    for r in rows:
        req = urllib.request.Request(
            url, data=json.dumps({"text": r["text"]}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read().decode()
        except Exception as e:
            print(f"  [warn] id={r['id']}: request failed: {e}", file=sys.stderr)
            preds.append(None)
            continue
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = body
        preds.append(extract_action(parsed))
    return preds


def predict_file(path, rows):
    lines = [l for l in Path(path).read_text().splitlines() if l.strip()]
    if len(lines) != len(rows):
        sys.exit(f"predictions file has {len(lines)} lines, eval set has {len(rows)}")
    preds = []
    for l in lines:
        try:
            parsed = json.loads(l)
        except json.JSONDecodeError:
            parsed = l
        preds.append(extract_action(parsed))
    return preds


# ------------------------------------------------------------------ scoring

def score(rows, preds, label):
    n = len(rows)
    exact = 0
    field_hits = {f: 0 for f in FIELDS}
    parse_fail = 0
    misses = []
    for r, p in zip(rows, preds):
        exp = normalize(r["expected"])
        if p is None:
            parse_fail += 1
            misses.append((r, None))
            continue
        ok = all(p[f] == exp[f] for f in FIELDS)
        exact += ok
        for f in FIELDS:
            field_hits[f] += p[f] == exp[f]
        if not ok:
            misses.append((r, p))

    print(f"\n### FarmHand eval - {label} ({n} held-out commands)\n")
    print("| Metric | Accuracy |")
    print("|---|---|")
    print(f"| **Exact match (all fields)** | **{exact}/{n} ({100*exact/n:.1f}%)** |")
    for f in FIELDS:
        print(f"| {f} | {field_hits[f]}/{n} ({100*field_hits[f]/n:.1f}%) |")
    if parse_fail:
        print(f"| unparseable outputs | {parse_fail} |")

    if misses:
        print("\nMisses:")
        for r, p in misses:
            got = json.dumps(p, separators=(",", ":")) if p else "<no valid JSON>"
            want = json.dumps(normalize(r["expected"]), separators=(",", ":"))
            print(f"  id={r['id']:>2} {r['text']!r}\n        got  {got}\n        want {want}")
    return exact / n


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--endpoint", help="model endpoint URL (POST {'text': ...})")
    src.add_argument("--predictions", help="JSONL predictions file, aligned with eval set")
    src.add_argument("--baseline", action="store_true", help="run built-in regex baseline")
    ap.add_argument("--eval-set", default=str(HERE / "eval_set.jsonl"))
    ap.add_argument("--timeout", type=float, default=30.0)
    args = ap.parse_args()

    rows = load_eval_set(args.eval_set)
    if args.endpoint:
        preds, label = predict_endpoint(args.endpoint, rows, args.timeout), f"endpoint {args.endpoint}"
    elif args.predictions:
        preds, label = predict_file(args.predictions, rows), f"file {args.predictions}"
    else:
        preds, label = [baseline_predict(r["text"]) for r in rows], "regex baseline"
    score(rows, preds, label)


if __name__ == "__main__":
    main()
