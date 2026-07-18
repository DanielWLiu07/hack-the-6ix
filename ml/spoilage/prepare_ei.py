"""Prepare the captured dataset for Edge Impulse — with a leakage-safe split.

Near-duplicate frames come in bursts (consecutive timestamps). A random
train/test split puts near-identical frames on both sides and inflates the score.
So we split by BURST: whole bursts go to train or test, never both.

Outputs an EI-ready tree (folder-per-label under training/ and testing/):

    ei_export/training/fresh/…  ei_export/training/spoiled/…
    ei_export/testing/fresh/…   ei_export/testing/spoiled/…

Upload (after `edge-impulse-uploader --clean` once to log in / pick project):

    for c in training testing; do for l in fresh spoiled apple empty; do
      edge-impulse-uploader --category $c --label $l ei_export/$c/$l/*.jpg 2>/dev/null
    done; done

Or drag the training/ and testing/ folders into the Studio Data acquisition page.
"""

import glob
import os
import shutil

HERE = os.path.dirname(__file__)
DATASET = os.path.join(HERE, "dataset")
OUT = os.path.join(HERE, "ei_export")
LABELS = ["fresh", "spoiled", "apple", "empty"]
TEST_FRAC = 0.2
BURST_GAP_S = 1.0  # frames more than this apart start a new burst


def _ts(path):
    # filenames are "<label>.<digits>.jpg" where digits are time.time()*1000-ish
    stem = os.path.basename(path).split(".")[1]
    return int(stem) / 1000.0


def bursts(files):
    files = sorted(files, key=_ts)
    groups, cur, last = [], [], None
    for f in files:
        t = _ts(f)
        if last is not None and t - last > BURST_GAP_S:
            groups.append(cur); cur = []
        cur.append(f); last = t
    if cur:
        groups.append(cur)
    return groups


def main():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    summary = []
    for label in LABELS:
        files = glob.glob(os.path.join(DATASET, label, "*.jpg"))
        if not files:
            continue
        grps = bursts(files)
        # deterministic burst assignment: every Nth burst -> test (no RNG needed)
        step = max(2, round(1 / TEST_FRAC))
        tr = te = 0
        for i, g in enumerate(grps):
            split = "testing" if i % step == 0 else "training"
            d = os.path.join(OUT, split, label)
            os.makedirs(d, exist_ok=True)
            for f in g:
                shutil.copy(f, os.path.join(d, os.path.basename(f)))
            if split == "testing":
                te += len(g)
            else:
                tr += len(g)
        summary.append((label, len(grps), tr, te))
    print(f"{'label':8} {'bursts':>7} {'train':>6} {'test':>5}")
    print("-" * 30)
    for label, nb, tr, te in summary:
        print(f"{label:8} {nb:7d} {tr:6d} {te:5d}")
    print(f"\nwrote {OUT}/  (train/test split by burst — no near-dup leakage)")


if __name__ == "__main__":
    main()
