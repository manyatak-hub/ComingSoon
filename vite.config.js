import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The 3D engine is split into its own file, so the video page loads only what it needs
export default defineConfig({
  plugins: [react()],
  build: { chunkSizeWarningLimit: 4000 },
})
