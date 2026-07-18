#!/usr/bin/env python3
"""Synthetic bootstrap dataset for the 3D-printed fruit detector.

The venue props are solid-color 3D prints (red/green apples, yellow/green
bananas), so procedurally rendered solid-color shapes on cluttered backgrounds
are a close match to the real domain. Real prop photos captured with
capture.py get merged in later for the finetune.

Usage:
    python3 data/make_synth.py --train 1200 --val 200
Writes YOLO-format data to data/dataset/{images,labels}/{train,val}/.
"""
import argparse
import random
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "dataset"
SIZE = 640  # render res; training downscales to 320

CLASSES = ["apple_ripe", "apple_unripe", "banana_ripe", "banana_unripe"]

# BGR base colors of the printed props (PLA-ish saturated plastic)
COLORS = {
    "apple_ripe":    (35, 35, 200),    # red
    "apple_unripe":  (60, 170, 70),    # green
    "banana_ripe":   (40, 200, 230),   # yellow
    "banana_unripe": (70, 190, 130),   # yellow-green
}


def jitter_color(bgr, amt=30):
    return tuple(int(np.clip(int(c) + random.randint(-amt, amt), 0, 255)) for c in bgr)


def random_background():
    """Cluttered venue-ish background: gradients, noise, distractor shapes."""
    base = np.full((SIZE, SIZE, 3), [random.randint(30, 220) for _ in range(3)], np.uint8)
    # gradient
    g = np.linspace(random.uniform(0.6, 1.0), random.uniform(0.6, 1.0), SIZE)
    if random.random() < 0.5:
        grad = np.tile(g[:, None], (1, SIZE))
    else:
        grad = np.tile(g[None, :], (SIZE, 1))
    img = (base * grad[..., None]).astype(np.uint8)
    # wood-grain / floor stripes sometimes
    if random.random() < 0.4:
        for _ in range(random.randint(3, 10)):
            y = random.randint(0, SIZE)
            cv2.line(img, (0, y), (SIZE, y + random.randint(-40, 40)),
                     jitter_color([c for c in img[min(y, SIZE - 1), 0]], 25),
                     random.randint(2, 12))
    # distractor shapes in NON-fruit colors (grays, blues, purples)
    for _ in range(random.randint(0, 6)):
        col = random.choice([(200, 150, 60), (160, 60, 140), (120, 120, 120),
                             (60, 60, 60), (230, 220, 210), (140, 90, 40)])
        p = (random.randint(0, SIZE), random.randint(0, SIZE))
        if random.random() < 0.5:
            cv2.circle(img, p, random.randint(10, 80), jitter_color(col), -1)
        else:
            q = (p[0] + random.randint(-150, 150), p[1] + random.randint(-150, 150))
            cv2.rectangle(img, p, q, jitter_color(col), -1)
    # noise
    noise = np.random.randint(-18, 18, img.shape, np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    return img


def draw_apple(img, color):
    """Slightly irregular shaded sphere with a stem + specular highlight."""
    r = random.randint(28, 90)
    cx = random.randint(r, SIZE - r)
    cy = random.randint(r, SIZE - r)
    axes = (r, int(r * random.uniform(0.88, 1.05)))
    overlay = img.copy()
    cv2.ellipse(overlay, (cx, cy), axes, random.uniform(-15, 15), 0, 360, color, -1)
    # top dimple: darker wedge
    dark = tuple(int(c * 0.75) for c in color)
    cv2.ellipse(overlay, (cx, cy - int(axes[1] * 0.85)), (int(r * 0.35), int(r * 0.18)),
                0, 0, 360, dark, -1)
    # stem
    cv2.line(overlay, (cx, cy - axes[1]), (cx + random.randint(-8, 8), cy - axes[1] - int(r * 0.35)),
             (30, 50, 70), max(2, r // 12))
    # shading: darker lower-left arc
    cv2.ellipse(overlay, (cx + int(r * 0.15), cy + int(r * 0.15)), axes, 0, 40, 200,
                tuple(int(c * 0.8) for c in color), max(3, r // 6))
    # specular highlight (shiny PLA)
    hl = (min(255, color[0] + 120), min(255, color[1] + 120), min(255, color[2] + 120))
    cv2.ellipse(overlay, (cx - int(r * 0.3), cy - int(r * 0.35)), (r // 5, r // 8),
                -30, 0, 360, hl, -1)
    a = random.uniform(0.85, 1.0)
    cv2.addWeighted(overlay, a, img, 1 - a, 0, img)
    x0, y0 = cx - axes[0], cy - axes[1] - int(r * 0.35)
    x1, y1 = cx + axes[0], cy + axes[1]
    return [x0, y0, x1, y1]


def draw_banana(img, color):
    """Crescent built from a thick curved polyline, tapered ends."""
    length = random.randint(70, 190)
    cx = random.randint(length, SIZE - length)
    cy = random.randint(length, SIZE - length)
    ang = random.uniform(0, 2 * np.pi)
    curve = random.uniform(0.35, 0.6)
    n = 24
    ts = np.linspace(-1, 1, n)
    # centerline arc in local frame, then rotate
    xs = ts * length / 2
    ys = curve * length / 2 * (ts ** 2 - 0.5)
    ca, sa = np.cos(ang), np.sin(ang)
    px = (cx + xs * ca - ys * sa).astype(int)
    py = (cy + xs * sa + ys * ca).astype(int)
    thick = max(8, int(length * random.uniform(0.16, 0.22)))
    overlay = img.copy()
    for i in range(n - 1):
        t = 1 - abs(ts[i])  # taper toward tips
        w = max(3, int(thick * (0.45 + 0.55 * t)))
        cv2.line(overlay, (px[i], py[i]), (px[i + 1], py[i + 1]), color, w)
    # brown tip
    cv2.circle(overlay, (px[0], py[0]), max(2, thick // 4), (30, 60, 90), -1)
    # ridge highlight
    hl = tuple(min(255, c + 90) for c in color)
    for i in range(4, n - 5):
        cv2.line(overlay, (px[i], py[i] - thick // 4), (px[i + 1], py[i + 1] - thick // 4),
                 hl, max(1, thick // 6))
    a = random.uniform(0.85, 1.0)
    cv2.addWeighted(overlay, a, img, 1 - a, 0, img)
    pad = thick // 2 + 2
    return [int(px.min()) - pad, int(py.min()) - pad, int(px.max()) + pad, int(py.max()) + pad]


def clip_box(b):
    x0, y0, x1, y1 = b
    return [max(0, x0), max(0, y0), min(SIZE - 1, x1), min(SIZE - 1, y1)]


def make_image():
    img = random_background()
    labels = []
    for _ in range(random.randint(1, 4)):
        cls = random.randrange(4)
        name = CLASSES[cls]
        color = jitter_color(COLORS[name], 25)
        box = draw_apple(img, color) if name.startswith("apple") else draw_banana(img, color)
        x0, y0, x1, y1 = clip_box(box)
        if x1 - x0 < 12 or y1 - y0 < 12:
            continue
        labels.append((cls, (x0 + x1) / 2 / SIZE, (y0 + y1) / 2 / SIZE,
                       (x1 - x0) / SIZE, (y1 - y0) / SIZE))
    # global photometric aug: gamma, blur, motion blur
    if random.random() < 0.5:
        gamma = random.uniform(0.6, 1.6)
        lut = np.clip(((np.arange(256) / 255.0) ** gamma) * 255, 0, 255).astype(np.uint8)
        img = lut[img]
    if random.random() < 0.35:
        img = cv2.GaussianBlur(img, (0, 0), random.uniform(0.5, 2.0))
    if random.random() < 0.2:
        k = random.randint(5, 12)
        kern = np.zeros((k, k), np.float32)
        kern[k // 2, :] = 1.0 / k
        img = cv2.filter2D(img, -1, kern)
    return img, labels


def write_split(split, count, start_seed):
    (OUT / "images" / split).mkdir(parents=True, exist_ok=True)
    (OUT / "labels" / split).mkdir(parents=True, exist_ok=True)
    for i in range(count):
        random.seed(start_seed + i)
        np.random.seed(start_seed + i)
        img, labels = make_image()
        stem = f"synth_{split}_{i:05d}"
        cv2.imwrite(str(OUT / "images" / split / f"{stem}.jpg"), img,
                    [cv2.IMWRITE_JPEG_QUALITY, random.randint(70, 95)])
        with open(OUT / "labels" / split / f"{stem}.txt", "w") as f:
            for cls, xc, yc, w, h in labels:
                f.write(f"{cls} {xc:.6f} {yc:.6f} {w:.6f} {h:.6f}\n")
        if (i + 1) % 200 == 0:
            print(f"{split}: {i + 1}/{count}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--train", type=int, default=1200)
    ap.add_argument("--val", type=int, default=200)
    args = ap.parse_args()
    write_split("train", args.train, 1000)
    write_split("val", args.val, 900000)
    print(f"done → {OUT}")
