import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: 'https://climateye-apis.up.railway.app',
        changeOrigin: true,
        secure: true
      },
      '/open-meteo': {
        target: 'https://api.open-meteo.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/open-meteo/, '')
      }
    }
  }
})
