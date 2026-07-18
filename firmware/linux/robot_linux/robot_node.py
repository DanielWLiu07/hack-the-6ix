"""Robot node: the fw-linux runtime that ties everything together.

Wires MCU bridge + camera + detector + pick/sort state machine to the laptop
Socket.IO hub (server-core). It:

  * connects to SERVER_URL with handshake ``auth={"role": "robot"}``
  * runs the state-machine tick at config.TICK_HZ
  * heartbeats the MCU bridge at config.HEARTBEAT_HZ (feeds the 500 ms watchdog)
  * emits ``telemetry`` at config.TELEMETRY_HZ and forwards ``detection`` /
    ``pick_event`` as the state machine produces them (root-CLAUDE.md schemas)
  * handles inbound control events ``drive`` / ``arm_pose`` / ``pick`` /
    ``estop`` and the richer ``nl_action`` from llm-client

Bridge timeout/DOWN handling follows firmware/BRIDGE.md §3: a failing bridge
call marks the bridge DOWN, telemetry state pins to "ESTOP", motion commands
are dropped, and heartbeat retries at 1 Hz until the bridge answers again.

Run (sim, no hardware):   python -m robot_linux.robot_node --sim --autostart
Run (real UNO Q bridge):  python -m robot_linux.robot_node
"""

import argparse
import sys
import threading
import time

import socketio

from . import config
from .camera import CVCamera, MockCamera
from .detector import load_detector
from .poses import PoseStore
from .state_machine import ESTOP, IDLE, PickStateMachine

# Demo command modes:
#   "auto"  - autonomous: continuously SEEK/PICK/SORT on its own (autostart).
#   "await" - await-command: sit IDLE until a command (nl_action/pick) arrives,
#             run exactly that one command, return to IDLE. On stage this makes
#             a spoken command visibly drive the robot (the autonomous cycle no
#             longer masks causation). Toggle live via the hub `set_mode` event.
AUTO, AWAIT = "auto", "await"


def _norm_mode(mode):
    return AWAIT if str(mode).lower() in (AWAIT, "await_command", "idle", "wait") else AUTO


class RobotNode:
    def __init__(self, bridge, camera, detector, poses, server_url,
                 command_mode=AWAIT):
        self.bridge = bridge
        self.server_url = server_url
        self.command_mode = _norm_mode(command_mode)

        self.sio = socketio.Client(
            reconnection=True, reconnection_delay=1, reconnection_delay_max=5)
        self._lock = threading.RLock()   # guards sm + bridge command path
        self._stop = threading.Event()

        # bridge health (BRIDGE.md §3)
        self.bridge_up = True
        self._fail_streak = 0
        self._last_hb_attempt = 0.0

        self.sm = PickStateMachine(
            bridge, camera, detector, poses, on_emit=self._on_emit)
        self._register_handlers()

    # emit path

    def _on_emit(self, kind, payload):
        """State-machine callback. Forwards detections/picks to the hub."""
        if kind in ("detection", "pick_event"):
            self._emit(kind, payload)
        # "state" is carried by telemetry every tick, no separate emit needed

    def _emit(self, event, payload):
        if self.sio.connected:
            try:
                self.sio.emit(event, payload)
            except Exception as e:  # never let a socket hiccup kill the loop
                print(f"[node] emit {event} failed: {e}")

    def _telemetry(self):
        with self._lock:
            joints = self.bridge.get_joints()
            drive = self.bridge.get_drive()
            state = ESTOP if not self.bridge_up else self.sm.state
            # MCU-latched ESTOP (real bridge) always wins over task state
            if hasattr(self.bridge, "mcu_state") and self.bridge.mcu_state() == 3:
                state = ESTOP
            battery = self.bridge.battery_v()
        return {
            "ts": int(time.time() * 1000),
            "battery_v": battery,
            "state": state,
            "arm": [int(round(j)) for j in joints],
            "drive": {"l": round(drive["l"], 3), "r": round(drive["r"], 3)},
        }

    # bridge health

    def _heartbeat(self):
        """Beat the MCU watchdog; track DOWN/UP per BRIDGE.md §3."""
        try:
            self.bridge.heartbeat()
            if not self.bridge_up:
                print("[node] bridge back UP")
            self.bridge_up = True
            self._fail_streak = 0
        except Exception as e:
            self._fail_streak += 1
            if self.bridge_up and self._fail_streak >= 2:
                self.bridge_up = False
                print(f"[node] bridge DOWN ({e}); pinning telemetry ESTOP, "
                      "dropping motion until it answers")

    # control loop

    def _loop(self):
        tick_dt = 1.0 / config.TICK_HZ
        hb_every = max(1, round(config.TICK_HZ / config.HEARTBEAT_HZ))
        tel_every = max(1, round(config.TICK_HZ / config.TELEMETRY_HZ))
        i = 0
        next_t = time.monotonic()
        while not self._stop.is_set():
            i += 1
            # heartbeat: 1 Hz while DOWN, else HEARTBEAT_HZ
            if not self.bridge_up:
                if time.monotonic() - self._last_hb_attempt >= 1.0:
                    self._last_hb_attempt = time.monotonic()
                    self._heartbeat()
            elif i % hb_every == 0:
                self._heartbeat()

            # only tick motion logic while the bridge is healthy
            if self.bridge_up:
                with self._lock:
                    try:
                        self.sm.tick()
                    except Exception as e:
                        print(f"[node] tick error: {e}")

            if i % tel_every == 0:
                self._emit("telemetry", self._telemetry())

            next_t += tick_dt
            sleep = next_t - time.monotonic()
            if sleep > 0:
                self._stop.wait(sleep)
            else:
                next_t = time.monotonic()  # fell behind; resync

    # handlers

    def _register_handlers(self):
        sio = self.sio

        @sio.event
        def connect():
            print(f"[node] connected to {self.server_url} as robot")
            self._apply_mode(self.command_mode, announce=True)

        @sio.event
        def disconnect():
            print("[node] disconnected from hub")

        @sio.on("drive")
        def on_drive(data):
            if not self.bridge_up:
                return
            try:
                l, r = float(data.get("l", 0)), float(data.get("r", 0))
            except (AttributeError, TypeError, ValueError):
                return
            with self._lock:
                self.bridge.set_drive(l, r)

        @sio.on("arm_pose")
        def on_arm_pose(data):
            if not self.bridge_up:
                return
            joints = (data or {}).get("joints")
            if not joints:
                return
            with self._lock:
                self.bridge.move_servos(config.clamp_joints(joints), 400)

        @sio.on("pick")
        def on_pick(data):
            # server-core maps nl_action -> pick; ignore that echo so we don't
            # abort an nl-initiated pick (see on_nl_action debounce).
            if self._recent_nl():
                return
            target = (data or {}).get("target", "nearest")
            with self._lock:
                self._present_mock_fruit(fruit=target)
                # await: one pick then idle. auto: retarget ongoing picking.
                self.sm.continuous = (self.command_mode == AUTO)
                self.sm.start(target)

        @sio.on("estop")
        def on_estop(_data=None):
            with self._lock:
                self.sm.estop()
            print("[node] ESTOP")

        @sio.on("set_mode")
        def on_set_mode(data):
            """Live demo-mode toggle from the hub.

            server-core's contract (index.js) is `set_mode {autostart: bool}`:
            autostart=false pauses autonomy (await-command), true resumes
            autonomous picking. The hub also replays the last set_mode to a
            robot on connect, so a mid-demo toggle survives a robot reconnect.
            """
            autostart = bool((data or {}).get("autostart", True))
            self._apply_mode(AUTO if autostart else AWAIT, announce=True)

        @sio.on("nl_action")
        def on_nl_action(data):
            """Rich structured command from llm-client (carries ripeness)."""
            if not data or not data.get("ok"):
                return
            action = data.get("action") or {}
            self._last_nl = time.monotonic()
            task = action.get("task")
            with self._lock:
                if task in ("stop",):
                    self.sm.estop()
                elif task in ("pick", "sort"):
                    fruit = action.get("fruit")
                    filt = action.get("filter")
                    tgt = {}
                    if fruit and fruit != "any":
                        tgt["fruit"] = fruit
                    if filt and filt != "any":
                        tgt["ripeness"] = filt
                    self._present_mock_fruit(fruit=fruit, ripeness=filt)
                    # await: one pick then idle. auto: retarget ongoing picking.
                    self.sm.continuous = (self.command_mode == AUTO)
                    self.sm.start(tgt or "nearest")
            print(f"[node] nl_action {task} {action.get('fruit')}/{action.get('filter')} "
                  f"[mode={self.command_mode}]")

    _last_nl = 0.0

    def _recent_nl(self, window=0.75):
        return (time.monotonic() - self._last_nl) < window

    def _present_mock_fruit(self, fruit=None, ripeness=None):
        """Sim only: place the requested fruit in the mock scene so a filtered
        command has a matching target (as if the operator presented it). No-op
        on real hardware (real camera sees whatever fruit is physically there).
        Only presents when a specific fruit/ripeness is asked for; a plain
        "nearest" command uses whatever is already in view.
        """
        cam = self.sm.camera
        f = fruit if fruit not in (None, "any", "nearest") else None
        r = ripeness if ripeness not in (None, "any") else None
        if (f or r) and hasattr(cam, "spawn_fruit"):
            cam.spawn_fruit(fruit=f, ripeness=r,
                            near_joints=self.sm.poses.get("home"))

    def _apply_mode(self, mode, announce=False):
        """Set the demo command mode and reconcile the state machine."""
        mode = _norm_mode(mode)
        with self._lock:
            self.command_mode = mode
            if self.sm.state == ESTOP:
                pass  # never override a latched estop; mode applies after clear
            elif mode == AUTO:
                self.sm.continuous = True
                if self.sm.state == IDLE:
                    self.sm.start("nearest")
            else:  # AWAIT: drop whatever it was doing and wait for a command
                self.sm.continuous = False
                self.sm.stop()
        if announce:
            msg = ("autonomous picking" if mode == AUTO
                   else "await-command (idling until a command arrives)")
            print(f"[node] command mode -> {mode}: {msg}")

    # run

    def run(self):
        loop = threading.Thread(target=self._loop, name="control", daemon=True)
        loop.start()
        try:
            self.sio.connect(self.server_url, auth={"role": "robot"},
                             wait_timeout=10)
        except Exception as e:
            print(f"[node] could not connect to {self.server_url}: {e}\n"
                  "       running headless (control loop only, no telemetry).")
        try:
            while not self._stop.is_set():
                time.sleep(0.2)
        except KeyboardInterrupt:
            pass
        finally:
            self._stop.set()
            if self.sio.connected:
                self.sio.disconnect()
            loop.join(timeout=2)


def build(args):
    if args.sim:
        from .bridge import MockBridge
        bridge = MockBridge()
    else:
        try:
            from .bridge import AppLabBridge
            bridge = AppLabBridge()
        except RuntimeError as e:
            print(f"{e}\nFalling back to --sim.")
            from .bridge import MockBridge
            bridge = MockBridge()

    from .bridge import MockBridge as _Mock
    if isinstance(bridge, _Mock):
        camera = MockCamera(bridge, seed=args.seed)
    else:
        try:
            camera = CVCamera()
        except Exception as e:
            print(f"[node] camera open failed ({e}); using MockCamera")
            camera = MockCamera(bridge, seed=args.seed)

    if args.sim and not args.real_detector:
        # Pure-sim demo: the real ONNX/HSV models see nothing in MockCamera's
        # synthetic blobs, so drive the pipeline off MockCamera ground truth.
        from .detector import MockDetector
        detector = MockDetector(camera)
        print("[detector] using MockDetector (synthetic ground truth)")
    else:
        detector = load_detector(
            mock_camera=camera if isinstance(camera, MockCamera) else None)
    poses = PoseStore()
    # --await-command forces the await demo mode; --autostart is autonomous;
    # default is await (robot idle until commanded) - a safe stage default.
    if getattr(args, "await_command", False):
        mode = AWAIT
    elif args.autostart:
        mode = AUTO
    else:
        mode = AWAIT
    return RobotNode(bridge, camera, detector, poses, args.server,
                     command_mode=mode)


def main(argv=None):
    ap = argparse.ArgumentParser(description="fw-linux robot node")
    ap.add_argument("--sim", action="store_true",
                    help="use MockBridge + MockCamera (no hardware)")
    ap.add_argument("--server", default=config.SERVER_URL,
                    help="Socket.IO hub URL (default env SERVER_URL)")
    ap.add_argument("--autostart", action="store_true",
                    help="autonomous mode: begin continuous picking on connect")
    ap.add_argument("--await-command", dest="await_command", action="store_true",
                    help="await-command demo mode: idle until an nl_action/pick "
                         "arrives, run one command, return to idle")
    ap.add_argument("--real-detector", action="store_true",
                    help="in --sim, still load ONNX/HSV instead of MockDetector")
    ap.add_argument("--seed", type=int, default=None, help="MockCamera RNG seed")
    args = ap.parse_args(argv)
    node = build(args)
    print(f"[node] server={args.server} sim={args.sim} mode={node.command_mode}")
    node.run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
