# UNO Q execution plan — getting the CV model on-device to win the Qualcomm track

Companion to [`QUALCOMM.md`](QUALCOMM.md) (the pitch/why). This is the **how + when**:
the decisions, the build order, and what we can finish now vs. what needs the board.

Status: board not in hand yet ("soon"). Goal: everything UNO-Q-ready so the board
is a ~30-min deploy, not a scramble.

---

## The strategic fact that drives every decision

The **entire stack is Qualcomm-owned** as of late 2025:

- **Arduino** (UNO Q hardware + App Lab IDE) — acquired by Qualcomm, Nov 2025.
- **Edge Impulse** (edge-ML platform) — acquired by Qualcomm, Mar 2025, *specifically*
  to power the **Dragonwing** chips — which is the **QRB2210** in the UNO Q.
- **Qualcomm AI Hub** — model profiling/optimization for Dragonwing.

So "use Edge Impulse + App Lab + AI Hub" = "use Qualcomm's own end-to-end platform on
Qualcomm's own silicon." That's exactly what the track judges reward. And our
architecture — **AI on the Linux MPU, real-time control on the STM32 MCU, Bridge
between them** — *is* the UNO Q's whole thesis. We lean into that hard.

Hardware reality (design around it): QRB2210 = quad Cortex-A53 + **Adreno 702 GPU** +
low-power Hexagon DSP. **No big NPU/HTP.** Our AI story is *efficient CPU/GPU
on-device inference, no cloud* — not "NPU acceleration."

---

## Decision 1 — Edge Impulse: yes, but not locked in

| Path | Effort | Qualcomm-story | Control | Verdict |
|---|---|---|---|---|
| **Edge Impulse** (train → App Lab Brick → AI Hub) | low | ★★★ (their own platform) | medium | **primary** |
| Self-train (Keras/PyTorch) → TFLite → custom Brick | high | ★★ (their board, not their ML) | high | fallback |
| App Lab pre-trained Bricks only | very low | ★ (no custom model) | low | demo filler |

**Chosen:** Edge Impulse primary. **Anti-lock-in:** dataset + synthesis stay local
(done — `ml/spoilage/`), so we can retrain to TFLite anytime. Free tier covers image
classification. (Note: FOMO-AD visual anomaly is Enterprise-only — see Decision 2.)

## Decision 2 — Model + task: hybrid, classification-first

- **Localization:** keep the **HSV detector** (`robot/vision/`) — fast, reliable, zero
  training, no false positives. It finds the banana and crops it.
- **Classification:** **Edge Impulse image classifier** on the crop → fresh / spoiled
  (extendable to ripe/unripe). This is the trainable, on-device "genuine AI" piece.
- **Anomaly angle (the story):** Arduino **App Lab ships an anomaly-detection Brick** —
  use it for "detects spoilage it was never shown," sidestepping the Enterprise
  FOMO-AD gate. Decide classifier-vs-anomaly-Brick once we can test on the board;
  the dataset supports both.

Hybrid = defensible: classical CV where it's strong (localization), learned AI where it
adds value (spoilage), all on-device.

## Decision 3 — The dual-brain demo (the money shot)

```
 camera → [MPU / QRB2210 Linux]  HSV detect → crop → EI classify (App Lab Brick)
                                        │  decision: ripe→PICK · spoiled→REJECT
                                        ▼  Arduino Bridge (MPU → MCU)
                     [MCU / STM32U585]  real-time arm + drivetrain actuation
```

Showing perception on the Linux brain drive the real-time MCU brain over the Bridge is
the UNO Q's signature capability. That end-to-end loop is what we demo.

---

## Work plan

### Now — no board needed (do all of this)
- [ ] **Data:** ~15 more *distinct* real scenes (capture tool `:8091`, QC gate on).
- [ ] **Synthesis:** already built (`prepare_ei.py` + `synthesize.py`, incl. background
      randomization). Re-run after new captures.
- [ ] **Train in Edge Impulse:** upload `ei_export/`, Image 96×96 → Transfer Learning
      classifier → **evaluate on the real test split** (the honest number).
- [ ] **Export both:** App Lab Brick **and** a TFLite/ONNX fallback.
- [ ] **Glue module** (`robot/vision/spoilage_classifier.py`): HSV bbox → crop → run the
      exported model → emit `spoiled` + `spoil_score`. Works on the laptop now; portable
      to the board unchanged. Wire into `pipeline.py` behind an env flag.
- [ ] **App Lab Brick scaffolding:** app manifest + Python entrypoint stub, ready to drop
      the model in. (Finalize once we can run App Lab.)
- [ ] **Baseline bench:** `robot/vision/bench.py` numbers on the laptop as the "before."
- [ ] **Pitch:** extend `QUALCOMM.md` with the all-Qualcomm-stack + dual-brain narrative.

### When the board arrives (~30 min if the above is done)
- [ ] Flash/run the App Lab Brick on the UNO Q; camera → live fresh/spoiled.
- [ ] **Profile via Qualcomm AI Hub**; capture on-device latency / FPS / RAM.
- [ ] Wire **MPU → Bridge → MCU**: classifier decision drives the arm/drivetrain.
- [ ] Record the end-to-end demo; drop real on-device numbers into `QUALCOMM.md`.

---

## Deliverables that win the track
1. A **custom model trained in Edge Impulse** running **on the QRB2210** via **App Lab**.
2. **Qualcomm AI Hub** profiling numbers (latency/RAM), framed as "no cloud, ever."
3. **Live MPU→Bridge→MCU** loop: AI decision actuates real-time hardware.
4. **Quantified impact** (food-waste avoided) tied to real pick/reject events.
5. Clean story: *our intentional MPU/MCU split is the UNO Q's thesis, built on their
   full stack (Arduino + Edge Impulse + AI Hub).*

## Risks / dependencies
- **Board timing** — mitigated: everything above is board-independent until the last step.
- **EI free-tier limits** — classification is fine; anomaly (FOMO-AD) is Enterprise →
  use the App Lab anomaly Brick or the local model instead.
- **Domain gap** (synthetic vs real) — always evaluate on the **real** test split.
- **App Lab Brick specifics** may need the board to finalize — we stub now, finish on-device.

## References
- Qualcomm × Edge Impulse acquisition (Mar 2025) · Qualcomm × Arduino (Nov 2025)
- Arduino UNO Q docs; App Lab + Bricks; Edge Impulse ↔ App Lab ↔ AI Hub integration
