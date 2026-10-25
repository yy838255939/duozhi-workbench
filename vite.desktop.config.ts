import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  base: './',
  plugins: [tsconfigPaths(), react()],
  build: { outDir: 'dist-desktop', rollupOptions: { input: 'desktop.html' } },
})
