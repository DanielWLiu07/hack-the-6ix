import pytest

from lidar_node.detect import NoDeviceError, find_lidar_port, list_candidates


class TestNoDevicePath:
    def test_explicit_missing_port_raises(self):
        with pytest.raises(NoDeviceError) as ei:
            find_lidar_port("/dev/definitely_not_a_real_port")
        assert "NO_DEVICE" in str(ei.value)
        assert ei.value.code == "NO_DEVICE"

    def test_autodetect_no_devices_raises(self, monkeypatch):
        monkeypatch.setattr("lidar_node.detect.list_candidates", lambda: [])
        with pytest.raises(NoDeviceError) as ei:
            find_lidar_port("")
        assert "NO_DEVICE" in str(ei.value)

    def test_explicit_existing_port_wins(self, tmp_path):
        fake = tmp_path / "ttyUSB0"
        fake.touch()
        assert find_lidar_port(str(fake)) == str(fake)

    def test_autodetect_returns_first_candidate(self, monkeypatch):
        monkeypatch.setattr(
            "lidar_node.detect.list_candidates",
            lambda: ["/dev/ttyUSB0", "/dev/ttyUSB1"],
        )
        assert find_lidar_port("") == "/dev/ttyUSB0"

    def test_list_candidates_runs_without_pyserial(self):
        # must not raise even if pyserial is absent (lazy import w/ fallback)
        assert isinstance(list_candidates(), list)


class TestReaderNoDevice:
    def test_reader_connect_raises_no_device(self, monkeypatch):
        from lidar_node.reader import LidarReader

        monkeypatch.setattr("lidar_node.detect.list_candidates", lambda: [])
        with pytest.raises(NoDeviceError):
            LidarReader().connect()
