# Track Strategy

One Devpost submission, stacked across every track we plausibly qualify for.

## ⚠️ The one-track rule

**A project can only enter ONE of: Best Environmental / Best Hardware / Best Beginner.**

We're choosing **Best Environmental** (per team decision). Note the tradeoff honestly:
- **Hardware** is arguably our *strongest natural fit* (this is literally a hardware-centered project — arm, rover, lidar, edge compute) and the field may be thinner.
- **Environmental** requires the sustainability story to carry: food waste reduction, labor-free local agriculture, lower food costs → less famine. We back it with *numbers* in the demo (e.g. "X% of fruit rots unpicked due to labor shortages; a $200 robot changes that math").
- Decide finally at submission time based on what other teams are building. Ask organizers if switching is allowed before deadline.

## Priority tiers

### Tier 1 — build the project around these

| Track | Prize | Hard requirements | How we satisfy |
|---|---|---|---|
| **Overall 1st–3rd** | Hoverboard / Fitbit / Projector | Judged: difficulty, uniqueness, design, completeness | Full-custom robotics + polished web app. Completeness = staged demo fallbacks (PLAN.md). |
| **Best Environmental** | BLAHAJ 🦈 | Sustainability-focused | Food-waste / famine framing with real numbers. Put it FIRST in the pitch, not last. |
| **Qualcomm — Arduino UNO Q** | Meta Ray-Bans | Must show **intentional MPU/MCU split** + **genuine on-device AI** (no cloud) | Linux side: quantized YOLO ripeness inference + planner. MCU side: real-time motor/servo/e-stop. Explicitly diagram the split in the demo. Inference must run on the board, not a laptop. |
| **Deloitte — AI for Green** | Prize pack | AI applied to sustainability, measurable impact | Same env story + quantify: kg fruit saved/hr, cost per pick vs manual labor, model runs on 5W edge device (this is *also* Green AI — efficient quantized edge model, no datacenter). Hits both dimensions. |

### Tier 2 — meaningful extra work but big payoff

| Track | Prize | Requirements | How |
|---|---|---|---|
| **Freesolo — Best Model Trained** | SF flight + interview | Train an LLM on Freesolo (SFT/RL/distillation), infinite credits during event | **"FarmHand"**: SFT a small model on synthetic pairs of natural-language commands → structured action JSON (`{"task":"pick","filter":"ripe","zone":"left"}`) + multi-turn clarification dialogs. It becomes the robot's NL command interface. Generate ~1–2k training pairs with a big model, fine-tune, demo live voice/text commanding. |

### Tier 3 — nearly free, claim them

| Track | Prize | How |
|---|---|---|
| **MLH MongoDB Atlas** | M5GO IoT kit | Atlas is our primary DB: pick events, telemetry time series, ripeness stats. Already in stack. |
| **MLH Auth0** | Headphones | Auth0 login gating the robot control dashboard ("operator auth"). Already in stack. |
| **People's Choice** | DJUNGELSKOG | Robots picking apples live in the venue = crowd magnet. Bring apples. Let people command it. |

### Stretch (only if ahead of schedule)

- **ElevenLabs** (earbuds + credits): give FarmHand a voice — robot announces picks / responds to commands via conversational agent. ~2h of work, only if Tier 1–2 are done.
- **MLH Gemini**: only if we genuinely need it (e.g. generating the Freesolo training set) — don't force it.

### Explicitly skipping

- **Base44** (note: parts list said "Base22" — it's Base44): requires building the product *in* Base44's platform; conflicts with our custom React app. Skip unless we spin a tiny companion tool.
- QNX (different hardware path than UNO Q — can't do both well), Chexy/Unifold/Solana/BGA (fintech/payments — no fit), Stay22, CORTEX, Backboard, Phoebe, Presage, Warp.

## Devpost submission checklist

- [ ] Select: Environmental (NOT hardware/beginner), Qualcomm, Deloitte, Freesolo, MongoDB, Auth0, Chexy❌, People's Choice auto
- [ ] Repo link public, README polished
- [ ] Demo video ≤ 2–3 min: hook (env stats) → live pick → dashboard → MPU/MCU split slide → FarmHand command demo
- [ ] Explicit slide/section for EACH sponsor's judging criteria (judges score what they can see)
