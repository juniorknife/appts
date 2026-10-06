import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Em desenvolvimento o WebSocket do gateway (Java, porta 8080) e acessado via proxy.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:8080', ws: true },
      '/api': 'http://localhost:8080',
    },
  },
})
