// Cloud Run entrypoint (deploy worker). Runs the hub, and — when SIM=1 —
// sim.js alongside it as the fake robot so the public dashboard always has data.
// Flip sim off without a rebuild:  gcloud run services update ht6-hub --update-env-vars SIM=0
import { spawn } from 'node:child_process';

const PORT = process.env.PORT || '3001';

const hub = spawn('node', ['index.js'], { stdio: 'inherit' });
hub.on('exit', (code) => process.exit(code ?? 1));

if (process.env.SIM === '1') {
  const startSim = () => {
    const sim = spawn('node', ['sim.js'], {
      stdio: 'inherit',
      env: { ...process.env, SERVER_URL: `http://localhost:${PORT}` },
    });
    sim.on('exit', () => setTimeout(startSim, 3000)); // keep the demo alive
  };
  setTimeout(startSim, 2000); // give the hub a moment to listen
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => hub.kill(sig));
}
