import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import adapter from '@hono/vite-dev-server/cloudflare'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [
    build(),
    devServer({
      adapter,
      entry: 'src/index.tsx'
    })
  ],
  server: {
    // Disable service worker warnings in development
    strictPort: false,
    hmr: {
      overlay: false // Disable error overlay for warnings
    }
  },
  build: {
    // Suppress warnings during build
    rollupOptions: {
      onwarn(warning, warn) {
        // Ignore service worker warnings
        if (warning.code === 'UNUSED_EXTERNAL_IMPORT') return
        warn(warning)
      }
    }
  }
})
