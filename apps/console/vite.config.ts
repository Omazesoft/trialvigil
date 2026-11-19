import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Operator console on :3000. All harness calls go through the Vite dev
// proxy so the UI never hard-codes the harness origin; in production the
// same /api prefix is expected to be served/proxied by the host.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
