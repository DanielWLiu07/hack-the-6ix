"""Rich evaluation for a deployed FarmHand model.

Scores whatever endpoint client/farmhand.py is pointed at (FARMHAND_URL in
client/.env) on the 30 held-out commands in ../data/eval_set.jsonl, and reports
the metrics that matter for the Freesolo "Best Model Trained" track:

  - exact-match (all 4 fields)     accuracy vs gold action
  - per-field                      task/fruit/filter/zone
  - valid-JSON rate                fraction that parsed to a schema-valid action
  - over-clarify rate              clarified when the gold answer was an action
  - mean latency                   per request (serving responsiveness)

Run from client/ so .env loads:
  cd ../client && .venv/bin/python ../training/eval_model.py
Writes a markdown block to stdout (and to --out FILE if given).
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "client"))
import farmhand  # noqa: E402

DEFAULT_EVAL = Path(__file__).parent.parent / "data" / "eval_set.jsonl"
FIELDS = ("task", "fruit", "filter", "zone")


def _eval_path():
    args = sys.argv[1:]
    if "--eval-set" in args:
        return Path(args[args.index("--eval-set") + 1])
    return DEFAULT_EVAL


def norm(a):
    return {f: a.get(f, "any") if f != "task" else a.get("task") for f in FIELDS}


def evaluate(label):
    rows = [json.loads(l) for l in _eval_path().read_text().splitlines() if l.strip()]
    exact = 0
    per = {f: 0 for f in FIELDS}
    valid_json = 0
    over_clarify = 0
    latencies = []
    misses = []
    for r in rows:
        t0 = time.time()
        env = farmhand.handle(r["text"])
        latencies.append((time.time() - t0) * 1000)
        gold = norm(r["expected"])
        if env.get("action"):
            valid_json += 1
            got = norm(env["action"])
            hit = got == gold
            exact += 1 if hit else 0
            for f in FIELDS:
                per[f] += 1 if got[f] == gold[f] else 0
            if not hit:
                misses.append((r["id"], r["text"], got, gold))
        else:
            # clarification or error: counts as a miss on this action-gold set
            if env.get("clarification"):
                over_clarify += 1
                misses.append((r["id"], r["text"], {"clarify": env["clarification"][:40]}, gold))
            else:
                misses.append((r["id"], r["text"], {"error": env.get("error", "?")}, gold))

    n = len(rows)
    out = []
    out.append(f"### FarmHand eval - {label} ({n} held-out commands)\n")
    out.append("| Metric | Value |")
    out.append("|---|---|")
    out.append(f"| **Exact match (all 4 fields)** | **{exact}/{n} ({100*exact/n:.1f}%)** |")
    for f in FIELDS:
        out.append(f"| {f} | {per[f]}/{n} ({100*per[f]/n:.1f}%) |")
    out.append(f"| valid-JSON action rate | {valid_json}/{n} ({100*valid_json/n:.1f}%) |")
    out.append(f"| over-clarify (clarified vs action gold) | {over_clarify}/{n} |")
    out.append(f"| mean latency | {sum(latencies)/n:.0f} ms |")
    out.append("")
    if misses:
        out.append("Misses:")
        for i, text, got, gold in misses:
            out.append(f"  id={i} {text!r}\n        got  {json.dumps(got)}\n        want {json.dumps(gold)}")
    return "\n".join(out) + "\n"


if __name__ == "__main__":
    label = "endpoint" if farmhand.os.environ.get("FARMHAND_URL") else "MOCK rules"
    args = sys.argv[1:]
    if "--out" in args:
        dest = args[args.index("--out") + 1]
        label = args[0] if args and not args[0].startswith("--") else label
    else:
        dest = None
        if args and not args[0].startswith("--"):
            label = args[0]
    report = evaluate(label)
    print(report)
    if dest:
        Path(dest).write_text(report)
        print(f"wrote {dest}")
