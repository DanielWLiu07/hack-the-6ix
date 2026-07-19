"""NavController: lidar-driven roam + forward-safety gate for autonomy.

This is the OUTER layer of drive-to-fruit autonomy. The rover roams (drives
around, obstacle-safe) while the camera scans; when a fruit is detected the
state machine hands off to the vision APPROACH controller (navigation.py) which
drives up to that fruit, then to ALIGN/PICK. So the division of labor is:

    nav.py            - lidar: WHERE to drive when no fruit is in sight (roam),
                        and WHETHER it's safe to drive forward (the gate).
    navigation.py     - vision: HOW to steer toward a fruit that IS in sight.

Both consume the same tank-drive (l, r) in [-1, 1]. The gate is what makes the
vision approach obstacle-aware: APPROACH still steers by the bbox, but nav's
forward_gate() vetoes/tapers forward translation near an obstacle or when the
lidar feed goes stale.

Safety is fail-safe: the lidar feed returns None / reports stale when it has no
fresh data, and this controller treats "no fresh lidar" as "assume something is
close" -> never command forward translation. Sonar / the MCU watchdog remain the
hard backstop below this soft reflex.

Pure and hardware-free: every method takes a duck-typed lidar feed (anything
exposing is_fresh()/forward_clearance()/sectors()), so it unit-tests against
tiny fakes and runs unchanged against the real LidarFeed TCP client.
"""

from dataclasses import dataclass

from . import config


@dataclass
class NavCommand:
    l: float          # left tank speed, [-1, 1]
    r: float          # right tank speed, [-1, 1]
    mode: str         # "ROAM" | "BLOCKED" | "STALE"
    reason: str       # short human-readable trace for telemetry/logs


def _clamp(v, lo=-1.0, hi=1.0):
    return max(lo, min(hi, v))


class NavController:
    """Roam planner + forward-safety gate. Config-driven so hardware tuning is
    an env export, not a code change."""

    def __init__(self, search=None, turn=None, stop_dist=None, slow_dist=None):
        self.search = config.DRIVE_SEARCH if search is None else search
        self.turn = config.DRIVE_TURN if turn is None else turn
        self.stop_dist = config.NAV_STOP_DIST_M if stop_dist is None else stop_dist
        self.slow_dist = config.NAV_SLOW_DIST_M if slow_dist is None else slow_dist

    # -- forward safety gate -------------------------------------------------

    def forward_gate(self, lidar):
        """Return (allow_forward, speed_scale, reason).

        allow_forward=False means only in-place rotation is permitted this tick.
        speed_scale in [0, 1] tapers forward speed between slow_dist and
        stop_dist. Fail-safe: no fresh lidar -> no forward motion.
        """
        if lidar is None or not lidar.is_fresh():
            return False, 0.0, "lidar_stale"
        clr = lidar.forward_clearance()
        if clr is None:
            # forward cone empty on a fresh scan -> open space ahead
            return True, 1.0, "clear"
        if clr < self.stop_dist:
            return False, 0.0, "obstacle"
        if clr < self.slow_dist:
            span = max(1e-6, self.slow_dist - self.stop_dist)
            return True, _clamp((clr - self.stop_dist) / span, 0.0, 1.0), "slowing"
        return True, 1.0, "clear"

    # -- roam (no fruit in sight) --------------------------------------------

    def _open_bearing(self, lidar):
        """Bearing (deg, 0=fwd +ccw) of the most-open lidar sector, or None."""
        if lidar is None or not lidar.is_fresh():
            return None
        sectors = lidar.sectors()
        if not sectors:
            return None
        best_c, best_score = None, -1.0
        for s in sectors:
            rng = s.get("min")
            score = float("inf") if rng is None else rng   # empty sector = maximally open
            c = ((s.get("c", 0.0) + 180.0) % 360.0) - 180.0  # normalize to [-180, 180], 0=fwd
            if score > best_score:
                best_score, best_c = score, c
        return best_c

    def roam(self, lidar):
        """Drive-around command when nothing is in the camera. Go forward while
        the forward cone is clear; when blocked (or stale), rotate toward the
        most-open sector until forward reopens."""
        allow, scale, reason = self.forward_gate(lidar)
        if allow:
            v = self.search * scale
            return NavCommand(v, v, "ROAM", f"wander fwd {reason}")

        bearing = self._open_bearing(lidar)
        if bearing is None:
            # no lidar / stale: rotate in place to reacquire a clear path
            return NavCommand(-self.turn, self.turn, "STALE", f"rotate-scan {reason}")
        # bearing >= 0 -> open space is to the left -> turn left (l back, r fwd)
        if bearing >= 0:
            return NavCommand(-self.turn, self.turn, "BLOCKED",
                              f"turn-left open@{bearing:.0f} {reason}")
        return NavCommand(self.turn, -self.turn, "BLOCKED",
                          f"turn-right open@{bearing:.0f} {reason}")
