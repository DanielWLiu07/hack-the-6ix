"""Visual servoing for ALIGN: center the detection bbox by jogging base/shoulder.

Eye-in-hand: image x error -> base yaw, image y error -> shoulder pitch.
Proportional control with a deadband. Gains/signs are config so hardware
tuning is a two-line change.
"""

from . import config


def bbox_error(bbox, frame_w=config.FRAME_W, frame_h=config.FRAME_H):
    """Normalized error of bbox center from frame center, each in [-1, 1].

    ex > 0: target right of center. ey > 0: target below center.
    """
    x, y, w, h = bbox
    cx = x + w / 2.0
    cy = y + h / 2.0
    ex = (cx - frame_w / 2.0) / (frame_w / 2.0)
    ey = (cy - frame_h / 2.0) / (frame_h / 2.0)
    return ex, ey


def is_centered(bbox, tol=config.ALIGN_TOL_FRAC,
                frame_w=config.FRAME_W, frame_h=config.FRAME_H):
    ex, ey = bbox_error(bbox, frame_w, frame_h)
    return abs(ex) <= tol and abs(ey) <= tol


def servo_step(joints, bbox, gain=config.ALIGN_GAIN_DEG,
               frame_w=config.FRAME_W, frame_h=config.FRAME_H):
    """One proportional jog toward centering bbox. Returns new joint list.

    Only touches base (0) and shoulder (1); leaves elbow/wrist/gripper alone.
    """
    ex, ey = bbox_error(bbox, frame_w, frame_h)
    new = list(joints)
    new[0] = joints[0] + gain * ex   # pan toward target
    new[1] = joints[1] + gain * ey   # tilt toward target
    return config.clamp_joints(new)
