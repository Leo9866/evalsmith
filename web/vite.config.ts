import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      '/api/v1/traces': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/api/v1/spans': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
      },
      '/api/v1/datasets': {
        target: 'http://127.0.0.1:8003',
        changeOrigin: true,
      },
      '/api/v1/evaluators': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/v1/experiments': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/v1/evaluate': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
      '/api/v1/annotation': {
        target: 'http://127.0.0.1:8005',
        changeOrigin: true,
      },
      '/api/v1/monitoring': {
        target: 'http://127.0.0.1:8006',
        changeOrigin: true,
      },
      '/api/v1/projects': {
        target: 'http://127.0.0.1:8004',
        changeOrigin: true,
      },
      '/api/v1/api-keys': {
        target: 'http://127.0.0.1:8004',
        changeOrigin: true,
      },
      '/api/v1/auth': {
        target: 'http://127.0.0.1:8004',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
