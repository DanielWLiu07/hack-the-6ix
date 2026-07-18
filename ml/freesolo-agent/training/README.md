# FarmHand training (Freesolo Flash)

Trains the FarmHand NL command model: natural-language robot command -> one JSON
action, or a clarify question. Two-stage pipeline (SFT then GRPO) on a
deliberately tiny edge-sized model. This directory is fully reproducible.

## Result

Same 30 held-out commands, scored the same way at every stage:

| Model | Exact match | Over-clarify | Valid-JSON |
|---|---|---|---|
| Regex baseline | 28/30 (93.3%) | - | - |
| Freesolo SFT (Qwen3.5-0.8B) | 28/30 (93.3%) | 2/30 | 100% |
| **Freesolo SFT + GRPO** | **29/30 (96.7%)** | **1/30** | 100% |

**What moved the number was the reward, not the data.** SFT matched the regex
baseline but generalized better. Its only failures were over-clarification (on
typos like `kil it now` it asked a question instead of committing to `stop`). We
wrote a JSON-aware reward that scores over-clarification as zero and ran GRPO
against it; the model learned to commit, reaching 96.7%.

**Honest ablation we kept:** naive typo/slang data augmentation (`augment.py`, 226
rows) *regressed* exact-match to 86.7% - it traded cautious clarifications for
confident wrong answers. We did not ship it. This matches Freesolo's own thesis
(reward/environment quality is the ceiling, not dataset size), and we have the
ablation to prove it.

## Files

| File | What |
|---|---|
| `convert_dataset.py` | our chat-JSONL (`../data/*.jsonl`) -> Freesolo `{input,output}` rows |
| `environment.py` | the task: prompt build + JSON-aware graded reward (`farmhand_reward`) |
| `system_prompt.txt` | the canonical system prompt (train == serve) |
| `dataset/train.jsonl`, `val.jsonl` | 2349 / 123 converted rows |
| `augment.py`, `dataset/augment.jsonl` | 226 typo/slang rows (ablation; eval-leakage filtered) |
| `configs/sft.toml`, `rl.toml`, `opd_v2.toml` | SFT, GRPO, and distillation run configs |
| `eval_model.py` | rich eval (exact/per-field/valid-JSON/over-clarify/latency), `--eval-set` |
| `eval_stress.jsonl` | 26 held-out typo/slang commands (verified disjoint from train/eval) |
| `IMPROVEMENT_PLAN.md` | ranked techniques for pushing further |

## Reproduce

Prereqs: a Freesolo API key in `../client/.env` (`FREESOLO_API_KEY=...`), and the
`flash` CLI (`uv tool install freesolo-flash` or `pip install freesolo-flash`).

```bash
# 1. build the dataset from our SFT data
python3 convert_dataset.py                 # -> dataset/train.jsonl, val.jsonl, system_prompt.txt

# 2. publish the environment (task + reward + data) to Freesolo
set -a; . ../client/.env; set +a
flash env push --name farmhand .           # -> hackthe6ixbanana/farmhand

# 3. stage 1: SFT  (Qwen3.5-0.8B, ~16 min, ~$0.18)
flash train configs/sft.toml               # note the run-id, e.g. flash-<...>
flash deploy <sft-run-id>

# 4. stage 2: GRPO from the SFT adapter  (~50 min, ~$0.48)
#    edit configs/rl.toml init_from_adapter = "<sft-run-id>", then:
flash train configs/rl.toml
flash deploy <grpo-run-id>

# 5. point the client at the deployed model and score it
#    set FARMHAND_URL=<base>/v1 and FARMHAND_MODEL=<grpo-run-id> in ../client/.env
cd ../client && .venv/bin/python ../training/eval_model.py "SFT+GRPO" \
  && .venv/bin/python ../training/eval_model.py "SFT+GRPO (stress)" --eval-set ../training/eval_stress.jsonl
```

The trained model serves over an OpenAI-compatible API; `client/farmhand.py`
calls it, validates every output against the action schema, and falls back to
built-in rules if the endpoint is unreachable (see `../client/`).

## Key design decisions

- **Qwen3.5-0.8B on purpose:** smallest model offered. Cheap, fast, and it makes
  the "distilled a small model that runs at the edge" story real.
- **Train == serve:** the exact system prompt in `system_prompt.txt` is used at
  training time (`environment.py`) and inference time (`client/farmhand.py`).
- **Graded reward:** per-field credit (not 0/1), over-clarification penalized to
  zero. Denser signal for GRPO; reusable for a further RL pass.
- **Held-out everything:** `eval_stress.jsonl` and the augmentation are both
  checked for exact overlap with the eval set (zero leakage) before use.
