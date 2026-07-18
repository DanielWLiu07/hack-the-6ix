# Training FarmHand on Freesolo - click-by-click runbook

**Who runs this:** the teammate with the Freesolo account (has the event credits).
**Why it's easy:** all the hard parts - dataset, eval, the client that consumes
the model - are already built and tested. This is just upload → click → paste a URL.

**What you're doing in one sentence:** teaching a small LLM to turn a plain-English
robot command into one line of validated JSON, by showing it ~2,300 examples.

---

## The files you'll upload (already generated, in `data/`)

| File | Lines | Use it for |
|---|---|---|
| `data/farmhand_train.jsonl` | 2,349 | **SFT training set** (the main upload) |
| `data/farmhand_val.jsonl` | 123 | validation (Freesolo watches loss on this) |
| `data/farmhand_prefs.jsonl` | 600 | **DPO** stage 2, optional but scores higher |
| `data/eval_set.jsonl` | 30 | held-out test - **never** upload for training |

Each training line looks like this (chat format):

```json
{"messages":[
  {"role":"system","content":"You convert farm robot commands into JSON actions."},
  {"role":"user","content":"pick all ripe apples"},
  {"role":"assistant","content":"{\"task\":\"pick\",\"fruit\":\"apple\",\"filter\":\"ripe\",\"zone\":\"any\"}"}
]}
```

If Freesolo wants a different shape (prompt/completion, alpaca, plain-string DPO),
run `python data/export.py --format prompt-completion|alpaca|dpo-flat` - it writes
converted copies into `data/export/`. Upload whichever Freesolo asks for.

---

## Step 1 - SFT (the actual training)

1. Log into Freesolo → **New fine-tune / training run**.
2. **Base model:** pick the smallest instruct model they offer (a 1–3B is plenty -
   the task is narrow, small = fast + cheap + edge-friendly, and "distilled a big
   model's ability into a small one" is a *selling point* for the Best-Model track).
3. **Training data:** upload `farmhand_train.jsonl`. **Validation:** `farmhand_val.jsonl`.
4. **Method:** SFT (supervised fine-tuning). Defaults for epochs/LR are fine - if it
   asks, 2–3 epochs is right for ~2.3k examples (more overfits).
5. Start it. Watch validation loss go down. When it finishes you get a **model ID /
   endpoint URL** - copy that.

## Step 2 - DPO (optional, ~15 more min, worth it for the track)

1. New run → same base, but this time load **your Step-1 model** as the starting point.
2. Method: **DPO / preference optimization**. Data: `farmhand_prefs.jsonl` (or the
   `dpo-flat` export). This teaches it to prefer clean JSON over the 9 common failure
   modes (prose instead of JSON, guessing instead of asking, schema violations…).
3. This gives you the "**SFT → DPO**, two-stage pipeline" story that beats teams who
   only fine-tuned once.

## Step 3 - hand me the endpoint (30 seconds, then the robot is live on the real model)

Give me (or drop in `NOTES.md`): the **endpoint URL** + **API key** + whether the
response is bare JSON or wrapped. Then:

```bash
export FARMHAND_URL="https://…your-endpoint…"
export FARMHAND_API_KEY="…"        # if needed
```

That's the whole integration. `client/farmhand.py` already POSTs `{"text": "..."}`,
parses the model's answer, **validates it against the schema, and rejects anything
invalid before it can reach the robot.** The mock/regex mode I've been demoing flips
to the real model automatically the moment `FARMHAND_URL` is set - no code change.

## Step 4 - score it (for the Devpost table)

```bash
python data/eval.py --endpoint "$FARMHAND_URL"    # runs the 30 held-out commands
```

Prints the same accuracy table as the regex baseline (currently **28/30 = 93.3%**),
so you get a clean **baseline vs SFT vs SFT+DPO** comparison row - exactly what the
"Best Model Trained" judges want to see.

---

## If you get stuck / Freesolo differs from the above

The unknowns are all in `NOTES.md` (endpoint shape, request/response format,
whether DPO is supported). Answer those there and I'll adapt `client/farmhand.py`
in one place (`endpoint_model()` / `parse_model_body()`) - a ~5-line change. You do
**not** need to touch any robot or server code; the seam is entirely on my side.
