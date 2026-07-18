"""Pure math: polar→cartesian conversion and angular downsampling.

No hardware or network imports - this module is fully unit-testable.

Conventions
-----------
- Lidar measurements arrive as (angle_deg, distance_mm). RPLIDAR angles
  increase CLOCKWISE viewed from above, 0° at the connector/front.
- Robot frame (root CLAUDE.md `lidar_scan` points): meters, x forward,
  y left, right-handed. So a clockwise lidar angle maps to -theta.
"""

import math

# type alias for readability: (angle_deg, distance_mm, quality)
Measurement = tuple


def polar_to_cartesian(
    angle_deg: float,
    distance_m: float,
    angle_offset_deg: float = 0.0,
    ccw: bool = False,
) -> "tuple[float, float]":
    """One lidar return → (x, y) meters in the robot frame.

    ccw=False (normal RPLIDAR mount): angle increases clockwise, so the
    robot-frame angle is the negation of the lidar angle.
    """
    theta = math.radians(angle_deg + angle_offset_deg)
    if not ccw:
        theta = -theta
    return (distance_m * math.cos(theta), distance_m * math.sin(theta))


def filter_ranges(
    measurements: "list[tuple[float, float]]",
    min_range_m: float,
    max_range_m: float,
) -> "list[tuple[float, float]]":
    """Drop (angle_deg, distance_m) returns outside [min, max] or non-finite."""
    out = []
    for angle, dist in measurements:
        if not (math.isfinite(angle) and math.isfinite(dist)):
            continue
        if min_range_m <= dist <= max_range_m:
            out.append((angle, dist))
    return out


def downsample_by_angle(
    measurements: "list[tuple[float, float]]",
    max_points: int = 360,
) -> "list[tuple[float, float]]":
    """Reduce a scan to ≤max_points by binning on angle.

    One bin per (360/max_points)°; keep the NEAREST return per bin
    (nearest obstacle is what matters for a map). Output sorted by angle.
    """
    if max_points <= 0:
        return []
    bin_width = 360.0 / max_points
    bins: "dict[int, tuple[float, float]]" = {}
    for angle, dist in measurements:
        idx = int((angle % 360.0) / bin_width)
        # angle % 360 < 360 guarantees idx < max_points, but guard float edge
        if idx >= max_points:
            idx = max_points - 1
        best = bins.get(idx)
        if best is None or dist < best[1]:
            bins[idx] = (angle % 360.0, dist)
    return [bins[k] for k in sorted(bins)]


def scan_to_points(
    measurements: "list[tuple[float, float]]",
    max_points: int = 360,
    min_range_m: float = 0.10,
    max_range_m: float = 12.0,
    angle_offset_deg: float = 0.0,
    ccw: bool = False,
) -> "list[list[float]]":
    """Full pipeline: (angle_deg, distance_m) list → [[x, y], ...] payload.

    Filters bad ranges, downsamples to ≤max_points, converts to robot-frame
    cartesian meters rounded to mm precision (keeps JSON payloads small).
    """
    kept = filter_ranges(measurements, min_range_m, max_range_m)
    kept = downsample_by_angle(kept, max_points)
    points = []
    for angle, dist in kept:
        x, y = polar_to_cartesian(angle, dist, angle_offset_deg, ccw)
        points.append([round(x, 3), round(y, 3)])
    return points
