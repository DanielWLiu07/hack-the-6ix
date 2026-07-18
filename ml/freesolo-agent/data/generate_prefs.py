#!/usr/bin/env python3
"""Preference-pair (chosen/rejected) dataset generator for FarmHand RL/DPO.

Bonus deliverable (Phase 2) on top of the SFT set. Teaches the model to *prefer*
the correct, machine-parseable action over plausible-but-wrong alternatives —
the failure modes that actually bite us in production (llm-client rejects any
non-JSON or schema-violating output, so an SFT model that occasionally lapses
into prose or guesses a field silently drops the command).

Deterministic (seeded). Reuses the SFT generator's vocabulary/cores so the
prompt distribution matches farmhand_train.jsonl exactly.

Output (TRL-style conversational preference JSONL, one row per line):
  {"prompt":   [ {role,content}, ... up to and including the final user turn ],
   "chosen":   [ {"role":"assistant","content":"<correct JSON>"} ],
   "rejected": [ {"role":"assistant","content":"<worse response>"} ],
   "reason":   "<failure-mode category, for docs/analysis>"}

`reason` is metadata; export.py --format dpo-flat drops it and flattens `prompt`
to a string for trainers that want {"prompt","chosen","rejected"} plain text.

Usage: python3 generate_prefs.py  (writes farmhand_prefs.jsonl + prints a
        category breakdown; run eval-free, ~600 pairs)
"""

import json
import random
from pathlib import Path

import generate_dataset as g  # reuse SYSTEM_PROMPT, vocab, cores, surface()

SEED = 6
HERE = Path(__file__).parent
TARGET = 600


# ---------------------------------------------------------------- helpers

def a_str(act):
    return g.action_str(act)


def clar(q):
    return g.clarify_str(q)


def other(rng, value, pool):
    """Pick any pool member that isn't `value` (for building wrong fields)."""
    alts = [x for x in pool if x != value]
    return rng.choice(alts)


# Prose paraphrases of an action — the single worst failure: not JSON at all.
def prose_of(rng, act):
    task, fruit, filt, zone = act["task"], act["fruit"], act["filter"], act["zone"]
    f = {"apple": "apples", "banana": "bananas", "any": "the fruit"}[fruit]
    adj = {"ripe": "ripe ", "unripe": "unripe ", "any": ""}[filt]
    if task == "pick":
        return rng.choice([
            f"Sure, I'll pick the {adj}{f} now.",
            f"On it — heading over to grab the {adj}{f}.",
            f"Okay! Picking {adj}{f} for you.",
            f"Got it, I'll start harvesting the {adj}{f}.",
        ])
    if task == "sort":
        return rng.choice([
            f"Sure, sorting the {adj}{f} into their bins now.",
            f"Okay, I'll organize the {adj}{f} by type and ripeness.",
            "On it — sorting everything into the right bins.",
        ])
    if task == "stop":
        return rng.choice([
            "Stopping the robot right now!",
            "Okay, halting all motion immediately.",
            "Emergency stop — everything's shutting down.",
        ])
    if task == "drive":
        z = {"forward": "forward", "backward": "backward", "left": "to the left",
             "right": "to the right", "home": "back home", "any": "over there"}[zone]
        return rng.choice([
            f"Sure, driving {z} now.",
            f"On it — rolling {z}.",
            f"Okay! Heading {z}.",
        ])
    return "Okay, doing that now."


# Schema-violating JSON: right intent, but a shape llm-client rejects.
def bad_json(rng, act):
    kind = rng.choice(["extra_key", "drop_key", "bad_enum", "wrapped", "trailing"])
    if kind == "extra_key":
        d = dict(act)
        d[rng.choice(["confidence", "reason", "priority", "count"])] = rng.choice(
            [0.9, "high", "all", 3])
        return json.dumps(d, separators=(",", ":"))
    if kind == "drop_key":
        d = dict(act)
        del d[rng.choice(["fruit", "filter", "zone"])]
        return json.dumps(d, separators=(",", ":"))
    if kind == "bad_enum":
        d = dict(act)
        d["task"] = rng.choice(["grab", "move_to", "collect", "harvest"])
        return json.dumps(d, separators=(",", ":"))
    if kind == "wrapped":
        return json.dumps({"action": act}, separators=(",", ":"))
    # trailing prose after the JSON — not pure JSON, parser-hostile
    return a_str(act) + rng.choice(["  Done!", "  Let me know if that's right.",
                                    " — picking now.", "\nAnything else?"])


# ---------------------------------------------------------------- pair builders
# Each returns (prompt_msgs, chosen_str, rejected_str, reason) or None.

FRUITS = ["apple", "banana", "any"]
FILTS = ["ripe", "unripe", "any"]
ZONES = ["forward", "backward", "left", "right", "home"]


def build(rng):
    """Produce one preference pair from a randomly chosen failure mode."""
    mode = rng.choices(
        ["prose", "wrong_field", "guess_vs_clarify", "clarify_vs_act",
         "bad_json", "offtopic", "wrong_task"],
        weights=[22, 22, 14, 12, 14, 8, 8],
    )[0]
    sys = {"role": "system", "content": g.SYSTEM_PROMPT}

    def user(t):
        return [sys, {"role": "user", "content": t}]

    if mode == "prose":
        # clear actionable command; chosen=JSON, rejected=natural-language prose
        pick = rng.random() < 0.7
        if pick:
            fruit = rng.choice(FRUITS)
            filt = rng.choice(FILTS)
            t = g.surface(rng, g.gen_pick_core(rng, fruit, filt))
            act = g.action("pick", fruit, filt)
        else:
            zone = rng.choice(ZONES)
            t = g.surface(rng, g.gen_drive_core(rng, zone))
            act = g.action("drive", zone=zone)
        return user(t), a_str(act), prose_of(rng, act), "prose_not_json"

    if mode == "wrong_field":
        # correct task+fruit, but one subtly wrong field in the rejected answer
        fruit = rng.choice(["apple", "banana"])
        filt = rng.choice(FILTS)
        t = g.surface(rng, g.gen_pick_core(rng, fruit, filt))
        act = g.action("pick", fruit, filt)
        which = rng.choice(["fruit", "filter"])
        bad = dict(act)
        if which == "fruit":
            bad["fruit"] = other(rng, fruit, ["apple", "banana"])
        else:
            bad["filter"] = other(rng, filt, FILTS)
        return user(t), a_str(act), json.dumps(bad, separators=(",", ":")), \
            f"wrong_{which}"

    if mode == "wrong_task":
        # pick vs sort confusion, or drive-zone confusion
        if rng.random() < 0.5:
            fruit = rng.choice(FRUITS)
            t = g.surface(rng, g.gen_pick_core(rng, fruit, "any"))
            chosen = g.action("pick", fruit)
            bad = g.action("sort", fruit)
            return user(t), a_str(chosen), a_str(bad), "wrong_task_pick_vs_sort"
        zone = rng.choice(ZONES)
        t = g.surface(rng, g.gen_drive_core(rng, zone))
        chosen = g.action("drive", zone=zone)
        bad = g.action("drive", zone=other(rng, zone, ZONES))
        return user(t), a_str(chosen), a_str(bad), "wrong_zone"

    if mode == "guess_vs_clarify":
        # ambiguous command: chosen=clarify, rejected=a confident guess
        pool = rng.choice([g.VAGUE_PICK, g.VAGUE_DRIVE])
        t = g.surface(rng, rng.choice(pool), suffix=False)
        if pool is g.VAGUE_PICK:
            chosen = clar(rng.choice(g.CLARIFY_FRUIT_Q))
            bad = a_str(g.action("pick", rng.choice(["apple", "banana"]),
                                 rng.choice(["ripe", "unripe"])))
        else:
            chosen = clar(rng.choice(g.CLARIFY_ZONE_Q))
            bad = a_str(g.action("drive", zone=rng.choice(ZONES)))
        return user(t), chosen, bad, "guessed_instead_of_clarifying"

    if mode == "clarify_vs_act":
        # unambiguous command: chosen=action, rejected=needless clarify question
        fruit = rng.choice(["apple", "banana"])
        filt = rng.choice(["ripe", "unripe"])
        t = g.surface(rng, g.gen_pick_core(rng, fruit, filt))
        chosen = a_str(g.action("pick", fruit, filt))
        bad = clar(rng.choice(g.CLARIFY_FRUIT_Q + [
            "Which ones do you mean?", "Can you be more specific?"]))
        return user(t), chosen, bad, "over_clarified_clear_command"

    if mode == "bad_json":
        # correct intent; rejected violates the strict output schema
        fruit = rng.choice(FRUITS)
        filt = rng.choice(FILTS)
        t = g.surface(rng, g.gen_pick_core(rng, fruit, filt))
        act = g.action("pick", fruit, filt)
        return user(t), a_str(act), bad_json(rng, act), "schema_violation"

    # offtopic: chosen=redirect clarify, rejected=tries to comply / hallucinates
    t = g.surface(rng, rng.choice(g.OFFTOPIC), prefix=rng.random() < 0.3)
    chosen = clar(rng.choice(g.OFFTOPIC_REPLIES))
    bad = rng.choice([
        a_str(g.action(rng.choice(["pick", "drive", "sort"]))),
        prose_of(rng, g.action("pick", "any", "any")),
        "Sure, one moment!",
    ])
    return user(t), chosen, bad, "offtopic_should_redirect"


def main():
    rng = random.Random(SEED)
    seen = set()
    rows = []
    counts = {}
    attempts = 0
    while len(rows) < TARGET and attempts < TARGET * 80:
        attempts += 1
        prompt, chosen, rejected, reason = build(rng)
        if chosen == rejected:
            continue
        user_text = prompt[-1]["content"]
        key = (g.norm(user_text), reason, rejected)
        if key in seen:
            continue
        seen.add(key)
        rows.append({
            "prompt": prompt,
            "chosen": [{"role": "assistant", "content": chosen}],
            "rejected": [{"role": "assistant", "content": rejected}],
            "reason": reason,
        })
        counts[reason] = counts.get(reason, 0) + 1

    out = HERE / "farmhand_prefs.jsonl"
    with open(out, "w") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"wrote {out.name}: {len(rows)} preference pairs")
    for reason in sorted(counts, key=lambda k: -counts[k]):
        print(f"  {reason:34s} {counts[reason]}")


if __name__ == "__main__":
    main()
