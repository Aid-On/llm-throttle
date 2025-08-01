import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'demo',
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      '@aid-on/llm-throttle': '../src/index.ts'
    }
  }
})