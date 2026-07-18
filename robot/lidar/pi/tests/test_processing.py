import math

import pytest

from lidar_node.processing import (
    downsample_by_angle,
    filter_ranges,
    polar_to_cartesian,
    scan_to_points,
)


class TestPolarToCartesian:
    def test_forward(self):
        x, y = polar_to_cartesian(0.0, 2.0)
        assert x == pytest.approx(2.0)
        assert y == pytest.approx(0.0)

    def test_clockwise_90_is_robot_right(self):
        # RPLIDAR 90° (clockwise) = robot's right side = -y in x-fwd/y-left frame
        x, y = polar_to_cartesian(90.0, 1.0)
        assert x == pytest.approx(0.0, abs=1e-9)
        assert y == pytest.approx(-1.0)

    def test_ccw_flag_flips_y(self):
        x, y = polar_to_cartesian(90.0, 1.0, ccw=True)
        assert y == pytest.approx(1.0)

    def test_angle_offset(self):
        # lidar mounted backwards: offset 180 makes lidar-0° point behind
        x, y = polar_to_cartesian(0.0, 1.0, angle_offset_deg=180.0)
        assert x == pytest.approx(-1.0)
        assert y == pytest.approx(0.0, abs=1e-9)

    def test_distance_preserved(self):
        for ang in range(0, 360, 15):
            x, y = polar_to_cartesian(float(ang), 3.5)
            assert math.hypot(x, y) == pytest.approx(3.5)


class TestFilterRanges:
    def test_drops_out_of_range(self):
        m = [(0.0, 0.05), (10.0, 1.0), (20.0, 15.0)]
        assert filter_ranges(m, 0.1, 12.0) == [(10.0, 1.0)]

    def test_drops_nan_inf(self):
        m = [(0.0, float("nan")), (float("inf"), 1.0), (5.0, 2.0)]
        assert filter_ranges(m, 0.1, 12.0) == [(5.0, 2.0)]

    def test_bounds_inclusive(self):
        m = [(0.0, 0.1), (1.0, 12.0)]
        assert filter_ranges(m, 0.1, 12.0) == m


class TestDownsample:
    def test_caps_point_count(self):
        # 720 measurements at 0.5° spacing → ≤360 out
        dense = [(i * 0.5, 1.0) for i in range(720)]
        out = downsample_by_angle(dense, 360)
        assert len(out) <= 360

    def test_keeps_nearest_per_bin(self):
        # two returns in the same 1° bin: keep the closer one
        out = downsample_by_angle([(10.2, 5.0), (10.7, 2.0)], 360)
        assert out == [(10.7, 2.0)]

    def test_sparse_scan_passes_through(self):
        sparse = [(0.0, 1.0), (90.0, 2.0), (180.0, 3.0)]
        out = downsample_by_angle(sparse, 360)
        assert len(out) == 3

    def test_sorted_by_angle(self):
        out = downsample_by_angle([(350.0, 1.0), (10.0, 1.0), (180.0, 1.0)], 360)
        angles = [a for a, _ in out]
        assert angles == sorted(angles)

    def test_angle_wraparound(self):
        # 360.4° lands in the same bin as 0.4°
        out = downsample_by_angle([(360.4, 2.0), (0.4, 1.0)], 360)
        assert out == [(0.4, 1.0)]

    def test_zero_max_points(self):
        assert downsample_by_angle([(0.0, 1.0)], 0) == []


class TestScanToPoints:
    def test_full_pipeline_shape_and_cap(self):
        sweep = [(i * 0.25, 1.0 + (i % 7) * 0.1) for i in range(1440)]
        pts = scan_to_points(sweep, max_points=360)
        assert len(pts) <= 360
        assert all(len(p) == 2 for p in pts)
        assert all(isinstance(v, float) for p in pts for v in p)

    def test_out_of_range_removed(self):
        pts = scan_to_points([(0.0, 0.01), (90.0, 50.0)], max_points=360)
        assert pts == []

    def test_values_rounded_mm(self):
        pts = scan_to_points([(0.0, 1.23456)], max_points=360)
        assert pts == [[1.235, -0.0]] or pts == [[1.235, 0.0]]

    def test_empty_scan(self):
        assert scan_to_points([]) == []
