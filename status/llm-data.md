# llm-data status

## [22:12] DONE — Synthetic SFT dataset generated: 2,472 examples (target 1.5k+)
`ml/freesolo-agent/data/`: `generate_dataset.py` (seeded, deterministic) → `farmhand_train.jsonl` (2,349) + `farmhand_val.jsonl` (123, 5% split). Chat-JSONL (`{"messages":[system,user,assistant]}`). Mix: 1,468 pick / 550 drive / 224 sort / 190 stop / 40 off-topic-redirect; 280 multi-turn clarification dialogs. Typos, slang ("nanners"), color phrasings ("green bananas"→unripe). Validated: every assistant JSON matches action schema, 0 leakage against eval set.
Schema note for llm-client: action JSON always has all 4 keys — `{"task","fruit","filter","zone"}`, zone ∈ any|left|right|forward|backward|home, default "any". Root CLAUDE.md example omits zone; validator should treat missing zone as "any".
Next: eval_set.jsonl (done, 30 held-out hand-written commands) + eval.py.
