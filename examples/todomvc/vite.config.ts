import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@lib': path.resolve(__dirname, '../../src'),
      // Alias @flexsurfer/reflex to the local source so reflex-devtools
      // uses the same reflex instance as the app
      '@flexsurfer/reflex': path.resolve(__dirname, '../../src')
    }
  },
  optimizeDeps: {
    // Exclude reflex-devtools from pre-bundling so it picks up the @flexsurfer/reflex alias
    exclude: ['@flexsurfer/reflex-devtools']
  }
})