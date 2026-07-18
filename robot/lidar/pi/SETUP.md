# Lidar node - Raspberry Pi setup

Reads an RPLIDAR-style 360° lidar over USB serial and streams `lidar_scan`
Socket.IO events (`{"ts":…,"points":[[x,y],…]}`, meters, robot frame,
≤360 pts, ~2 Hz) to the laptop hub.

## Quick start (any machine)

```bash
cd robot/lidar/pi
SERVER_URL=http://<laptop-ip>:3001 ./run.sh
```

First run creates `.venv` and installs deps. The loop auto-restarts on
crash, missing device (exit 2), or unreachable server (exit 3).

Unit tests (no hardware/deps needed beyond pytest):

```bash
python3 -m pytest tests/ -q
```

## Pi provisioning

1. Flash Raspberry Pi OS Lite (64-bit) with Raspberry Pi Imager.
   In Imager's settings (gear icon): hostname `lidar-pi`, enable SSH,
   user `pi`, and preload the **phone hotspot** Wi-Fi SSID/password.
2. Boot, then `ssh pi@lidar-pi.local`.
3. `sudo apt update && sudo apt install -y git python3-venv`
4. Copy this directory over (or clone the repo):
   `scp -r robot/lidar/pi pi@lidar-pi.local:~/lidar`
5. Serial permission: `sudo usermod -aG dialout pi` then re-login.
6. Test: plug in lidar, `LIDAR_PORT=$(ls /dev/ttyUSB*) SERVER_URL=http://<laptop-ip>:3001 ~/lidar/run.sh`
   (omit `LIDAR_PORT` to autodetect).

## Auto-start on boot (demo insurance)

```bash
sudo tee /etc/systemd/system/lidar.service > /dev/null <<'EOF'
[Unit]
Description=Lidar node
After=network-online.target

[Service]
User=pi
Environment=SERVER_URL=http://LAPTOP_IP:3001
ExecStart=/home/pi/lidar/run.sh
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl enable --now lidar
journalctl -u lidar -f     # watch logs
```

Replace `LAPTOP_IP` with the laptop's hotspot IP (find it on the laptop
with `ipconfig getifaddr en0`). Hotspot IPs are usually stable per device;
verify at the venue and update with
`sudo systemctl edit lidar` if it changed.

## Environment variables

| Var | Default | Meaning |
|---|---|---|
| `SERVER_URL` | `http://localhost:3001` | laptop Socket.IO hub |
| `LIDAR_PORT` | *(autodetect)* | serial device, e.g. `/dev/ttyUSB0` |
| `LIDAR_BAUD` | `115200` | RPLIDAR A1/A2 default; A3/S-series use 256000 |
| `EMIT_HZ` | `2.0` | scan emit rate |
| `MAX_POINTS` | `360` | downsample cap (schema max) |
| `ANGLE_OFFSET_DEG` | `0` | mounting rotation so 0° = robot forward |
| `ANGLE_CCW` | `0` | set 1 if lidar mounted upside down |
| `MIN_RANGE_M` / `MAX_RANGE_M` | `0.10` / `12.0` | range filter |
| `LIDAR_MOCK` | `0` | set 1 to synthesize scans (no hardware / demo fallback) |

## Troubleshooting

- **`NO_DEVICE`**: `ls /dev/ttyUSB* /dev/ttyACM*` - nothing? bad cable/port.
  Something? set `LIDAR_PORT` explicitly.
- **Handshake failed but port exists**: wrong baud (try `LIDAR_BAUD=256000`),
  or another process holds the port (`sudo lsof /dev/ttyUSB0`).
- **Connected but dashboard empty**: check the server pane logs receive
  `lidar_scan`; check `SERVER_URL` uses the laptop's *hotspot* IP, not
  localhost.
- **Motor not spinning (A1)**: needs the USB adapter's MOTOCTL jumper /
  5V supply; power from Buck #2 per `docs/HARDWARE.md`, never the servo rail.
- **Lidar dead at demo time**: `LIDAR_MOCK=1 ./run.sh` streams a synthetic
  4×4 m room with a moving obstacle through the exact same pipeline.
