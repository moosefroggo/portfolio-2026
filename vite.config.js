import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import compression from 'vite-plugin-compression'

export default defineConfig({
  plugins: [
    react(),
    compression({ algorithm: 'gzip' }),
    compression({ algorithm: 'brotliCompress', ext: '.br' }),
  ],
  css: {
    devSourcemap: false, // Disable dev CSS sourcemaps which utilize eval() strings
  },
  build: {
    sourcemap: true, // Force Vite to generate clean, external static .map files instead of evals
    rollupOptions: {
      output: {
        manualChunks: {
          'three': ['three'],
          'r3f': ['@react-three/fiber', '@react-three/drei'],
          'postprocessing': ['@react-three/postprocessing'],
        }
      }
    }
  }
})
