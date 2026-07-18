"""Fresh-vs-spoiled separability baseline (numpy/opencv only, no sklearn).

For each banana image: detect the banana, build its silhouette, and extract a few
color/texture features that should react to marker spots (less-yellow / darker /
more textured regions inside the fruit). Then:
  1) per-feature AUC (Mann-Whitney) between fresh & spoiled -> which signal separates,
  2) a numpy logistic-regression classifier, 5-fold CV -> accuracy + AUC.

AUC ~0.5 = indistinguishable; ~0.8 good; ~0.9+ strong. This tells us whether the
captured data is good enough to train a real classifier before touching Edge Impulse.
"""

import glob
import os
import sys

import cv2
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "robot", "vision"))
from hsv_detector import HSVDetector, _color_mask  # noqa: E402

DATASET = os.path.join(os.path.dirname(__file__), "dataset")
det = HSVDetector()
FEATS = ["blemish_frac", "dark_frac", "b_std", "sat_mean", "lap_var"]


def features(path):
    img = cv2.imread(path)
    hsv = cv2.cvtColor(cv2.GaussianBlur(img, (5, 5), 0), cv2.COLOR_BGR2HSV)
    ymask = _color_mask(hsv, "yellow")
    cnts, _ = cv2.findContours(ymask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None
    cnt = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(cnt) < 1200:
        return None
    H, W = img.shape[:2]
    sil = np.zeros((H, W), np.uint8)
    cv2.drawContours(sil, [cnt], -1, 255, -1)
    m = sil > 0
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).astype(np.float32)
    L, A, B = lab[:, :, 0], lab[:, :, 1], lab[:, :, 2]
    medL, medA, medB = np.median(L[m]), np.median(A[m]), np.median(B[m])
    dist = np.sqrt((L - medL) ** 2 + (A - medA) ** 2 + (B - medB) ** 2)
    sat = hsv[:, :, 1]
    x, y, w, h = cv2.boundingRect(cnt)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)[y:y + h, x:x + w]
    return np.array([
        float((dist[m] > 25).mean()),          # blemish_frac: deviates from healthy color
        float((L[m] < medL - 40).mean()),       # dark_frac
        float(B[m].std()),                       # b_std: yellowness spread
        float(sat[m].mean()),                    # sat_mean
        float(cv2.Laplacian(gray, cv2.CV_64F).var()),  # lap_var: texture/edges
    ])


def load(label):
    X = []
    for f in sorted(glob.glob(os.path.join(DATASET, label, "*.jpg"))):
        v = features(f)
        if v is not None:
            X.append(v)
    return np.array(X)


def auc(pos, neg):
    """P(pos ranked above neg); pos = higher-should-mean-spoiled."""
    wins = ties = 0
    for p in pos:
        wins += np.sum(p > neg)
        ties += np.sum(p == neg)
    return (wins + 0.5 * ties) / (len(pos) * len(neg))


def logreg_cv(X, y, folds=5, iters=400, lr=0.3, seed=0):
    n = len(X)
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Xs = (X - mu) / sd
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)
    accs, aucs = [], []
    for k in range(folds):
        te = idx[k::folds]
        tr = np.array([i for i in idx if i not in set(te)])
        Xtr, ytr, Xte, yte = Xs[tr], y[tr], Xs[te], y[te]
        w = np.zeros(Xtr.shape[1]); b = 0.0
        for _ in range(iters):
            z = Xtr @ w + b
            p = 1 / (1 + np.exp(-z))
            g = p - ytr
            w -= lr * (Xtr.T @ g / len(Xtr) + 1e-3 * w)
            b -= lr * g.mean()
        pte = 1 / (1 + np.exp(-(Xte @ w + b)))
        accs.append(float(((pte > 0.5).astype(int) == yte).mean()))
        if yte.sum() and (yte == 0).sum():
            aucs.append(auc(pte[yte == 1], pte[yte == 0]))
    return np.mean(accs), (np.mean(aucs) if aucs else float("nan")), dict(zip(FEATS, w))


def main():
    fresh, spoiled = load("fresh"), load("spoiled")
    print(f"usable crops: fresh={len(fresh)} spoiled={len(spoiled)}\n")
    print("per-feature AUC (fresh vs spoiled), 0.5=useless 1.0=perfect:")
    for i, name in enumerate(FEATS):
        a = auc(spoiled[:, i], fresh[:, i])
        a = max(a, 1 - a)  # direction-agnostic separability
        print(f"  {name:14} {a:.3f}   fresh μ={fresh[:,i].mean():.3g}  spoiled μ={spoiled[:,i].mean():.3g}")
    X = np.vstack([fresh, spoiled])
    y = np.array([0] * len(fresh) + [1] * len(spoiled))
    acc, a, w = logreg_cv(X, y)
    print(f"\nlogistic regression, 5-fold CV:  accuracy={acc*100:.1f}%   AUC={a:.3f}")
    print("  feature weights:", {k: round(v, 2) for k, v in w.items()})


if __name__ == "__main__":
    main()
