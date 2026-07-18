# raw/ — real-prop photo intake (READ BEFORE SHOOTING)

Drop photos of the **3D-printed fruit props** into the folder matching each prop's
class. A script auto-labels them (HSV color boxes), then we fine-tune the detector
on real photos in ~30 min. This is the single biggest accuracy win before the demo —
the model is currently trained on synthetic images only.

## Where photos go — one fruit per photo, sorted by folder

```
raw/apple_ripe/      ← RED apple prints
raw/apple_unripe/    ← GREEN apple prints
raw/banana_ripe/     ← YELLOW banana prints
raw/banana_unripe/   ← GREEN banana prints
```

Filenames don't matter (phone defaults are fine) — **only the folder matters.**
If a prop's color is ambiguous, decide ripe/unripe by print color and be consistent.

## How to shoot (aim for ~15 min total)

**Count:** ~**60–80 photos per class** (240–320 total). Floor is 40/class — more is
better, especially for whichever fruit the demo will actually pick.

**Camera:** Best is the **arm camera itself** (matches what the robot sees). No arm
yet? A phone works — hold it ~**20–40 cm** away, roughly the gripper's approach distance.

**Angles — vary every shot** (this is what matters most):
- Orbit the fruit: front, both sides, 3/4 views, and a top-down look.
- Tilt up/down; rotate the fruit between shots.
- A few from the **gripper's-eye view** (looking down as if about to pick).
- A few with the gripper/hand **partly in front** of the fruit (partial occlusion — realistic).

**Framing:** fruit fills ~**10–40%** of the frame and is **fully inside** it. Not a
tight crop, not a tiny speck.

**Lighting:** shoot under the **actual venue lighting** you'll demo in. Include a few
brighter and a few darker shots. Avoid a hard glare/hot specular spot on the shiny
print — angle away from direct light if you see a white blowout.

**Background — IMPORTANT for auto-labeling:** put the fruit on a background that is a
**different color than the fruit**. A red apple on a red table, or a green banana on a
green mat, defeats the color auto-labeler. Use varied realistic backgrounds (table,
floor, the bins, a hand) — just not the fruit's own color.

**Do:** vary angle/distance/background constantly · one fruit per frame · keep it in focus.
**Don't:** two fruits in one shot · same-color background · motion blur · fruit cut off at the edge.

## After the photos land (run by vision-train — the 30-min loop)

```bash
python3 capture.py --ingest     # auto-label every raw/<class>/ photo → data/real/
                                # (prints any photo where no fruit was found — re-shoot those)
# review data/real/preview/*.jpg, delete any bad image+label pairs
python3 capture.py --merge      # fold real photos into data/dataset (90/10 split)
python3 train.py --epochs 15 --weights runs/detect/v0/weights/best.pt --name v1
python3 export.py --weights runs/detect/v1/weights/best.pt   # → export/model.onnx
```

If auto-labeling misboxes a color (venue lighting shifts hue), tune `HSV_RANGES` in
`capture.py` — run one live frame with `python3 capture.py --label <class> --n 1 --debug-mask`
to watch the mask, or just hand-fix a few label `.txt` files. The props are solid
colors, so this is usually robust out of the box.
