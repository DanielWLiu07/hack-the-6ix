# FarmHand model - improvement plan (win the Freesolo "Best Model Trained" track)

Grounded in (a) Freesolo's own docs and (b) our real results. Current state:
regex baseline 93.3% -> SFT (flash-1784357076-b93a0ca9) 93.3%, whose only 2 misses
are OVER-CLARIFICATION on heavy typos ("colect the ripe furit", "kil it now" ->
the model asks a question instead of committing to the action). GRPO stage-2 is
training to fix exactly that.

## What Freesolo's docs say wins (quote it back at the judges)
- "The quality of your environment sets the ceiling on what training can achieve."
  Reward/environment design beats algorithm sophistication.
- Evaluation rigor is "foundational" - a broken eval leaves you unable to judge a run.
- Read trajectories, not just scores, to tell real improvement from reward artifacts.
- Post-training wins "when the task is narrow and you can define success" - FarmHand
  (NL command -> one JSON action) is exactly that narrow, definable task.
- Algorithm fit: SFT = you have correct answers; GRPO = you can score but not write
  the answer; OPD = a stronger teacher already does the task (warm-start OPD from SFT;
  "a cold OPD run tends to underperform SFT").

## Techniques, ranked by ROI

1. Reward quality (the ceiling). environment.py `farmhand_reward`:
   - Hard penalty for clarify-when-gold-is-action (our exact failure mode).
   - Per-field graded credit so GRPO gets a gradient, not a 0/0.5/1 cliff.
   - Keep clarify=1.0 ONLY when gold is clarify (preserves legit clarification).

2. Eval rigor (foundational, no GPU). Expand held-out from 30 -> 100+ with typos/
   slang/multi-turn. Report: exact-match, per-field, valid-JSON rate, OVER-CLARIFY
   rate, latency. Publish before/after trajectories for the Devpost writeup.
   Note: data/eval_set.jsonl is shared - keep it in sync.

3. Guided decoding / structured outputs. Force the two valid JSON shapes at rollout
   (GRPO `structured_outputs`) and serve (`response_format`) time -> ~100% valid JSON,
   faster training, more reliable demo. Client already supports response_format.

4. Targeted data augmentation. Add misspelling/slang variants mapped to correct
   actions (directly closes the typo gap). data/ is shared - keep it in sync.

5. OPD distillation (third algorithm to showcase). Warm-start from the SFT adapter,
   distill the managed teacher (GLM-5.2) on hard cases -> "SFT -> distillation -> RL"
   story. configs/opd.toml scaffolded; set init_from_adapter to the SFT run.

6. Multi-turn clarify environment. Replace the flattened single-turn clarify rows
   with EnvironmentMultiTurn (start_episode/step_episode/score_episode) that trains
   the full clarify -> answer -> action loop; score the resolving action. Stronger
   capability + a judge "wow".

7. Base model / hyperparam sweep (lowest). Try Qwen3.5-2B as a comparison row if
   0.8B caps out on typos; small epochs/LR sweep. Keep 0.8B as the headline (edge story).

## Order of execution (hackathon-pragmatic)
1. Finish GRPO -> deploy -> re-eval (in flight). Get the SFT vs SFT+GRPO row.
2. If GRPO does not clearly beat SFT: improve the reward (technique 1) and/or expand
   the eval (technique 2), then re-run GRPO. Do not ship a flat number as an "improvement".
3. Expand eval to 100+ (technique 2) regardless - it is pure upside and cheap.
4. Optional showcase: OPD (technique 5) for the three-algorithm narrative.
5. Multi-turn (technique 6) only if time remains - highest effort.

## The pitch row we are building toward
| Model | Held-out exact-match | Valid-JSON | Over-clarify |
|---|---|---|---|
| Regex baseline | 93.3% | - | - |
| Freesolo SFT (0.8B) | 93.3% | TBD | 2/30 |
| Freesolo SFT + GRPO | TBD | TBD | TBD |
| (opt) + OPD distillation | TBD | TBD | TBD |
