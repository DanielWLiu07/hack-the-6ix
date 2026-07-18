# Deploy runbook

Owner: deploy worker. Covers the Vercel frontend, env vars, and venue networking.

## What's deployed where

| Piece | Where it runs | URL |
|---|---|---|
| Frontend (Vite build of `web/`) | Vercel, project `hack-the-6ix` | **https://hack-the-6ix-chi.vercel.app** |
| Telemetry server (`web/server/`, Express + Socket.IO :3001) | Laptop at the venue — NOT Vercel | `http://<laptop-ip>:3001` |
| Robot / lidar clients | UNO Q + Pi | connect out to laptop :3001 |

> ⚠️ **URL warning**: plain `hack-the-6ix.vercel.app` is a *stranger's project* (name was taken). Ours is the **`-chi`** one. Double-check any URL that goes on slides or the Devpost.

## Deploying the frontend

```sh
cd web
npm run build          # sanity check locally first — must pass
vercel deploy --prod --yes
```

- Project is already linked (`web/.vercel/project.json`, team `daniel-w-lius-projects`).
- `web/vercel.json` handles the rest: Vite framework preset, SPA rewrite (all non-`/assets/*` paths → `index.html`, so client-side routes like `/teleop` deep-link fine), long-cache on hashed assets, `no-cache` on HTML.
- Preview deploy (for testing without touching prod): `vercel deploy --yes`.
- Rollback: `vercel ls` to see recent deployments, `vercel promote <deployment-url>`.

## Env vars

Frontend has exactly one: **`VITE_SERVER_URL`** — base URL of the telemetry server. Code defaults to `http://localhost:3001` when unset (correct for local dev; no env needed).

Vite bakes env vars in **at build time** — changing it means redeploying, and it must be set for the `production` environment *before* the build:

```sh
cd web
vercel env add VITE_SERVER_URL production   # paste the server URL when prompted
vercel deploy --prod --yes                  # rebuild so it's baked in
```

Server-side env (`web/server/.env`, gitignored, never on Vercel): `MONGODB_URI`, robot MJPEG URL — see server-core/db status files.

## Venue networking plan

Problem: venue WiFi usually isolates clients, and judges' phones need the dashboard.

**Topology**: phone hotspot = robot network. Laptop, UNO Q, and Pi all join it. Robot and Pi reach the laptop server at its hotspot IP (find it: `ipconfig getifaddr en0`). Hotspot IPs are usually stable per-device across reconnects, but verify on arrival.

**Judges' phones** use the Vercel mirror. Catch: Vercel is HTTPS, and browsers **block mixed content** — an `https://` page cannot open WebSockets to `http://<hotspot-ip>:3001`. Two options, in order of preference:

1. **Tunnel the laptop server (recommended)** — gives an HTTPS URL that works from any network, no hotspot dependence for viewers:
   ```sh
   ngrok http 3001        # already installed on the laptop (cloudflared is not)
   ```
   Take the printed `https://…` URL → `vercel env add VITE_SERVER_URL production` → redeploy. One-time ~2 min at the venue. (Quick-tunnel URLs change per run — start it once, early, and leave it running.)
2. **Local-only fallback** — judges join the hotspot and open `http://<laptop-ip>:5173` (Vite dev server) or a `vite preview` build directly from the laptop. Plain HTTP throughout, no mixed content. Vercel then serves only as the static "it's deployed" proof with simulated data.

**CORS**: the server must allow the Vercel origin, not just `localhost:5173`. Server-core: allow `https://hack-the-6ix-chi.vercel.app` (or reflect origin — hackathon).

## Venue-day checklist

1. Start hotspot; join laptop + UNO Q + Pi; note laptop IP.
2. Start server (`web/server`), sim off once robot connects.
3. Start `ngrok http 3001`; copy the HTTPS URL. (Free-tier ngrok URLs change per run — start once, leave running. Free tier also shows an interstitial page on first browser visit; click through once per phone, or use a reserved domain if anyone has a paid account.)
4. `vercel env add VITE_SERVER_URL production` (rm the old value first if re-adding: `vercel env rm VITE_SERVER_URL production -y`), then `vercel deploy --prod --yes`.
5. Open https://hack-the-6ix-chi.vercel.app on a phone over cell data — confirm live telemetry.
6. Film it working (backup footage rule).
