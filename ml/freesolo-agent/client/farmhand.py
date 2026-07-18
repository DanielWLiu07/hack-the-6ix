"""FarmHand NL-command client.

Takes natural-language text (the `nl_command` Socket.IO event payload), turns it
into a structured robot action, and STRICTLY validates it before anything is
forwarded to the robot. Raw LLM output never reaches the robot.

Modes (picked automatically):
  - FARMHAND_URL set   -> POST the text to the teammate's trained model endpoint
  - FARMHAND_URL unset -> built-in regex rules (works today, no network)

Action schema (matches root CLAUDE.md + llm-data's dataset spec, see
status/llm-data.md 22:12 — validated output always carries all 4 keys):
  {"task": "pick|sort|stop|drive", "fruit": "apple|banana|any",
   "filter": "ripe|unripe|any", "zone": "any|left|right|forward|backward|home"}

Public API:
  handle(text) -> envelope dict:
    {"ts": ..., "text": ..., "ok": True,  "action": {...}}
    {"ts": ..., "text": ..., "ok": True,  "clarification": "..."}
    {"ts": ..., "text": ..., "ok": False, "error": "<reason>"}

CLI:
  python3 farmhand.py "pick all ripe apples"
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

TASKS = {"pick", "sort", "stop", "drive"}
FRUITS = {"apple", "banana", "any"}
FILTERS = {"ripe", "unripe", "any"}
ZONES = {"any", "left", "right", "forward", "backward", "home"}
ALLOWED_KEYS = {"task", "fruit", "filter", "zone"}
MAX_CLARIFICATION_LEN = 200


# ---------------------------------------------------------------- validation

def validate_action(obj):
    """Return (action_dict, None) if valid, else (None, error_string).

    Strict: unknown keys, wrong types, or out-of-enum values are rejected.
    Missing fruit/filter/zone default to "any"; output always has all 4 keys.
    """
    if not isinstance(obj, dict):
        return None, "action is not an object"
    extra = set(obj) - ALLOWED_KEYS
    if extra:
        return None, "unknown keys: %s" % ",".join(sorted(extra))
    task = obj.get("task")
    if task not in TASKS:
        return None, "invalid task: %r" % (task,)
    fruit = obj.get("fruit", "any")
    if fruit not in FRUITS:
        return None, "invalid fruit: %r" % (fruit,)
    filt = obj.get("filter", "any")
    if filt not in FILTERS:
        return None, "invalid filter: %r" % (filt,)
    zone = obj.get("zone", "any")
    if zone not in ZONES:
        return None, "invalid zone: %r" % (zone,)
    return {"task": task, "fruit": fruit, "filter": filt, "zone": zone}, None


def _normalize_model_output(obj):
    """Model may answer with an action or a clarification question.

    Accepted shapes:  {...action...}
                      {"clarify": "q"} / {"clarification": "q"} / {"question": "q"}
                      {"action": {...}} wrapper
    Returns ("action", dict) | ("clarification", str) | (None, error_str).
    """
    if isinstance(obj, dict):
        for key in ("clarify", "clarification", "question"):
            if key in obj and isinstance(obj[key], str) and obj[key].strip():
                return "clarification", obj[key].strip()[:MAX_CLARIFICATION_LEN]
        if "action" in obj and isinstance(obj["action"], dict):
            obj = obj["action"]
    action, err = validate_action(obj)
    if err:
        return None, err
    return "action", action


# ---------------------------------------------------------------- mock model

_WORD = lambda w: r"\b" + w + r"\b"
_RE_STOP = re.compile(r"\b(stop|halt|freeze|e-?stop|abort|cancel|stand\s*down)\b", re.I)
_RE_DRIVE = re.compile(r"\b(drive|go|move|forward|backward|roam|explore|patrol)\b", re.I)
_RE_PICK = re.compile(r"\b(pick|grab|get|harvest|collect|fetch|take|snag)\b", re.I)
_RE_SORT = re.compile(r"\b(sort|organi[sz]e|bin)\b", re.I)
_RE_APPLE = re.compile(r"\bapp?les?\b", re.I)
_RE_BANANA = re.compile(r"\b(bananas?|nanas?)\b", re.I)
_RE_ANY_FRUIT = re.compile(r"\b(both|everything|all (of )?(the )?fruits?|any(thing)?)\b", re.I)
_RE_UNRIPE = re.compile(r"\b(unripe|not\s+ripe|green|raw|unready)\b", re.I)
_RE_RIPE = re.compile(r"\bripe\b", re.I)
_ZONE_RES = [
    ("home", re.compile(r"\b(home|base|dock)\b", re.I)),
    ("backward", re.compile(r"\b(back(ward)?s?|reverse)\b", re.I)),
    ("forward", re.compile(r"\b(forwards?|ahead|straight)\b", re.I)),
    ("left", re.compile(r"\bleft\b", re.I)),
    ("right", re.compile(r"\bright\b", re.I)),
]


def _mock_zone(t):
    for zone, rx in _ZONE_RES:
        if rx.search(t):
            return zone
    return "any"


def mock_model(text):
    """Deterministic rule-based stand-in for the teammate's model.

    Returns a JSON string (like the real endpoint would), so the exact same
    validation path is exercised in mock mode.
    """
    t = text.strip()
    if _RE_STOP.search(t):
        return json.dumps({"task": "stop"})

    fruit = None
    if _RE_APPLE.search(t) and _RE_BANANA.search(t):
        fruit = "any"
    elif _RE_APPLE.search(t):
        fruit = "apple"
    elif _RE_BANANA.search(t):
        fruit = "banana"
    elif _RE_ANY_FRUIT.search(t):
        fruit = "any"

    if _RE_UNRIPE.search(t):
        filt = "unripe"
    elif _RE_RIPE.search(t):
        filt = "ripe"
    else:
        filt = "any"

    if _RE_PICK.search(t):
        task = "pick"
    elif _RE_SORT.search(t):
        task = "sort"
    elif _RE_DRIVE.search(t):
        return json.dumps({"task": "drive", "zone": _mock_zone(t)})
    else:
        return json.dumps(
            {"clarify": "I can pick, sort, drive, or stop — what would you like?"}
        )

    if fruit is None:
        return json.dumps({"clarify": "Which fruit — apples, bananas, or both?"})
    return json.dumps(
        {"task": task, "fruit": fruit, "filter": filt, "zone": _mock_zone(t)}
    )


# ------------------------------------------------------------ endpoint model

def endpoint_model(text, url, timeout=None):
    """POST {"text": ...} to the teammate's model endpoint, return raw body str.

    Input format is a guess until the teammate confirms (see ../NOTES.md);
    adjust here in ONE place when they answer.
    """
    timeout = timeout or float(os.environ.get("FARMHAND_TIMEOUT", "5"))
    req = urllib.request.Request(
        url,
        data=json.dumps({"text": text}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    api_key = os.environ.get("FARMHAND_API_KEY")
    if api_key:
        req.add_header("Authorization", "Bearer " + api_key)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


_JSON_OBJ = re.compile(r"\{.*\}", re.S)


def parse_model_body(body):
    """Best-effort: get the action/clarification JSON object out of a response body.

    Handles: a bare JSON object; common {"output"/"response"/"completion"/"text"/
    "content": "..."} wrappers (possibly with the JSON embedded in prose); or a
    JSON object embedded in a plain-text body. Returns a dict or None.
    """
    def _first_obj(s):
        m = _JSON_OBJ.search(s)
        if not m:
            return None
        try:
            obj = json.loads(m.group(0))
            return obj if isinstance(obj, dict) else None
        except ValueError:
            return None

    try:
        obj = json.loads(body)
    except ValueError:
        return _first_obj(body)
    if isinstance(obj, dict):
        for key in ("output", "response", "completion", "text", "content", "answer"):
            inner = obj.get(key)
            if isinstance(inner, str):
                found = _first_obj(inner)
                if found is not None:
                    return found
        return obj
    if isinstance(obj, str):
        return _first_obj(obj)
    return None


# -------------------------------------------------------------------- public

def handle(text, url=None):
    """text -> envelope dict (see module docstring). Never raises."""
    ts = int(time.time() * 1000)
    env = {"ts": ts, "text": text}
    if not isinstance(text, str) or not text.strip():
        env.update(ok=False, error="empty command")
        return env
    text = text.strip()[:500]
    env["text"] = text

    url = url if url is not None else os.environ.get("FARMHAND_URL", "")
    if url:
        try:
            body = endpoint_model(text, url)
        except (urllib.error.URLError, OSError, ValueError) as e:
            env.update(ok=False, error="endpoint error: %s" % e)
            return env
        obj = parse_model_body(body)
        if obj is None:
            env.update(ok=False, error="invalid_model_output: no JSON object in response")
            return env
    else:
        obj = json.loads(mock_model(text))
        env["mock"] = True

    kind, payload = _normalize_model_output(obj)
    if kind == "action":
        env.update(ok=True, action=payload)
    elif kind == "clarification":
        env.update(ok=True, clarification=payload)
    else:
        env.update(ok=False, error="invalid_model_output: %s" % payload)
    return env


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    print(json.dumps(handle(" ".join(sys.argv[1:])), indent=2))
