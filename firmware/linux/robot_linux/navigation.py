"""APPROACH controller: drive the base toward a detected fruit.

Reactive and vision-only: steer to center the detection bbox horizontally,
creep forward, and stop once the fruit is big enough to be in arm reach (hand
off to ALIGN). No maps, no odometry, no encoders - the MVP that turns a
stationary picking arm into a rover that drives up to the fruit.

Pure functions of the bbox, so the SAME logic runs in sim (MockCamera fakes the
range so the bbox grows as you approach) and on the real board (a real camera
grows the bbox for free). Gains live in config.py - tune in one place.
"""

from . import config
from .servoing import bbox_error


def bbox_area_frac(bbox, frame_w=config.FRAME_W, frame_h=config.FRAME_H):
    """Fraction of the frame the bbox covers, 0..1 (a proxy for closeness)."""
    _, _, w, h = bbox
    return (w * h) / float(frame_w * frame_h)


def in_reach(bbox, frame_w=config.FRAME_W, frame_h=config.FRAME_H):
    """True once the fruit is close enough to stop driving and let the arm pick."""
    return bbox_area_frac(bbox, frame_w, frame_h) >= config.APPROACH_AREA_FRAC


def approach_step(bbox, fwd=config.APPROACH_FWD,
                  turn_gain=config.APPROACH_TURN_GAIN,
                  frame_w=config.FRAME_W, frame_h=config.FRAME_H):
    """One reactive drive command toward the fruit. Returns (l, r) tank, -1..1.

    Creep forward at a constant gentle speed; steer proportionally to the
    horizontal bbox offset (ex > 0 = target right of center). Turning speeds the
    outer wheel via the tank mix. If a real robot steers the wrong way, flip the
    sign of APPROACH_TURN_GAIN (same idea as the motor INVERT flags).
    """
    ex, _ = bbox_error(bbox, frame_w, frame_h)
    turn = turn_gain * ex
    l = _clamp1(fwd + turn)
    r = _clamp1(fwd - turn)
    return l, r


def _clamp1(v):
    return max(-1.0, min(1.0, v))
