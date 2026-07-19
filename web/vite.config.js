import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // The rover's own drive server (App Lab web_ui on the Uno Q).
  const boardTarget = env.VITE_BOARD_URL || 'http://100.111.103.46:7000'
  return {
    plugins: [react()],
    server: {
      proxy: {
        // The /teleop page connects same-origin to /rover-io; Vite forwards it
        // to the rover's socket.io server. This server-side hop avoids the
        // browser CORS check entirely (the board's socket.io doesn't send a
        // usable Access-Control-Allow-Origin for a cross-origin browser).
        '/rover-io': {
          target: boardTarget,
          ws: true,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/rover-io/, '/socket.io'),
        },
      },
    },
  }
})
