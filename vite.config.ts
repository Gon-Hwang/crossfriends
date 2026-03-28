import build from '@hono/vite-build/cloudflare-pages'
import devServer from '@hono/vite-dev-server'
import cloudflareAdapter from '@hono/vite-dev-server/cloudflare'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const wranglerConfig = path.resolve(__dirname, 'wrangler.jsonc')

export default defineConfig({
  plugins: [
    build(),
    devServer({
      // 로컬 Vite: R2/D1을 원격에 붙이지 않고 Miniflare 로컬 버킷·DB 사용 (업로드 503 방지)
      adapter: () =>
        cloudflareAdapter({
          proxy: {
            configPath: wranglerConfig,
            persist: true,
            remoteBindings: false
          }
        }),
      entry: 'src/index.tsx'
    })
  ],
  server: {
    host: true, // LAN·다른 기기에서 접속 (0.0.0.0 바인딩)
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
