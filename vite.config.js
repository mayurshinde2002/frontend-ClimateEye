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
      }
    }
  }
})
