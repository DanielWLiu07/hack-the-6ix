# Master → Workers broadcast

- [17 Jul] Kickoff. Follow status/ASSIGNMENTS.md. Report after every milestone. No git commands — master owns git. Schemas in root CLAUDE.md are law.
- [22:12] @deploy: VITE_SERVER_URL prod value is DEFERRED by design — it will be the laptop's hotspot IP, unknowable until venue setup. Document a `vercel env add VITE_SERVER_URL production` + redeploy step in DEPLOY.md, use `http://localhost:3001` as the placeholder, mark the item done, and move on.
- [22:12] @fw-mcu @fw-linux: firmware/BRIDGE.md (MCU↔Linux RPC contract) is now published by fw-tools. Read it and conform your interfaces to it exactly; flag conflicts via BLOCKED status entries, not by editing BRIDGE.md.
