# deploy — status log

## [22:05] DONE — vercel.json created, build verified
- web/vercel.json: Vite framework config, SPA rewrite (everything except /assets/* → index.html), immutable caching for hashed assets, no-cache for HTML.
- `npm run build` in web/ passes clean (vite 8.1.5, 191 kB js / 60 kB gz).
- Next: initial prod deploy via vercel CLI to verify the pipeline, then docs/DEPLOY.md.

## [22:06] DONE — initial prod deploy live
- Deployed via `vercel deploy --prod --yes` from web/. **Prod URL: https://hack-the-6ix-chi.vercel.app** (also https://hack-the-6ix-daniel-w-lius-projects.vercel.app).
- ⚠️ NOTE: plain `hack-the-6ix.vercel.app` is someone ELSE'S project (a CRA app) — do not put that URL on slides/devpost; use the -chi one.
- Verified: SPA rewrite (/teleop → 200 index.html), asset caching headers, our Vite bundle served.
- FYI web-frontend: index.html `<title>` is still "web" — worth branding when you touch it (your file, not mine).
- Next: docs/DEPLOY.md runbook + VITE_SERVER_URL env story.

## [22:06] DONE — docs/DEPLOY.md runbook written
- Covers: deploy commands, rollback, VITE_SERVER_URL (build-time!) procedure, venue networking + judges-phone plan, day-of checklist.
- Key gotcha documented: Vercel is HTTPS → mixed-content blocks ws:// to http://laptop:3001. Plan A = cloudflared/ngrok tunnel on the laptop, set VITE_SERVER_URL to tunnel URL, redeploy (~2 min). Plan B = judges on hotspot hit laptop directly over http.
- server-core: please include https://hack-the-6ix-chi.vercel.app in CORS allowed origins (or reflect origin).

## [22:06] BLOCKED (partial) — VITE_SERVER_URL prod value
- Cannot set until venue: needs laptop hotspot IP or tunnel URL (exists only day-of). Procedure fully documented in docs/DEPLOY.md §Env vars. No env vars currently set on Vercel (verified via vercel env ls); frontend defaults to localhost:3001 which is correct for now.
- Now on standby: polling web-frontend status → will build-verify + redeploy prod at each frontend milestone.

## [22:07] DONE — CI build check + runbook tuned to installed tools
- .github/workflows/web-build.yml: on push/PR touching web/** → npm ci, lint, build (Node 22). Lint verified exit 0 locally (warnings only), build green — CI will pass on first push.
- DEPLOY.md updated: ngrok (installed) is the tunnel plan; cloudflared is not on this laptop.
- All 4 assigned tasks done or blocked-on-venue. Standing by: watching web-frontend status → build-verify + `vercel deploy --prod --yes` at each milestone. Prod: https://hack-the-6ix-chi.vercel.app

## [restart] WIP — resuming after crash; frontend milestone detected, redeploying
- Restarted worker deploy. Re-read assignments + BROADCAST (phase-2 has no new deploy directive; VITE_SERVER_URL still venue-deferred as before). No long-running processes owned by me (build+deploy role) — nothing to restart.
- Vercel authed (danielwliu07), project linked. `npm run build` passes clean (vite 8.1.5).
- Frontend has advanced since my last prod deploy (22:06 was 191 kB single chunk; now 339 kB main + code-split 902 kB LidarView chunk = lidar/three.js + teleop landed). Redeploying prod now.

## [restart+] DONE — prod redeployed with latest frontend, verified
- `vercel deploy --prod --yes` → dpl_273r3ra3WgmejrYgUbWa24EA9Xj9, READY, target production. Remote build clean.
- Verified prod alias **https://hack-the-6ix-chi.vercel.app** resolves to that deployment (vercel inspect). `/` → 200, `/teleop` SPA rewrite → 200, our Vite bundle served. (Bundle hash differs from local build — Vercel builds remotely, expected.)
- VITE_SERVER_URL still venue-deferred (no env vars set; localhost:3001 default correct until day-of tunnel/hotspot IP). Back on standby: will build-verify + redeploy at each further frontend milestone.

## [restart++] DONE — r3f hero ship handled by master; stood down, resumed milestone-watch
- Human-priority standby was for web-frontend flipping `USE_R3F_HERO=true`. Flag flipped (App.jsx:17), I build-verified clean (OrchardHero 4.7KB gz chunk + Gltf 254KB gz three/GLB chunk, no breakage) and was deploy-ready, holding on their status-DONE gate.
- Master shipped it directly before the gate landed. Human told me to stand down. Verified prod alias **https://hack-the-6ix-chi.vercel.app** now serves dpl_BXiBrTZjBtFoFHgTrbD7F4SsAV8C (master's r3f-hero deploy). No redundant deploy from me.
- Resumed normal milestone-watch (baseline web-frontend.md = 63 lines). Will build-verify + redeploy at the next frontend milestone.
