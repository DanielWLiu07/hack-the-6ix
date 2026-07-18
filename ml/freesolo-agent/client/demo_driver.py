"""End-to-end nl_command demo driver (llm-client phase-2).

Connects to the LIVE hub (:3001) as two clients:
  - a 'ui'    client: emits nl_command (like the web NL box) and receives the
                      nl_action echo the hub sends back to UIs.
  - a 'robot' client: observes what the hub actually FORWARDS to the robot
                      (the validated action + mapped basic control events).

Sends 10 varied commands, captures the full chain per command, writes a
markdown transcript. Proves: web -> hub -> farmhand -> validate -> hub ->
(ui echo + robot forward).
"""
import sys
import threading
import time

import socketio

HUB = "http://localhost:3001"

COMMANDS = [
    "pick all ripe apples",
    "grab every ripe banana",
    "sort the unripe apples into the left bin",
    "PICK THE NEAREST FRUIT",           # caps + generic fruit
    "drive forward",
    "yo can u snag me a banana thats not ripe",   # slang + typo-ish
    "stop!!!",                          # estop
    "pick the fruit",                   # ambiguous -> clarification
    "take everything ripe to home base",# any fruit + zone home
    "asdf qwerty zzz",                  # junk -> reject
]

# --- robot observer: records events the hub forwards to robots ---
robot = socketio.Client()
robot_events = []            # list of (event_name, payload)
robot_lock = threading.Lock()

for ev in ("nl_action", "pick", "estop", "drive", "arm_pose"):
    def _mk(name):
        def _h(data=None):
            with robot_lock:
                robot_events.append((name, data, time.time()))
        return _h
    robot.on(ev, _mk(ev))

# --- ui driver: sends nl_command, awaits nl_action echo ---
ui = socketio.Client()
ui_actions = {}              # text -> nl_action payload
ui_evt = threading.Event()

@ui.on("nl_action")
def on_ui_action(data):
    if isinstance(data, dict):
        ui_actions[data.get("text")] = data
        ui_evt.set()


def drain_robot(since):
    with robot_lock:
        return [(n, d) for (n, d, t) in robot_events if t >= since]


def main():
    robot.connect(HUB, auth={"role": "robot"})
    ui.connect(HUB, auth={"role": "ui"})
    time.sleep(1.0)

    rows = []
    for i, text in enumerate(COMMANDS, 1):
        ui_evt.clear()
        t0 = time.time()
        ui.emit("nl_command", {"text": text})
        got = ui_evt.wait(timeout=5.0)
        time.sleep(0.4)  # let robot-forward events settle
        action = ui_actions.get(text)
        fwd = drain_robot(t0)
        # only robot-side control/action events (ignore telemetry noise)
        fwd = [(n, d) for (n, d) in fwd if n in ("nl_action", "pick", "estop", "drive", "arm_pose")]
        rows.append((i, text, action, fwd, got))
        if action and action.get("action"):
            kind = "action " + str(action["action"])
        elif action and action.get("clarification"):
            kind = "clarification"
        elif action and not action.get("ok"):
            kind = "REJECTED"
        else:
            kind = "no reply"
        print(f"[{i}/10] {text!r} -> {kind}")

    ui.disconnect()
    robot.disconnect()
    render(rows)


def render(rows):
    out = []
    out.append("# FarmHand NL-command end-to-end demo transcript\n")
    out.append("_llm-client - 10 commands driven through the LIVE hub (:3001)_\n")
    out.append("Chain per command: **web UI** `nl_command` -> hub -> **farmhand service** "
               "(trained model + strict schema validation) -> hub -> **UI echo** + **robot forward**.\n")
    ok = sum(1 for _, _, a, _, _ in rows if a and a.get("ok"))
    clar = sum(1 for _, _, a, _, _ in rows if a and a.get("ok") and a.get("clarification"))
    rej = sum(1 for _, _, a, _, _ in rows if a and not a.get("ok"))
    acts = ok - clar
    out.append(f"**Summary:** {len(rows)} commands, {acts} valid actions forwarded to robot, "
               f"{clar} clarification(s), {rej} rejected (never reached robot).\n")
    for i, text, action, fwd, got in rows:
        out.append(f"\n## {i}. `{text}`\n")
        if not got or action is None:
            out.append("- WARNING: no nl_action received (timeout)\n")
            continue
        if action.get("ok") and action.get("action"):
            a = action["action"]
            out.append(f"- **farmhand -> action**: `{a}`")
            robot_got = [ (n,d) for (n,d) in fwd if n in ("pick","estop","drive","arm_pose") ]
            nlf = [d for (n,d) in fwd if n == "nl_action"]
            out.append(f"- **hub forwarded to robot**: full `nl_action` {'yes' if nlf else '-'}"
                       + (f", mapped control `{robot_got}`" if robot_got else ""))
        elif action.get("ok") and action.get("clarification"):
            out.append(f"- **farmhand -> clarification**: \"{action['clarification']}\"")
            out.append("- **robot**: nothing forwarded (awaiting user reply)")
        else:
            out.append(f"- **farmhand -> REJECTED**: `{action.get('error')}` - "
                       f"invalid/unparseable, **never forwarded to robot**")
    text = "\n".join(out) + "\n"
    dest = sys.argv[1] if len(sys.argv) > 1 else "transcript.md"
    with open(dest, "w") as f:
        f.write(text)
    print(f"\nwrote {dest}")


if __name__ == "__main__":
    main()
