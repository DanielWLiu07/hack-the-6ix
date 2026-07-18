"""FarmHand Freesolo environment.

Task: natural-language robot command -> one JSON action (or a clarify question).
Matches ml/freesolo-agent/client/farmhand.py's schema and system prompt exactly,
so the model is trained the same way it is served.

Dataset rows are {"input": <command>, "output": <assistant JSON string>}, produced
by convert_dataset.py from ../data/farmhand_{train,val}.jsonl.
"""
from __future__ import annotations

import json
from pathlib import Path

from freesolo.datasets.types import TaskExample
from freesolo.environments import EnvironmentSingleTurn, RewardResult

HERE = Path(__file__).parent
SYSTEM_PROMPT = (HERE / "system_prompt.txt").read_text().strip()

TASKS = {"pick", "sort", "stop", "drive"}
FRUITS = {"apple", "banana", "any"}
FILTERS = {"ripe", "unripe", "any"}
ZONES = {"any", "left", "right", "forward", "backward", "home"}


def load_jsonl(path: str | Path):
    rows = []
    with Path(path).open() as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def _first_json_obj(text):
    """Pull the first {...} JSON object out of a response string, or None."""
    start = text.find("{")
    while start != -1:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except ValueError:
                        break
        start = text.find("{", start + 1)
    return None


def _valid_action(obj):
    return (
        isinstance(obj, dict)
        and set(obj) <= {"task", "fruit", "filter", "zone"}
        and obj.get("task") in TASKS
        and obj.get("fruit", "any") in FRUITS
        and obj.get("filter", "any") in FILTERS
        and obj.get("zone", "any") in ZONES
    )


def _norm(a):
    return {
        "task": a.get("task"),
        "fruit": a.get("fruit", "any"),
        "filter": a.get("filter", "any"),
        "zone": a.get("zone", "any"),
    }


def farmhand_reward(example: TaskExample, response_text: str) -> RewardResult:
    """Graded JSON-aware reward (v2 - denser signal for GRPO).

    Freesolo's docs: reward quality is the ceiling. A 0/0.5/1 cliff gives GRPO
    almost no gradient between "wrong action" and "invalid"; this version scores
    per-field so the model is pulled toward the right answer field by field.

      1.0   exact action match (all 4 fields), OR both target+response clarify
      0.6..0.9  schema-valid action, graded 0.6 + 0.1*(fields correct) up to 3/4
      0.0   invalid JSON / wrong shape / clarified when an action was expected
            (the over-clarification failure mode is penalized to zero on purpose)
    """
    expected = _first_json_obj(str(example.output or ""))
    got = _first_json_obj(response_text)
    if got is None:
        return RewardResult(score=0.0, threshold=1.0)

    exp_clarify = isinstance(expected, dict) and "clarify" in expected
    got_clarify = "clarify" in got
    if exp_clarify or got_clarify:
        # clarify is right only when the gold is a clarify; over-clarifying = 0
        return RewardResult(score=1.0 if (exp_clarify and got_clarify) else 0.0, threshold=1.0)

    if not _valid_action(got) or not isinstance(expected, dict):
        return RewardResult(score=0.0, threshold=1.0)

    g, e = _norm(got), _norm(expected)
    correct = sum(1 for f in ("task", "fruit", "filter", "zone") if g[f] == e[f])
    if correct == 4:
        return RewardResult(score=1.0, threshold=1.0)
    return RewardResult(score=0.6 + 0.1 * correct, threshold=1.0)


def _load_train():
    rows = load_jsonl(HERE / "dataset" / "train.jsonl")
    aug = HERE / "dataset" / "augment.jsonl"
    if aug.exists():
        rows = rows + load_jsonl(aug)  # v2: typo/slang robustness augmentation
    return rows


class FarmHandEnv(EnvironmentSingleTurn):
    dataset = _load_train()

    def build_prompt_messages(self, example: TaskExample, prompt_text: str):
        return [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": example.input},
        ]

    def score_response(self, example: TaskExample, response_text: str) -> RewardResult:
        return farmhand_reward(example, response_text)


def load_environment(dataset_path: str | None = None, split: str | None = None, **kwargs) -> FarmHandEnv:
    env = FarmHandEnv()
    if dataset_path:
        env.dataset = load_jsonl(dataset_path)
    elif split:
        env.dataset = load_jsonl(HERE / "dataset" / f"{split}.jsonl")
    return env
