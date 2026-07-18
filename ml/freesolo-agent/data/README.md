# FarmHand SFT dataset (`ml/freesolo-agent/data/`)

Synthetic training data for the FarmHand NL-command model (Freesolo track).
The teammate trains on Freesolo; this directory is the dataset + eval deliverable.

## Files

| File | What |
|---|---|
| `farmhand_train.jsonl` | 2,349 training examples, chat-JSONL |
| `farmhand_val.jsonl` | 123 validation examples (5% split, same distribution) |
| `eval_set.jsonl` | 30 hand-written held-out commands with expected actions — **never train on these** |
| `farmhand_prefs.jsonl` | 600 preference pairs (chosen/rejected) for RL/DPO — **bonus** deliverable |
| `generate_dataset.py` | Seeded generator (re-run → identical output; excludes eval texts) |
| `generate_prefs.py` | Seeded preference-pair generator (reuses the SFT vocabulary) |
| `eval.py` | Accuracy scorer: `--baseline` / `--endpoint URL` / `--predictions file` |
| `export.py` | Convert to `prompt-completion` / `alpaca` / `dpo-flat` if Freesolo's trainer needs it |

## The contract the model is trained to follow

Every assistant output is **JSON, nothing else** — one of two shapes:

1. **Action** (all four keys always present; `"any"` = unspecified):
   ```json
   {"task":"pick|sort|stop|drive","fruit":"apple|banana|any","filter":"ripe|unripe|any","zone":"any|left|right|forward|backward|home"}
   ```
2. **Clarification / redirect** (ambiguous or off-topic input):
   ```json
   {"clarify":"Which fruit — apples, bananas, or both?"}
   ```
   The client shows the question to the user; the user's answer continues the
   same conversation and the model then emits the action JSON.

Notes:
- `zone` extends the root-CLAUDE.md example (which omits it). Consumers should
  treat a missing `zone` as `"any"`. For `drive`, `zone` is the direction/target;
  for `pick` it can scope location ("the apples on the left").
- Color language maps to ripeness: red apples / yellow bananas → `ripe`,
  green anything → `unripe`.
- This matches llm-client's strict validator (see `../NOTES.md` Q4/Q5): actions
  validate against the enums above; `{"clarify": ...}` is surfaced to the user.

## Dataset composition (2,472 total)

- 1,468 pick / 550 drive / 224 sort / 190 stop actions
- 280 multi-turn clarification dialogs (vague fruit / vague sort / vague drive)
- 40 off-topic → clarify-redirect examples (teaches the model to never emit an
  action for "tell me a joke")
- Surface noise throughout: typos (~12%), slang ("nanners", "snag"), casing,
  politeness wrappers, color phrasings

## Preference pairs for RL/DPO (`farmhand_prefs.jsonl`) — bonus

600 `{prompt, chosen, rejected, reason}` rows (TRL conversational preference
format: `prompt` and `chosen`/`rejected` are message lists). After SFT, a
preference-optimization pass (DPO/KTO/ORPO) teaches the model to *prefer* the
correct, machine-parseable action over the plausible-but-wrong alternative — the
failure modes that actually cost us commands, since llm-client's strict validator
silently drops anything that isn't valid schema JSON. `chosen` is always
schema-valid; `rejected` is a realistic worse answer. Categories:

| `reason` | chosen vs. rejected | why it matters |
|---|---|---|
| `prose_not_json` | JSON action **vs.** friendly prose ("Sure, I'll pick the apples!") | prose is rejected by the client → command lost |
| `schema_violation` | valid JSON **vs.** extra key / dropped key / bad enum / wrapped / trailing text | strict validator rejects it |
| `wrong_fruit` / `wrong_filter` / `wrong_zone` | correct field **vs.** one subtly wrong field | wrong bin / wrong fruit picked |
| `wrong_task_pick_vs_sort` | `pick` **vs.** `sort` (and back) | robot does the wrong operation |
| `guessed_instead_of_clarifying` | `{"clarify":…}` **vs.** a confident guess on an ambiguous command | picks the wrong thing instead of asking |
| `over_clarified_clear_command` | action **vs.** a needless clarify question on a clear command | annoying, stalls the demo |
| `offtopic_should_redirect` | redirect clarify **vs.** trying to comply | never emit an action for "tell me a joke" |

Regenerate: `python3 generate_prefs.py` (seeded, deterministic; 0 overlap with
`eval_set.jsonl`). Flatten to plain-string DPO fields:
`python3 export.py --format dpo-flat` → `export/farmhand_prefs.dpo-flat.jsonl`.

## Training on Freesolo

Native format is standard chat-JSONL (`{"messages":[{"role":...,"content":...}]}`),
which most fine-tuning platforms accept as-is. If Freesolo's uploader wants
prompt/completion or instruction format instead:

```bash
python3 export.py --format prompt-completion   # → export/farmhand_{train,val}.prompt-completion.jsonl
python3 export.py --format alpaca
```

Keep the system message — the JSON-only convention is defined there.

## Evaluating the trained model

```bash
python3 eval.py --endpoint https://<freesolo-endpoint>   # POSTs {"text": "<command>"} per eval row
python3 eval.py --predictions preds.jsonl                # or score saved outputs, one line per row in order
python3 eval.py --baseline                               # regex baseline for comparison
```

Prints a markdown table (exact-match + per-field accuracy) for the Devpost
writeup. The regex baseline scores **28/30 (93.3%)**; its misses are the
idiomatic cases only the LLM handles ("bring me some bananas ripe or not" →
`filter:any`, "come back to the charging station" → `zone:home`) — and the
baseline can't do multi-turn clarification at all, which is the demo story.
