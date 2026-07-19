"""FarmHand preflight self-test. Run this ONCE before the demo; it catches every
config problem on the ground instead of on stage.

  cd ml/freesolo-agent/client && .venv/bin/python selftest.py

Checks, in order, with an actionable fix hint on any failure:
  1. .env present
  2. FREESOLO_API_KEY set and not a masked/truncated paste (the real gotcha)
  3. mode resolved (endpoint vs built-in rules)
  4. trained model reachable and returns the CORRECT action on a known command
  5. graceful fallback works (so a dead endpoint never kills the demo)
  6. hub reachable at SERVER_URL (warning only - hub may start later)

Exit code 0 = safe to demo; 1 = a critical check failed (read the hint).
"""
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import farmhand  # noqa: E402  (auto-loads .env)

G, R, Y, X = "\033[32m", "\033[31m", "\033[33m", "\033[0m"
crit_fail = 0


def ok(m):
    print(f"  {G}PASS{X}  {m}")


def warn(m):
    print(f"  {Y}WARN{X}  {m}")


def fail(m, hint):
    global crit_fail
    crit_fail += 1
    print(f"  {R}FAIL{X}  {m}\n        fix: {hint}")


def main():
    print("FarmHand preflight self-test\n")

    # 1. .env present
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(env_path):
        ok(".env present")
    else:
        warn(".env missing - running in built-in mock mode "
             "(cp .env.example .env and add FREESOLO_API_KEY for the trained model)")

    # 2. API key sanity (catches the masked/truncated paste we actually hit)
    key = os.environ.get("FREESOLO_API_KEY", "")
    url = os.environ.get("FARMHAND_URL", "")
    if url:
        if not key:
            fail("FARMHAND_URL set but FREESOLO_API_KEY empty",
                 "paste the full key into .env (use the dashboard Copy button)")
        elif not key.isascii() or "\u2026" in key or len(key) < 20:
            fail("FREESOLO_API_KEY looks masked/truncated (short or non-ASCII)",
                 "you copied the displayed key, not the real one - use Copy or regenerate")
        else:
            ok(f"FREESOLO_API_KEY looks valid ({key[:3]}...{key[-2:]}, {len(key)} chars)")

    # 3. mode
    mode = f"endpoint {url}" if url else "built-in rules (mock)"
    ok(f"mode: {mode}"
       + ("" if url else "  <- no trained model; NL box still works on rules"))

    # 4. trained model returns the RIGHT action on a known command
    if url:
        t0 = time.time()
        e = farmhand.handle("pick all the ripe apples")
        dt = (time.time() - t0) * 1000
        a = e.get("action")
        want = {"task": "pick", "fruit": "apple", "filter": "ripe", "zone": "any"}
        if e.get("fallback"):
            fail(f"endpoint unreachable, fell back to rules ({e['fallback']})",
                 "check the network / FARMHAND_URL; run `flash deployments` to confirm it is deployed")
        elif a == want:
            ok(f"trained model correct on a known command ({dt:.0f} ms)")
        elif a:
            warn(f"model reachable but gave {a} (expected {want}) - still valid, just check accuracy")
        else:
            fail(f"model reachable but produced no action: {e.get('error') or e.get('clarification')}",
                 "the model may be misconfigured; verify FARMHAND_MODEL is the deployed run-id")

    # 5. fallback safety net
    saved = os.environ.get("FARMHAND_URL"), os.environ.get("FARMHAND_TIMEOUT")
    os.environ["FARMHAND_URL"], os.environ["FARMHAND_TIMEOUT"] = "http://127.0.0.1:1/v1", "1"
    e = farmhand.handle("stop now")
    os.environ["FARMHAND_URL"] = saved[0] or ""
    if saved[1] is not None:
        os.environ["FARMHAND_TIMEOUT"] = saved[1]
    else:
        os.environ.pop("FARMHAND_TIMEOUT", None)
    if e.get("ok") and e.get("action", {}).get("task") == "stop":
        ok("graceful fallback works (dead endpoint -> rules, NL box never dies)")
    else:
        fail("fallback did not recover from a dead endpoint",
             "ensure FARMHAND_FALLBACK is not 0")

    # 6. hub reachable (warning only)
    hub = os.environ.get("SERVER_URL", "http://localhost:3001")
    try:
        urllib.request.urlopen(hub + "/api/health", timeout=2)
        ok(f"hub reachable at {hub}")
    except Exception:
        warn(f"hub not reachable at {hub} yet (fine if you start it with demo.sh) "
             "- set SERVER_URL if it lives elsewhere")

    print()
    if crit_fail:
        print(f"{R}{crit_fail} critical issue(s) - fix before demo.{X}")
        sys.exit(1)
    print(f"{G}All critical checks passed - safe to demo.{X}")


if __name__ == "__main__":
    main()
