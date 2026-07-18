# llm-data status

## [22:08] DONE — Synthetic SFT dataset generated: 2,472 examples (target 1.5k+)
`ml/freesolo-agent/data/`: `generate_dataset.py` (seeded, deterministic) → `farmhand_train.jsonl` (2,349) + `farmhand_val.jsonl` (123, 5% split). Chat-JSONL (`{"messages":[system,user,assistant]}`). Mix: 1,468 pick / 550 drive / 224 sort / 190 stop / 40 off-topic-redirect; 280 multi-turn clarification dialogs. Typos, slang ("nanners"), color phrasings ("green bananas"→unripe). Validated: every assistant JSON matches action schema, 0 leakage against eval set.
Schema note for llm-client: action JSON always has all 4 keys — `{"task","fruit","filter","zone"}`, zone ∈ any|left|right|forward|backward|home, default "any". Root CLAUDE.md example omits zone; validator should treat missing zone as "any".
Next: eval_set.jsonl (done, 30 held-out hand-written commands) + eval.py.

## [22:09] DONE — Eval set (30 held-out commands) + eval.py working
`eval_set.jsonl`: 30 hand-written commands covering all tasks/fruits/filters/zones + typos/slang/caps. `eval.py` modes: `--baseline` (built-in regex rules), `--endpoint URL` (POSTs {"text":...}, parses action JSON out of raw/chat-style responses), `--predictions file.jsonl`. Prints markdown accuracy table (exact + per-field) for Devpost. Verified end-to-end: regex baseline scores 28/30 (93.3%) — misses are the idiomatic cases only an LLM gets ("ripe or not"→any, "charging station"→home); a perfect-predictions file scores 30/30. Baseline number doubles as the comparison row in the writeup.
For llm-client: my baseline_predict() in data/eval.py is importable if you want it for your mock/regex mode — don't duplicate.
Next: Freesolo export format + README.

## [22:11] DONE — Freesolo export + README; ALL llm-data tasks complete
Freesolo's trainer format is unconfirmed (llm-client already asked in ml/freesolo-agent/NOTES.md Q6) → native deliverable is standard chat-JSONL, plus `export.py --format prompt-completion|alpaca` writes converted copies to `data/export/` (all four files generated + spot-checked). `data/README.md` documents the full contract, composition, and how the teammate trains/evals.
IMPORTANT change for @llm-client: after reading your NOTES.md validator spec, I regenerated the dataset so the model ALWAYS outputs JSON — clarifications/off-topic are now `{"clarify":"<question>"}` (was plain text). This matches your accepted shapes (NOTES.md Q4); every assistant turn in the dataset is machine-parseable JSON (2,432 actions + 320 clarify turns, all validated).
Deliverables: farmhand_train.jsonl (2,349) / farmhand_val.jsonl (123) / eval_set.jsonl (30 held-out) / eval.py (baseline 28/30 = 93.3%, endpoint + predictions modes verified) / generate_dataset.py (seeded, reproducible) / export.py / README.md.
Idle — ping me if the teammate answers NOTES.md Q6 with a different format, or if anyone wants more data variants.

## [restart] WIP→DONE — Recovered after crash; Phase-2 preference-pair dataset built
Verified all Phase-1 deliverables survived: 2,472 SFT turns re-validated against schema (2,152 actions + 320 clarify, 0 bad), eval.py --baseline still 28/30 (93.3%), all 4 export/ files present. No processes to restart (deliverables are static files).
Phase-2 (BROADCAST bonus): `generate_prefs.py` → `farmhand_prefs.jsonl` = 600 chosen/rejected preference pairs for RL/DPO (TRL conversational format). 9 failure-mode categories: prose_not_json (133), guessed_instead_of_clarifying (87), schema_violation (86), over_clarified (81), wrong_fruit/filter/zone/task, offtopic_should_redirect. Every `chosen` schema-valid; every `rejected` a realistic worse answer. Validated: 0 eval leakage, 0 chosen==rejected, deterministic (seed=6, md5 stable). Added `export.py --format dpo-flat` (→ plain-string DPO fields) + documented full category table in `data/README.md`.
Next: idle — all llm-data tasks + Phase-2 bonus complete. Ping if teammate answers NOTES.md Q6 (Freesolo trainer format) or wants more data variants.

## [phase4] DONE — Judge-facing README.md overhaul (now own root README.md)
Rewrote root `README.md` for judges: (1) "Battery, not Blood" hero + live/repo links; (2) **Quickstart** — `./scripts/demo.sh` one-command boot + `./scripts/check-stack.sh` health check + a collapsible manual-boot fallback (works today); (3) upgraded **architecture mermaid** showing the intentional MPU/MCU split, FarmHand LLM, hub fan-out, Base44 webhook, Gamepad teleop; (4) **track-by-track evidence table** — every claim links to a real file a judge can open (DEVPOST/QUALCOMM/TRACKS/DATA/BASE44, eval.py 28/30 baseline, bench.py, ml/ripeness/export int8 model, store.js waste-avoided, DEMO_TRANSCRIPT); (5) linked repo-layout table.
Verified: all 27 link targets resolve. ONE forward-ref: `scripts/demo.sh` (fw-tools' Phase-4 deliverable, not landed yet) — README's quickstart depends on it; manual-boot fallback covers the gap until it lands. @fw-tools: my quickstart calls `./scripts/demo.sh` with no args to boot hub+robot-mock+lidar-sim+web — please match that invocation.
Next: idle. Ping if demo.sh lands with a different invocation, or if the live Vercel URL changes.

## [style-sweep] DONE - Removed all em dashes + emojis from docs/ and README.md
Swept 15 files (my assigned area: docs/ + README.md). Removed 362 em dashes (U+2014 -> hyphen, spacing preserved) and all pictographic emojis (apple/globe/clapper/gamepad/box/robot/shark/party, plus check/no-entry/cross/warning/hourglass). Surgical char-level transform, so no content or in-flight edits from other workers were disturbed.
Deliberately KEPT (not emojis, not em dashes, carry meaning): arrows (->  <->), math symbols (x, div, deg, approx, <=, >=, subscripts), box-drawing diagram chars, en dashes in numeric ranges (30-40 pct style), section/middle-dot/bullet punctuation.
Verified: re-scan shows 0 residual em dashes, 0 residual emojis across all 15 files. Mermaid block in README still valid (node labels lost emojis cleanly). README's 27 link targets untouched (sweep never altered link paths). No build step for docs; markdown structure intact. status/ logs left exempt per directive.
Next: idle. All llm-data work complete (SFT dataset, eval, preference pairs, README overhaul, style sweep).

## [style-sweep followup] DONE - Regenerated farmhand_prefs.jsonl to clear em dashes from training data
Linter applied the style rule to my generator sources (generate_prefs.py trailing-prose strings). That left the committed farmhand_prefs.jsonl (+ export/farmhand_prefs.dpo-flat.jsonl) carrying 42 em dashes baked into judged RL data, out of sync with their now-fixed generator. Regenerated both (seeded, deterministic): same 600 pairs, same category distribution, now 0 em dashes / 0 emojis. Re-validated: rows=600, eval_leak=0, bad_chosen=0, chosen==rejected=0. SFT files (train/val/eval) were already clean.
Note for @vision-infer (owns ml/ in the sweep): ml/freesolo-agent/data/ is llm-data-owned and now fully compliant - no action needed from you there.

## [style-clean v2] DONE - Full ASCII clean of docs/ + README.md
Swept all 15 files for the expanded rule: unicode arrows (-> / <- / <->; down-arrows became "v" flow-connectors, and "[v Label]" nav labels lost the glyph), box-drawing redrawn as ASCII (- | +, ^ v > <), unicode ellipsis (...), curly quotes (none present), plus em-dash and emoji stragglers that reappeared after other workers edited files. ~200 arrows + 163 box-drawing chars + emoji stragglers in MONGODB_AUTH0.md all cleared.
Diagrams preserved, not deleted: HARDWARE power tree, INTEGRATION bring-up flow, and the QUALCOMM MPU/MCU architecture block were converted char-for-char to ASCII and re-read clean. README mermaid labels now use "->" (valid inside quoted labels).
Verified: full re-scan shows 0 emdash / 0 arrows / 0 box / 0 ellipsis / 0 emoji / 0 curly across all 15 files. Builds: docs have no compile step; my owned code (ml/freesolo-agent/data/) re-smoke-tested - eval baseline still 28/30, generators import clean, data dir already fully ASCII-clean.
Next: idle. All llm-data work complete and style-compliant.
