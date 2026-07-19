"""Pick/sort soak test - demo-hardening.

Runs the full SEEK->ALIGN->PICK->SORT->DROP state machine for N cycles against
the mock bridge/camera, spawning a fresh fruit each cycle (all 4 classes), and
reports success stats + stability signals (stalls, tick exceptions, memory
growth) so we know the pipeline survives a multi-hour judging window.

The closed loop needs a detector that sees MockCamera's synthetic frames, so
the *behavioral* soak uses MockDetector. The final exported model
(ml/ripeness/export/model.onnx) can't detect synthetic blobs, so it is
verified separately by --model-check: load via the real loader + an inference
soak (latency + stability), confirming fw-linux consumes the final artifact.

Run:  python -m robot_linux.soak --cycles 100
      python -m robot_linux.soak --cycles 100 --model-check
"""

import argparse
import gc
import statistics
import time
import tracemalloc

import numpy as np

from . import config
from .bridge import MockBridge
from .camera import MockCamera
from .detector import MockDetector
from .poses import PoseStore
from .state_machine import DROP, IDLE, PickStateMachine


def run_soak(cycles=100, speed=20.0, tick_hz=250.0, seed=1, verbose=True,
             navigate=False):
    """Run `cycles` full pick/sort cycles; return a stats dict.

    navigate=True prepends the drive-to-fruit NAV/roam stage each cycle (via a
    MockLidarFeed open field), soak-testing the full autonomy loop
    NAV -> APPROACH -> ALIGN -> PICK -> SORT -> DROP -> NAV.
    """
    bridge = MockBridge()
    cam = MockCamera(bridge, seed=seed)
    det = MockDetector(cam)
    lidar = None
    if navigate:
        from .lidar_mock import MockLidarFeed
        lidar = MockLidarFeed()
    sm = PickStateMachine(bridge, cam, det, PoseStore(), speed=speed, lidar=lidar)
    sm.continuous = True

    picks = []           # each completed pick_event payload
    tick_errors = 0
    stalls = 0
    tick_dt = 1.0 / tick_hz
    # Stall = this many EXECUTED TICKS with no state transition. Counting ticks
    # (not wall-clock) makes this immune to OS descheduling: a soak on a loaded
    # multi-worker box gets frozen for seconds at a time, which inflates any
    # wall-clock metric - but a frozen process executes no ticks, so this
    # counter freezes with it. A healthy state gap is <~150 ticks at speed=20;
    # budget is a generous multiple, scaled by 1/speed (moves shrink with speed).
    stall_ticks = max(800, int(tick_hz * 60.0 / speed))

    since_transition = {"ticks": 0}

    def _on_emit(k, v):
        if k == "pick_event":
            picks.append(v)
        elif k == "state":
            since_transition["ticks"] = 0        # SM made forward progress
    sm.on_emit = _on_emit

    gc.collect()
    tracemalloc.start()
    mem0 = tracemalloc.take_snapshot()
    objs0 = len(gc.get_objects())
    t0 = time.time()

    sm.start("nearest")
    since_transition["ticks"] = 0
    completed = 0
    mem_samples = []
    while completed < cycles:
        try:
            sm.tick()
        except Exception as e:  # never let one bad tick kill the soak
            tick_errors += 1
            if verbose and tick_errors <= 5:
                print(f"[soak] tick error: {e}")
        bridge.heartbeat()
        since_transition["ticks"] += 1

        if len(picks) > completed:          # a cycle finished this tick
            completed = len(picks)
            if completed % 25 == 0:
                gc.collect()
                cur, _ = tracemalloc.get_traced_memory()
                mem_samples.append((completed, cur, len(gc.get_objects())))
                if verbose:
                    print(f"[soak] {completed}/{cycles} cycles  "
                          f"traced={cur/1024:.0f} KiB  objs={len(gc.get_objects())}")

        if since_transition["ticks"] > stall_ticks:
            # no state transition in many executed ticks: SM is wedged. Record a
            # stall + a failed pick and restart cleanly.
            stalls += 1
            picks.append({"fruit": "?", "ripeness": "?", "bin": "STALL",
                          "success": False, "duration_ms": -1})
            completed = len(picks)
            sm.stop()
            sm.start("nearest")
            since_transition["ticks"] = 0
        time.sleep(tick_dt)

    wall = time.time() - t0
    gc.collect()
    mem1 = tracemalloc.take_snapshot()
    objs1 = len(gc.get_objects())
    top = mem1.compare_to(mem0, "lineno")[:3]
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()

    real = [p for p in picks[:cycles] if p.get("bin") != "STALL"]
    successes = sum(1 for p in real if p.get("success"))
    durs = [p["duration_ms"] for p in real if p.get("duration_ms", -1) >= 0]
    by_bin, by_fruit, by_ripe = {}, {}, {}
    for p in real:
        by_bin[p["bin"]] = by_bin.get(p["bin"], 0) + 1
        by_fruit[p["fruit"]] = by_fruit.get(p["fruit"], 0) + 1
        by_ripe[p["ripeness"]] = by_ripe.get(p["ripeness"], 0) + 1

    return {
        "cycles": cycles,
        "completed": len(picks[:cycles]),
        "successes": successes,
        "failures": len(picks[:cycles]) - successes,
        "stalls": stalls,
        "tick_errors": tick_errors,
        "success_rate": round(successes / cycles, 4) if cycles else 0,
        "by_bin": by_bin,
        "by_fruit": by_fruit,
        "by_ripeness": by_ripe,
        "duration_ms": {
            "min": min(durs) if durs else None,
            "median": int(statistics.median(durs)) if durs else None,
            "max": max(durs) if durs else None,
            "mean": int(statistics.mean(durs)) if durs else None,
        },
        "wall_s": round(wall, 1),
        "cycles_per_s": round(cycles / wall, 1) if wall else None,
        "mem": {
            "obj_growth": objs1 - objs0,
            "traced_peak_kib": round(peak / 1024),
            "samples": mem_samples,
            "top_growth": [f"{s.size_diff/1024:+.1f} KiB {s.traceback.format()[-1].strip()}"
                           for s in top],
        },
    }


def model_check(iters=200):
    """Load the FINAL exported model via the real loader + inference soak."""
    from .detector import OnnxDetector
    if not config.MODEL_PATH.exists():
        return {"ok": False, "reason": f"no model at {config.MODEL_PATH}"}
    t0 = time.time()
    det = OnnxDetector()  # fp32 model.onnx (int8 has a conf-saturation bug)
    load_ms = (time.time() - t0) * 1000
    rng = np.random.RandomState(0)
    lat = []
    total_dets = 0
    for _ in range(iters):
        frame = rng.randint(0, 255, (config.FRAME_H, config.FRAME_W, 3), dtype=np.uint8)
        s = time.time()
        d = det.detect(frame)
        lat.append((time.time() - s) * 1000)
        total_dets += len(d)
    return {
        "ok": True,
        "model": str(config.MODEL_PATH.name),
        "classes": det.classes,
        "input_px": det.size,
        "load_ms": round(load_ms, 1),
        "iters": iters,
        "latency_ms": {
            "min": round(min(lat), 1),
            "median": round(statistics.median(lat), 1),
            "max": round(max(lat), 1),
        },
        "fps_median": round(1000 / statistics.median(lat), 1),
        "dets_on_noise": total_dets,
    }


def _print_report(s, mc):
    print("\n" + "=" * 60)
    print("PICK/SORT SOAK RESULTS")
    print("=" * 60)
    print(f"cycles           : {s['completed']}/{s['cycles']}")
    print(f"success_rate     : {s['success_rate']}  "
          f"({s['successes']} ok / {s['failures']} fail)")
    print(f"stalls           : {s['stalls']}")
    print(f"tick_errors      : {s['tick_errors']}")
    print(f"by_bin           : {s['by_bin']}")
    print(f"by_fruit         : {s['by_fruit']}")
    print(f"by_ripeness      : {s['by_ripeness']}")
    print(f"duration_ms      : {s['duration_ms']}")
    print(f"wall / rate      : {s['wall_s']}s  ({s['cycles_per_s']} cycles/s)")
    print(f"mem obj_growth   : {s['mem']['obj_growth']} objects over run")
    print(f"mem traced_peak  : {s['mem']['traced_peak_kib']} KiB")
    for g in s["mem"]["top_growth"]:
        print(f"  top-growth: {g}")
    if mc:
        print("-" * 60)
        print("FINAL MODEL CHECK (loader consumes ml/ripeness/export/model.onnx)")
        if mc["ok"]:
            print(f"  classes={mc['classes']} input={mc['input_px']}px "
                  f"load={mc['load_ms']}ms")
            print(f"  inference {mc['iters']} frames: {mc['latency_ms']} "
                  f"median {mc['fps_median']} FPS")
        else:
            print(f"  SKIPPED: {mc['reason']}")
    print("=" * 60)


def main(argv=None):
    ap = argparse.ArgumentParser(description="pick/sort soak test")
    ap.add_argument("--cycles", type=int, default=100)
    ap.add_argument("--speed", type=float, default=20.0,
                    help="move-duration divisor (higher = faster soak)")
    ap.add_argument("--tick-hz", type=float, default=250.0)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--model-check", action="store_true",
                    help="also load + inference-soak the final ONNX model")
    ap.add_argument("--navigate", action="store_true",
                    help="soak the full drive-to-fruit loop (NAV/roam -> pick), "
                         "not just the stationary SEEK-then-pick loop")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args(argv)

    s = run_soak(cycles=args.cycles, speed=args.speed, tick_hz=args.tick_hz,
                 seed=args.seed, verbose=not args.quiet, navigate=args.navigate)
    mc = model_check() if args.model_check else None
    _print_report(s, mc)
    ok = (s["success_rate"] == 1.0 and s["stalls"] == 0 and s["tick_errors"] == 0
          and len(s["by_bin"]) == len(config.BINS))
    print("SOAK PASS" if ok else "SOAK FAIL - see above")
    return 0 if ok else 1


if __name__ == "__main__":
    import sys
    sys.exit(main())
