"""Convert our chat-JSONL FarmHand dataset (../data/*.jsonl) into Freesolo Flash
`{"input","output"}` rows.

input  = the user's natural-language command (first user turn)
output = the assistant's JSON string (first assistant turn: an action or a clarify)

The canonical system prompt is identical across rows; we capture it once and write
it to system_prompt.txt so environment.py prepends the exact same instruction at
train time that our inference client sends at serve time.
"""
import json
from pathlib import Path

SRC = Path(__file__).parent.parent / "data"
OUT = Path(__file__).parent / "dataset"
OUT.mkdir(exist_ok=True)

def convert(src_name, dst_name):
    system_seen = set()
    rows = 0
    with (SRC / src_name).open() as f, (OUT / dst_name).open("w") as out:
        for line in f:
            line = line.strip()
            if not line:
                continue
            msgs = json.loads(line)["messages"]
            system = next((m["content"] for m in msgs if m["role"] == "system"), None)
            if system:
                system_seen.add(system)
            user = next((m["content"] for m in msgs if m["role"] == "user"), None)
            assistant = next((m["content"] for m in msgs if m["role"] == "assistant"), None)
            if user is None or assistant is None:
                continue
            out.write(json.dumps({"input": user, "output": assistant}) + "\n")
            rows += 1
    return rows, system_seen

tr, sys_tr = convert("farmhand_train.jsonl", "train.jsonl")
va, sys_va = convert("farmhand_val.jsonl", "val.jsonl")

systems = sys_tr | sys_va
assert len(systems) == 1, f"expected one canonical system prompt, got {len(systems)}"
(Path(__file__).parent / "system_prompt.txt").write_text(next(iter(systems)))

print(f"train rows: {tr}")
print(f"val rows:   {va}")
print(f"canonical system prompt captured ({len(next(iter(systems)))} chars)")
