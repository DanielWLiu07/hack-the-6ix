# Base44 Context Pack - paste this BEFORE prompt P1

Copy the block below into the Base44 builder as your first message, then follow with P1–P5 from `docs/BASE44.md`. It gives their machine our real brand, palette, and data shapes (with genuine sample rows from our robot's telemetry), so Orchard OS matches the robot system exactly and the webhook data slots straight in.

---

CONTEXT for the app you're about to build (details follow in my next messages):

**Brand - "Orchard OS" by the team behind an autonomous fruit-picking robot.**
- Tagline: "Battery, not Blood." Voice: warm, farmer-first, a little cheeky - never corporate.
- Palette: paper `#dcd6c4`, deep green `#2b3a2f`, leaf green `#46a758`, apple red `#e5484d`, ink `#16211a`. Painterly/hand-drawn feel, soft edges, no glossy gradients.

**Core data shape - PickReport** (these arrive live via webhook from our real robot):
```json
{ "job_id": "…", "fruit": "apple|banana", "ripeness": "ripe|unripe",
  "bin": "apple_ripe|apple_unripe|banana_ripe|banana_unripe",
  "success": true, "duration_ms": 8246, "ts": 1784344325245 }
```

**Real sample rows from our robot** (use rows shaped exactly like these for seed data - ~8s per pick, ~93% success):
```json
[
 {"ts":1784344356590,"fruit":"banana","ripeness":"ripe","bin":"banana_ripe","success":true,"duration_ms":8021},
 {"ts":1784344340920,"fruit":"banana","ripeness":"ripe","bin":"banana_ripe","success":true,"duration_ms":8438},
 {"ts":1784344325245,"fruit":"apple","ripeness":"ripe","bin":"apple_ripe","success":true,"duration_ms":8246},
 {"ts":1784344309555,"fruit":"apple","ripeness":"ripe","bin":"apple_ripe","success":true,"duration_ms":8693},
 {"ts":1784344293885,"fruit":"apple","ripeness":"unripe","bin":"apple_unripe","success":false,"duration_ms":9154}
]
```

**Realistic aggregates to mirror in seeded dashboards** (from our live system):
success rate ≈ 93% · avg pick ≈ 8.1 s · fruit mix ≈ 70% apple / 30% banana · ripe:unripe ≈ 2:1.

**Economics for the ROI widget**: $2.10/kg apples, $1.40/kg bananas, ~0.15 kg per pick, robot subscription $199/mo per unit.

**Users**: small orchard operators (e.g. "Maria, 20-hectare apple orchard, can't hire pickers"). They book robot harvest runs, watch live results, and see the robot pay for itself.

---

After pasting the block above, continue with **P1** from `docs/BASE44.md`. When you reach **P2** (webhook), the endpoint you create will receive exactly the PickReport shape shown here - our server is already forwarding it.

## Running both tracks in parallel (how this stays sane)
- **Base44 side**: builds/hosts Orchard OS on their platform - the business layer, judged by their team.
- **Our side**: the robot stack keeps evolving independently - nothing in Base44 can break it.
- **Only contact point**: the webhook (`BASE44_WEBHOOK_URL` + `BASE44_SECRET` in `web/server/.env`). If Base44's app changes shape, only that endpoint cares. If our robot changes, Base44 just receives the same JSON.
- During judging, both run simultaneously: robot picks → our dashboard updates AND Orchard OS ticks its ROI, live.
