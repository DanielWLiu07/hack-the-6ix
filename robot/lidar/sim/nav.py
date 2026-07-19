#!/usr/bin/env python3
"""Grid path planner for the SLAM navigation demo.

Plans a route from the robot's current pose to an operator-declared goal over
the live log-odds occupancy grid (occupancy.OccupancyGrid.to_uint8(): 0=free,
100=occupied, 255=unknown). 8-connected A* with obstacle inflation so the path
keeps clear of walls, then line-of-sight smoothing so the polyline reads clean
on the map. Falls back to a straight line if A* can't reach the goal (e.g. the
goal sits in unmapped space). Numpy only.

    plan_path(occ_uint8, origin_xy, res, start_xy, goal_xy) -> [[x, y], ...]

Returned points are world meters (SLAM frame), start -> goal inclusive.
"""

import heapq
import math

import numpy as np

OCC = 100
UNKNOWN = 255

# Cost per traversed cell by class. Unknown is passable but pricier than free so
# the planner prefers mapped corridors yet can still reach a goal past the
# frontier (a scanned room is never fully known).
COST_FREE = 1.0
COST_UNKNOWN = 2.6
INFLATE = 1              # obstacle dilation radius in cells (~robot half-width)


def _to_cell(x, y, origin, res):
    return (int(math.floor((x - origin[0]) / res)),
            int(math.floor((y - origin[1]) / res)))


def _to_world(ix, iy, origin, res):
    return [round(origin[0] + (ix + 0.5) * res, 3),
            round(origin[1] + (iy + 0.5) * res, 3)]


def _inflate(blocked, r):
    if r <= 0:
        return blocked
    out = blocked.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            out |= np.roll(np.roll(blocked, dy, axis=0), dx, axis=1)
    return out


def _nearest_open(blocked, ix, iy):
    """Snap (ix,iy) to the closest non-blocked cell (spiral search)."""
    h, w = blocked.shape
    ix = min(max(ix, 0), w - 1)
    iy = min(max(iy, 0), h - 1)
    if not blocked[iy, ix]:
        return ix, iy
    for rad in range(1, max(h, w)):
        for dy in range(-rad, rad + 1):
            for dx in range(-rad, rad + 1):
                if max(abs(dx), abs(dy)) != rad:
                    continue
                nx, ny = ix + dx, iy + dy
                if 0 <= nx < w and 0 <= ny < h and not blocked[ny, nx]:
                    return nx, ny
    return ix, iy


def _line_clear(blocked, a, b):
    """Bresenham line-of-sight: True if no blocked cell between cells a and b."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = abs(x1 - x0), abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx - dy
    while True:
        if blocked[y0, x0]:
            return False
        if x0 == x1 and y0 == y1:
            return True
        e2 = 2 * err
        if e2 > -dy:
            err -= dy
            x0 += sx
        if e2 < dx:
            err += dx
            y0 += sy


def _smooth(cells, blocked):
    """Drop intermediate cells the robot can reach in a straight line."""
    if len(cells) <= 2:
        return cells
    out = [cells[0]]
    i = 0
    while i < len(cells) - 1:
        j = len(cells) - 1
        while j > i + 1 and not _line_clear(blocked, cells[i], cells[j]):
            j -= 1
        out.append(cells[j])
        i = j
    return out


def plan_path(occ, origin, res, start_xy, goal_xy, inflate=INFLATE):
    """A* over the occupancy grid. Returns world-meter waypoints start->goal."""
    occ = np.asarray(occ)
    h, w = occ.shape
    blocked = _inflate(occ == OCC, inflate)
    cost = np.where(occ == UNKNOWN, COST_UNKNOWN, COST_FREE).astype(np.float32)

    sx, sy = _to_cell(start_xy[0], start_xy[1], origin, res)
    gx0, gy0 = _to_cell(goal_xy[0], goal_xy[1], origin, res)
    sx, sy = _nearest_open(blocked, sx, sy)
    gx, gy = _nearest_open(blocked, gx0, gy0)
    # If the clicked cell itself is drivable, finish at the EXACT click (not the
    # snapped cell centre) so the robot arrives where the operator pointed.
    h_, w_ = blocked.shape
    goal_open = (0 <= gx0 < w_ and 0 <= gy0 < h_ and not blocked[gy0, gx0])
    end_world = list(goal_xy) if goal_open else _to_world(gx, gy, origin, res)

    start, goal = (sx, sy), (gx, gy)
    if start == goal:
        return [list(start_xy), end_world]

    # 8-connected A*
    nbrs = [(-1, 0, 1.0), (1, 0, 1.0), (0, -1, 1.0), (0, 1, 1.0),
            (-1, -1, 1.4142), (1, -1, 1.4142), (-1, 1, 1.4142), (1, 1, 1.4142)]

    def hcost(a, b):
        return math.hypot(a[0] - b[0], a[1] - b[1])

    openq = [(hcost(start, goal), 0.0, start)]
    came = {}
    gscore = {start: 0.0}
    seen = set()
    found = False
    while openq:
        _, g, cur = heapq.heappop(openq)
        if cur in seen:
            continue
        seen.add(cur)
        if cur == goal:
            found = True
            break
        cx, cy = cur
        for dx, dy, step in nbrs:
            nx, ny = cx + dx, cy + dy
            if nx < 0 or nx >= w or ny < 0 or ny >= h or blocked[ny, nx]:
                continue
            ng = g + step * float(cost[ny, nx])
            nb = (nx, ny)
            if ng < gscore.get(nb, float('inf')):
                gscore[nb] = ng
                came[nb] = cur
                heapq.heappush(openq, (ng + hcost(nb, goal), ng, nb))

    if not found:
        # Unreachable on the current map: straight shot toward the click. SLAM
        # keeps mapping as it drives, so the operator sees intent immediately.
        return [list(start_xy), list(goal_xy)]

    cells = [goal]
    while cells[-1] != start:
        cells.append(came[cells[-1]])
    cells.reverse()
    cells = _smooth(cells, blocked)

    path = [list(start_xy)] + [_to_world(ix, iy, origin, res) for ix, iy in cells[1:]]
    path[-1] = end_world   # finish exactly at the clicked point when reachable
    return path
