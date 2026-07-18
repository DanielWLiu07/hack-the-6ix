#!/usr/bin/env python3
"""Convert the FarmHand chat-JSONL dataset into other common trainer formats.

Freesolo's exact upload format is unconfirmed (asked in ../NOTES.md Q6), so the
native format is standard chat-JSONL ({"messages":[...]}) which most platforms
accept directly. This script converts to the other two common shapes on demand:

  chat               native passthrough: {"messages":[{role,content},...]}
  prompt-completion  {"prompt": "...", "completion": "..."} - multi-turn dialogs
                     are flattened; the prompt contains the system text plus the
                     conversation so far, the completion is the final assistant JSON
  alpaca             {"instruction": ..., "input": ..., "output": ...}
  dpo-flat           preference pairs only: {"prompt": "...", "chosen": "...",
                     "rejected": "..."} - flattens farmhand_prefs.jsonl for
                     trainers that want plain-string DPO fields (drops `reason`)

Usage:
  python3 export.py --format prompt-completion            # both splits -> export/
  python3 export.py --format alpaca --split train
  python3 export.py --format dpo-flat                     # -> export/farmhand_prefs.dpo-flat.jsonl
"""

import argparse
import json
from pathlib import Path

HERE = Path(__file__).parent
SPLITS = {"train": "farmhand_train.jsonl", "val": "farmhand_val.jsonl"}


def load(split):
    return [json.loads(l) for l in (HERE / SPLITS[split]).read_text().splitlines() if l.strip()]


def to_chat(ex):
    return ex


def flatten_dialog(msgs):
    """System + all turns before the final assistant message, as one prompt string."""
    parts = [msgs[0]["content"], ""]
    for m in msgs[1:-1]:
        who = "User" if m["role"] == "user" else "FarmHand"
        parts.append(f"{who}: {m['content']}")
    parts.append("FarmHand:")
    return "\n".join(parts)


def to_prompt_completion(ex):
    msgs = ex["messages"]
    return {"prompt": flatten_dialog(msgs), "completion": " " + msgs[-1]["content"]}


def to_alpaca(ex):
    msgs = ex["messages"]
    convo = [f"{'User' if m['role'] == 'user' else 'FarmHand'}: {m['content']}"
             for m in msgs[1:-1]]
    return {"instruction": msgs[0]["content"],
            "input": "\n".join(convo),
            "output": msgs[-1]["content"]}


CONVERTERS = {"chat": to_chat, "prompt-completion": to_prompt_completion, "alpaca": to_alpaca}
PREFS_FILE = "farmhand_prefs.jsonl"


def export_dpo_flat(out_dir):
    """Flatten the preference set to plain-string {prompt,chosen,rejected}."""
    src = HERE / PREFS_FILE
    if not src.exists():
        raise SystemExit(f"{PREFS_FILE} not found - run generate_prefs.py first")
    rows = [json.loads(l) for l in src.read_text().splitlines() if l.strip()]
    out = out_dir / "farmhand_prefs.dpo-flat.jsonl"
    with open(out, "w") as f:
        for r in rows:
            f.write(json.dumps({
                "prompt": flatten_dialog(r["prompt"] + [{"role": "assistant", "content": ""}]),
                "chosen": " " + r["chosen"][0]["content"],
                "rejected": " " + r["rejected"][0]["content"],
            }, ensure_ascii=False) + "\n")
    print(f"wrote {out} ({len(rows)} preference pairs)")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--format", choices=[*CONVERTERS, "dpo-flat"], default="chat")
    ap.add_argument("--split", choices=[*SPLITS, "all"], default="all")
    ap.add_argument("--out-dir", default=str(HERE / "export"))
    args = ap.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    if args.format == "dpo-flat":
        export_dpo_flat(out_dir)
        return
    conv = CONVERTERS[args.format]
    for split in (SPLITS if args.split == "all" else [args.split]):
        rows = [conv(ex) for ex in load(split)]
        out = out_dir / f"farmhand_{split}.{args.format}.jsonl"
        with open(out, "w") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"wrote {out} ({len(rows)} examples)")


if __name__ == "__main__":
    main()
