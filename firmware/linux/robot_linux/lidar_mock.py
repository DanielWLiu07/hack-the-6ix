"""MockLidarFeed: a LidarFeed-shaped obstacle summary for sim / tests.

Mirrors the real LidarFeed accessor surface (is_fresh / forward_clearance /
sectors / nearest / pose / start / stop) so NavController and the state machine
can't tell it apart from the Pi TCP feed. Open field by default (forward cone
clear); the setters drive the reflex / stale tests.
"""


class MockLidarFeed:
    def __init__(self, forward_clearance=None, n_sectors=12):
        self._fresh = True
        self._fwd = forward_clearance          # None == forward cone empty (clear)
        self._sectors = [{"c": round(i * 360.0 / n_sectors, 1), "min": None}
                         for i in range(n_sectors)]
        self._nearest = None
        self._pose = None

    # setters (tests / scripted sim)
    def set_stale(self, stale=True):
        self._fresh = not stale

    def set_forward_clearance(self, m):
        self._fwd = m

    def set_sectors(self, sectors):
        self._sectors = sectors

    # LidarFeed accessor surface
    def is_fresh(self):
        return self._fresh

    def forward_clearance(self):
        return self._fwd

    def sectors(self):
        return self._sectors

    def nearest(self):
        return self._nearest

    def pose(self):
        return self._pose

    def start(self):
        return self

    def stop(self):
        pass
