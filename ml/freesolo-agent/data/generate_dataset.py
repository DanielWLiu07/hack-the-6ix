#!/usr/bin/env python3
"""Synthetic SFT dataset generator for FarmHand (NL command -> action JSON).

Deterministic (seeded). Produces chat-format JSONL:
  {"messages": [{"role":"system",...},{"role":"user",...},{"role":"assistant",...}]}

Action schema (all four keys always present, "any" = unspecified):
  {"task":"pick|sort|stop|drive","fruit":"apple|banana|any",
   "filter":"ripe|unripe|any","zone":"any|left|right|forward|backward|home"}

Assistant convention (model ALWAYS outputs JSON - llm-client parses both shapes):
  - actionable command  -> assistant outputs ONLY the compact action JSON
  - ambiguous command   -> assistant outputs {"clarify":"<one short question>"},
                           user answers, assistant outputs the action JSON
  - off-topic request   -> assistant outputs {"clarify":"<brief redirect>"}

Usage: python3 generate_dataset.py  (writes farmhand_train.jsonl / farmhand_val.jsonl)
"""

import json
import random
import re
from pathlib import Path

SEED = 6
VAL_FRACTION = 0.05
HERE = Path(__file__).parent

SYSTEM_PROMPT = (
    "You are FarmHand, the natural-language command interface for an autonomous "
    "fruit-picking robot. Convert the user's command into exactly one JSON action: "
    '{"task":"pick|sort|stop|drive","fruit":"apple|banana|any",'
    '"filter":"ripe|unripe|any","zone":"any|left|right|forward|backward|home"}. '
    "Output ONLY the JSON, nothing else. If the command is ambiguous, do not guess: "
    'output {"clarify":"<one short question>"} instead. If the request is unrelated '
    'to the robot, output {"clarify":"<brief note about what you can do>"}.'
)


def clarify_str(question):
    return json.dumps({"clarify": question}, separators=(",", ":"))


def action(task, fruit="any", filt="any", zone="any"):
    return {"task": task, "fruit": fruit, "filter": filt, "zone": zone}


def action_str(a):
    return json.dumps(a, separators=(",", ":"))


# vocabulary

PREFIXES = [
    "", "", "", "", "", "", "",  # weight toward no prefix
    "hey robot, ", "please ", "yo ", "ok farmhand, ", "robot, ", "can you ",
    "could you ", "i need you to ", "go ahead and ", "hey, ", "farmhand, ",
    "alright, ", "hey farmhand ", "would you ",
]

SUFFIXES = [
    "", "", "", "", "", "", "",
    " please", " pls", " now", " for me", " thanks", " ty", " asap",
    " when you can", " right away", " ok", " thx",
]

PICK_VERBS = [
    "pick", "grab", "get", "fetch", "collect", "harvest", "gather", "pluck",
    "snag", "go get", "go grab", "pick up", "scoop up", "bring me",
    "bring back", "round up", "take",
]

# (plural-compatible quantifier, needs_singular)
QUANTIFIERS = [
    ("all the", False), ("all", False), ("every", True), ("each", True),
    ("the", False), ("some", False), ("any", False), ("", False),
    ("all of the", False), ("a few", False),
]

FRUIT_PLURAL = {
    "apple": ["apples", "apples", "apples"],
    "banana": ["bananas", "bananas", "nanas", "nanners"],
    "any": ["fruit", "fruits", "produce", "apples and bananas", "everything",
            "both fruits", "all the fruit"],
}
FRUIT_SINGULAR = {
    "apple": ["apple"],
    "banana": ["banana", "nana"],
    "any": ["fruit", "piece of fruit"],
}

# pre-nominal filter adjectives
FILTER_PRE = {
    "ripe": ["ripe", "ready", "ripened", "mature", "ready-to-eat"],
    "unripe": ["unripe", "green", "underripe", "immature", "not-yet-ripe"],
    "any": [""],
}
# post-nominal filter clauses (plural subjects only)
FILTER_POST = {
    "ripe": ["that are ripe", "that look ready", "that are ready to eat",
             "that are good and ripe"],
    "unripe": ["that are still green", "that aren't ripe", "that aren't ripe yet",
               "that are not ripe", "that need more time"],
    "any": ["ripe or not", "regardless of ripeness", "both ripe and unripe",
            "no matter the ripeness"],
}

# color phrasings imply fruit+ripeness together
COLOR_COMBOS = [
    ("red apples", "apple", "ripe"),
    ("the red apples", "apple", "ripe"),
    ("red ones", "apple", "ripe"),
    ("yellow bananas", "banana", "ripe"),
    ("the yellow bananas", "banana", "ripe"),
    ("green bananas", "banana", "unripe"),
    ("the green bananas", "banana", "unripe"),
    ("green apples", "apple", "unripe"),
    ("the green apples", "apple", "unripe"),
]

SORT_VERBS = ["sort", "sort out", "organize", "separate", "bin", "categorize",
              "put away", "sort through"]
SORT_OBJECTS = {
    "any": ["the fruit", "the fruits", "everything", "the harvest", "the produce",
            "all of it", "what you picked", "the haul", "these"],
    "apple": ["the apples", "all the apples", "those apples"],
    "banana": ["the bananas", "all the bananas", "those nanas"],
}

STOP_PHRASES = [
    "stop", "stop!", "halt", "freeze", "abort", "cancel", "cancel that",
    "stand down", "cut it out", "hold up", "hold on", "wait stop",
    "emergency stop", "e-stop", "estop", "estop now", "kill it",
    "shut it down", "stop moving", "stop everything", "whoa whoa stop",
    "quit it", "stop right now", "cease", "abort mission", "full stop",
    "stop the robot", "don't move", "stay still", "pause everything",
    "knock it off", "hit the brakes", "stop stop stop", "everything off",
    "power down the motion", "wait wait wait stop", "hold everything",
    "abort abort", "red button", "kill switch",
]

DRIVE_VERBS = ["drive", "go", "move", "head", "roll", "cruise", "scoot", "steer"]
ZONE_WORDS = {
    "forward": ["forward", "ahead", "straight", "straight ahead", "up ahead",
                "forwards"],
    "backward": ["backward", "back", "backwards", "in reverse"],
    "left": ["left", "to the left", "over to the left"],
    "right": ["right", "to the right", "over to the right"],
    "home": ["home", "back to base", "to home base", "back home",
             "to the start", "back to the charging station"],
}
DRIVE_SPECIALS = {
    "backward": ["back up", "back it up", "reverse", "reverse a bit", "back off"],
    "home": ["come home", "come back", "come back to me", "return to base",
             "head back", "go home"],
    "forward": ["keep going", "onward", "advance", "full speed ahead"],
}

ZONE_PICK_SUFFIX = {
    "left": ["on the left", "on your left", "to your left", "in the left row"],
    "right": ["on the right", "on your right", "to your right", "in the right row"],
    "forward": ["up ahead", "in front of you", "straight ahead"],
}

CLARIFY_FRUIT_Q = [
    "Which fruit - apples, bananas, or both?",
    "Do you mean apples, bananas, or both?",
    "Apples, bananas, or both?",
    "Which fruit should I go for - apples, bananas, or both?",
]
CLARIFY_ZONE_Q = [
    "Which way - forward, backward, left, right, or home?",
    "Which direction should I drive: forward, backward, left, right, or home?",
    "Where to - forward, backward, left, right, or back home?",
]
FRUIT_ANSWERS = {
    "apple": ["apples", "the apples", "just apples", "apples please", "apple",
              "just the apples", "go with apples"],
    "banana": ["bananas", "the bananas", "just bananas", "bananas please",
               "banana", "the nanas", "go with bananas"],
    "any": ["both", "both please", "either", "all of them", "everything",
            "any of them", "doesn't matter", "whatever you find"],
}
ZONE_ANSWERS = {
    "forward": ["forward", "straight ahead", "ahead"],
    "backward": ["backward", "back", "reverse"],
    "left": ["left", "to the left"],
    "right": ["right", "to the right"],
    "home": ["home", "back to base", "back home"],
}

VAGUE_PICK = [
    "pick the fruit", "start picking", "get them", "grab them", "pick them up",
    "go pick", "start the harvest", "get picking", "collect them",
    "grab the fruit for me", "pick some fruit", "do your thing", "harvest time",
    "get to work picking", "go get em",
]
VAGUE_PICK_RIPE = [
    "pick the ripe ones", "grab the ripe ones", "get the ready ones",
    "collect the ripe ones", "only the ripe ones", "just the ripe ones please",
    "harvest whatever is ripe", "get everything that's ready",
]
VAGUE_PICK_UNRIPE = [
    "pick the green ones", "grab the unripe ones", "get the ones that aren't ready",
    "collect the green ones", "only the unripe ones",
]
VAGUE_SORT = [
    "sort them", "sort it", "sort", "organize it all", "separate them",
    "put them away", "bin them",
]
VAGUE_DRIVE = [
    "move", "drive", "go", "get moving", "start driving", "roll out",
    "move it", "drive somewhere", "head out",
]

OFFTOPIC = [
    "what's the weather like", "tell me a joke", "order a pizza",
    "sing me a song", "how old are you", "make me a coffee",
    "what's the meaning of life", "play some music", "who won the game last night",
    "write me a poem about farming", "what time is it", "book me a flight",
    "translate hello to french", "do my homework", "what's 2+2",
    "tell me about the stock market", "send an email to my boss",
    "turn on the lights in the house", "walk the dog", "mow the lawn",
]
OFFTOPIC_REPLIES = [
    "I can only control the fruit robot - picking, sorting, driving, or stopping. What would you like it to do?",
    "That's outside my wheelhouse. I can pick fruit, sort it, drive the rover, or stop - what should I do?",
    "I'm just the farm robot's command interface. Try asking me to pick, sort, drive, or stop.",
    "Sorry, I only handle robot commands: pick, sort, drive, or stop.",
]

TYPO_PROB = 0.12


# surface fx

def inject_typo(rng, text):
    """One small realistic typo: swap, drop, or double a letter."""
    idxs = [i for i, c in enumerate(text) if c.isalpha()]
    if len(idxs) < 4:
        return text
    kind = rng.choice(["swap", "drop", "double"])
    i = rng.choice(idxs[1:-1])
    if kind == "swap" and i + 1 < len(text) and text[i + 1].isalpha():
        return text[:i] + text[i + 1] + text[i] + text[i + 2:]
    if kind == "drop":
        return text[:i] + text[i + 1:]
    return text[:i] + text[i] + text[i:]


def surface(rng, core, prefix=True, suffix=True):
    t = (rng.choice(PREFIXES) if prefix else "") + core + (rng.choice(SUFFIXES) if suffix else "")
    r = rng.random()
    if r < 0.55:
        t = t.lower()
    elif r < 0.85:
        t = t[0].upper() + t[1:]
    elif r < 0.90:
        t = t.upper()
    p = rng.random()
    if p < 0.18 and not t.endswith("!"):
        t += "."
    elif p < 0.30 and not t.endswith("!"):
        t += "!"
    if rng.random() < TYPO_PROB:
        t = inject_typo(rng, t)
    return re.sub(r"\s+", " ", t).strip()


def norm(text):
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


# generators

def gen_pick_core(rng, fruit, filt):
    verb = rng.choice(PICK_VERBS)
    if rng.random() < 0.10 and filt != "any":
        # color phrasing overrides fruit/filter words
        combos = [c for c in COLOR_COMBOS if c[1] == fruit and c[2] == filt]
        if combos:
            phrase = rng.choice(combos)[0]
            return f"{verb} {phrase}"
    quant, singular = rng.choice(QUANTIFIERS)
    noun = rng.choice(FRUIT_SINGULAR[fruit] if singular else FRUIT_PLURAL[fruit])
    use_post = (not singular) and rng.random() < 0.35 and filt != "any"
    if use_post:
        clause = rng.choice(FILTER_POST[filt])
        parts = [verb, quant, noun, clause]
    else:
        adj = rng.choice(FILTER_PRE[filt])
        if filt == "any" and rng.random() < 0.15:
            parts = [verb, quant, noun, rng.choice(FILTER_POST["any"])]
        else:
            parts = [verb, quant, adj, noun]
    return " ".join(p for p in parts if p)


def gen_sort_core(rng, fruit, filt):
    verb = rng.choice(SORT_VERBS)
    obj = rng.choice(SORT_OBJECTS[fruit])
    if filt != "any":
        adj = rng.choice(FILTER_PRE[filt])
        obj = re.sub(r"^(the|all the|those) ", rf"\g<1> {adj} ", obj)
    tail = ""
    if rng.random() < 0.25:
        tail = rng.choice([" into bins", " into the right bins", " by ripeness",
                           " into their bins", " by type"])
    return f"{verb} {obj}{tail}"


def gen_drive_core(rng, zone):
    if zone in DRIVE_SPECIALS and rng.random() < 0.3:
        return rng.choice(DRIVE_SPECIALS[zone])
    verb = rng.choice(DRIVE_VERBS)
    word = rng.choice(ZONE_WORDS[zone])
    if verb == "head" and not word.startswith(("to", "back", "in")):
        word = rng.choice(["to the " + zone if zone in ("left", "right") else word, word])
    tail = rng.choice(["", "", "", " a bit", " a little", " some more"]) \
        if zone in ("forward", "backward") else ""
    return f"{verb} {word}{tail}"


def gen_zone_pick_core(rng, fruit, zone):
    verb = rng.choice(PICK_VERBS)
    noun = rng.choice(FRUIT_PLURAL[fruit])
    quant = rng.choice(["the", "all the", ""])
    loc = rng.choice(ZONE_PICK_SUFFIX[zone])
    return " ".join(p for p in [verb, quant, noun, loc] if p)


def chat(user_texts_and_assistant_turns):
    msgs = [{"role": "system", "content": SYSTEM_PROMPT}]
    msgs.extend(user_texts_and_assistant_turns)
    return {"messages": msgs}


def single(text, act):
    return chat([{"role": "user", "content": text},
                 {"role": "assistant", "content": action_str(act)}])


def main():
    rng = random.Random(SEED)
    seen = set()
    examples = []

    # texts reserved for the hand-written eval set - never emit these
    eval_path = HERE / "eval_set.jsonl"
    if eval_path.exists():
        for line in eval_path.read_text().splitlines():
            if line.strip():
                seen.add(norm(json.loads(line)["text"]))

    def add(ex, key_text):
        k = norm(key_text)
        if k and k not in seen:
            seen.add(k)
            examples.append(ex)
            return True
        return False

    def fill(target, make):
        """Call make() until `target` unique examples added (bounded attempts)."""
        added, attempts = 0, 0
        while added < target and attempts < target * 60:
            attempts += 1
            ex, key = make()
            if add(ex, key):
                added += 1
        return added

    # single-turn: pick (9 fruit x filter buckets)
    for fruit in ("apple", "banana", "any"):
        for filt in ("ripe", "unripe", "any"):
            target = 140 if fruit != "any" else 110
            def mk(fruit=fruit, filt=filt):
                t = surface(rng, gen_pick_core(rng, fruit, filt))
                return single(t, action("pick", fruit, filt)), t
            fill(target, mk)

    # single-turn: sort
    for fruit in ("any", "apple", "banana"):
        for filt in ("any", "ripe", "unripe"):
            target = 40 if fruit == "any" and filt == "any" else 18
            def mk(fruit=fruit, filt=filt):
                t = surface(rng, gen_sort_core(rng, fruit, filt))
                return single(t, action("sort", fruit, filt)), t
            fill(target, mk)

    # single-turn: stop
    def mk_stop():
        core = rng.choice(STOP_PHRASES)
        t = surface(rng, core, prefix=rng.random() < 0.3, suffix=rng.random() < 0.2)
        return single(t, action("stop")), t
    fill(190, mk_stop)

    # single-turn: drive
    for zone in ZONE_WORDS:
        def mk(zone=zone):
            t = surface(rng, gen_drive_core(rng, zone))
            return single(t, action("drive", zone=zone)), t
        fill(100, mk)

    # single-turn: pick with a zone
    for zone in ZONE_PICK_SUFFIX:
        for fruit in ("apple", "banana", "any"):
            def mk(zone=zone, fruit=fruit):
                t = surface(rng, gen_zone_pick_core(rng, fruit, zone))
                return single(t, action("pick", fruit, "any", zone)), t
            fill(12, mk)

    # multi-turn clarification: vague pick (fruit unknown)
    def mk_clar_pick(pool, filt):
        def mk():
            t = surface(rng, rng.choice(pool), suffix=False)
            fruit = rng.choice(["apple", "banana", "any"])
            ans = rng.choice(FRUIT_ANSWERS[fruit])
            ex = chat([
                {"role": "user", "content": t},
                {"role": "assistant", "content": clarify_str(rng.choice(CLARIFY_FRUIT_Q))},
                {"role": "user", "content": ans},
                {"role": "assistant", "content": action_str(action("pick", fruit, filt))},
            ])
            return ex, t + " || " + ans
        return mk
    fill(90, mk_clar_pick(VAGUE_PICK, "any"))
    fill(60, mk_clar_pick(VAGUE_PICK_RIPE, "ripe"))
    fill(40, mk_clar_pick(VAGUE_PICK_UNRIPE, "unripe"))

    # multi-turn clarification: vague sort
    def mk_clar_sort():
        t = surface(rng, rng.choice(VAGUE_SORT), suffix=False)
        fruit = rng.choice(["apple", "banana", "any"])
        ans = rng.choice(FRUIT_ANSWERS[fruit])
        q = rng.choice(["Sort what - apples, bananas, or everything?",
                        "Should I sort apples, bananas, or everything?"])
        ex = chat([
            {"role": "user", "content": t},
            {"role": "assistant", "content": clarify_str(q)},
            {"role": "user", "content": ans},
            {"role": "assistant", "content": action_str(action("sort", fruit))},
        ])
        return ex, t + " || " + ans
    fill(40, mk_clar_sort)

    # multi-turn clarification: vague drive
    def mk_clar_drive():
        t = surface(rng, rng.choice(VAGUE_DRIVE), suffix=False)
        zone = rng.choice(list(ZONE_ANSWERS))
        ans = rng.choice(ZONE_ANSWERS[zone])
        ex = chat([
            {"role": "user", "content": t},
            {"role": "assistant", "content": clarify_str(rng.choice(CLARIFY_ZONE_Q))},
            {"role": "user", "content": ans},
            {"role": "assistant", "content": action_str(action("drive", zone=zone))},
        ])
        return ex, t + " || " + ans
    fill(50, mk_clar_drive)

    # off-topic redirects (teach when NOT to emit JSON)
    def mk_offtopic():
        t = surface(rng, rng.choice(OFFTOPIC), prefix=rng.random() < 0.3)
        ex = chat([{"role": "user", "content": t},
                   {"role": "assistant", "content": clarify_str(rng.choice(OFFTOPIC_REPLIES))}])
        return ex, t
    fill(40, mk_offtopic)

    # shuffle + split
    rng.shuffle(examples)
    n_val = max(1, int(len(examples) * VAL_FRACTION))
    val, train = examples[:n_val], examples[n_val:]

    for name, rows in (("farmhand_train.jsonl", train), ("farmhand_val.jsonl", val)):
        with open(HERE / name, "w") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"wrote {name}: {len(rows)} examples")

    multi = sum(1 for e in examples if len(e["messages"]) > 3)
    print(f"total {len(examples)} | multi-turn {multi} | single-turn {len(examples) - multi}")


if __name__ == "__main__":
    main()
