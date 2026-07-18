# Deploy runbook

Owner: deploy worker. Covers the Vercel frontend, env vars, and venue networking.

## What's deployed where

| Piece | Where it runs | URL |
|---|---|---|
| Frontend (Vite build of `web/`) | Vercel, project `hack-the-6ix` | **https://hack-the-6ix-chi.vercel.app** |
| Telemetry server (`web/server/`, Express + Socket.IO :3001) | Laptop at the venue - NOT Vercel | `http://<laptop-ip>:3001` |
| Robot / lidar clients | UNO Q + Pi | connect out to laptop :3001 |

> **URL warning**: plain `hack-the-6ix.vercel.app` is a *stranger's project* (name was taken). Ours is the **`-chi`** one. Double-check any URL that goes on slides or the Devpost.

## Deploying the frontend

```sh
cd web
npm run build          # sanity check locally first - must pass
vercel deploy --prod --yes
```

- Project is already linked (`web/.vercel/project.json`, team `daniel-w-lius-projects`).
- `web/vercel.json` handles the rest: Vite framework preset, SPA rewrite (all non-`/assets/*` paths → `index.html`, so client-side routes like `/teleop` deep-link fine), long-cache on hashed assets, `no-cache` on HTML.
- Preview deploy (for testing without touching prod): `vercel deploy --yes`.
- Rollback: `vercel ls` to see recent deployments, `vercel promote <deployment-url>`.

## Env vars

Frontend has exactly one: **`VITE_SERVER_URL`** - base URL of the telemetry server. Code defaults to `http://localhost:3001` when unset (correct for local dev; no env needed).

Vite bakes env vars in **at build time** - changing it means redeploying, and it must be set for the `production` environment *before* the build:

```sh
cd web
vercel env add VITE_SERVER_URL production   # paste the server URL when prompted
vercel deploy --prod --yes                  # rebuild so it's baked in
```

Server-side env (`web/server/.env`, gitignored, never on Vercel): `MONGODB_URI`, robot MJPEG URL - see server-core/db status files.

## Venue networking plan

Problem: venue WiFi usually isolates clients, and judges' phones need the dashboard.

**Topology**: phone hotspot = robot network. Laptop, UNO Q, and Pi all join it. Robot and Pi reach the laptop server at its hotspot IP (find it: `ipconfig getifaddr en0`). Hotspot IPs are usually stable per-device across reconnects, but verify on arrival.

**Judges' phones** use the Vercel mirror. Catch: Vercel is HTTPS, and browsers **block mixed content** - an `https://` page cannot open WebSockets to `http://<hotspot-ip>:3001`. Two options, in order of preference:

1. **Tunnel the laptop server (recommended)** - gives an HTTPS URL that works from any network, no hotspot dependence for viewers:
   ```sh
   ngrok http 3001        # already installed on the laptop (cloudflared is not)
   ```
   Take the printed `https://…` URL → `vercel env add VITE_SERVER_URL production` → redeploy. One-time ~2 min at the venue. (Quick-tunnel URLs change per run - start it once, early, and leave it running.)
2. **Local-only fallback** - judges join the hotspot and open `http://<laptop-ip>:5173` (Vite dev server) or a `vite preview` build directly from the laptop. Plain HTTP throughout, no mixed content. Vercel then serves only as the static "it's deployed" proof with simulated data.

**CORS**: the server must allow the Vercel origin, not just `localhost:5173`. Server-core: allow `https://hack-the-6ix-chi.vercel.app` (or reflect origin - hackathon).

## Demo panic switch (force-sim)

> Added by **server-core** per master phase-4 directive. Owned/maintained in `web/server/` (`panic.js`).

If the real robot dies mid-judging, the dashboard would freeze and the demo dies with
it. The hub can spawn `sim.js` as a fallback data source on demand so telemetry, picks,
detections and lidar keep flowing. Three modes, switchable **at runtime - no restart**:

| mode | behaviour |
|---|---|
| `off` | no fallback; the real robot is the only data source (default) |
| `on`  | **manual panic** - force the fallback sim on right now, even if a robot is still connected |
| `auto`| **failover** - run the fallback iff *no real robot* has been connected for `PANIC_GRACE_MS` (default 4 s); auto-kills it the moment a real robot returns |

The fallback sim connects tagged (`auth.sim=true`) so `auto` never mistakes it for the
real robot. `real_robot_connected` in `/api/health` tells you whether live data is real
or simulated (surface it as a badge on the dashboard if time permits).

```sh
# read current state
curl localhost:3001/api/force-sim
# PANIC - force sim now (the one-liner to hit if the robot dies on stage)
curl -X POST localhost:3001/api/force-sim -H 'content-type: application/json' -d '{"on":true}'
# back to the real robot
curl -X POST localhost:3001/api/force-sim -H 'content-type: application/json' -d '{"on":false}'
# hands-off self-healing failover (recommended during judging)
curl -X POST localhost:3001/api/force-sim -H 'content-type: application/json' -d '{"mode":"auto"}'
```

Boot straight into a mode with `FORCE_SIM=auto` (or `on`/`off`) in `web/server/.env`.
Optionally set `PANIC_KEY=<secret>` to require an `X-Panic-Key` header on POST (so a
judge's phone can't toggle it); reads (GET) stay open. Notes:
- `auto` keys off *any* real robot client. If lidar-pi/another robot client is still
  connected while the rover is dead, `auto` won't fire - use `on` to force regardless.
- If lidar-sim is emitting scans separately, set `SIM_LIDAR=0` in `.env` so the fallback
  sim doesn't double up on `lidar_scan`.

## Venue-day checklist

1. Start hotspot; join laptop + UNO Q + Pi; note laptop IP.
2. Start server (`web/server`), sim off once robot connects.
3. Start `ngrok http 3001`; copy the HTTPS URL. (Free-tier ngrok URLs change per run - start once, leave running. Free tier also shows an interstitial page on first browser visit; click through once per phone, or use a reserved domain if anyone has a paid account.)
4. `vercel env add VITE_SERVER_URL production` (rm the old value first if re-adding: `vercel env rm VITE_SERVER_URL production -y`), then `vercel deploy --prod --yes`.
5. Open https://hack-the-6ix-chi.vercel.app on a phone over cell data - confirm live telemetry.
6. Set the panic switch to `auto` (`curl -X POST …/api/force-sim -d '{"mode":"auto"}'`) so the demo self-heals if the robot drops - see *Demo panic switch* above.
7. Film it working (backup footage rule).
