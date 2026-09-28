import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'ThreadMyMail',
        short_name: 'ThreadMail',
        description: 'AI-powered email management',
        theme_color: '#3b82f6',
        background_color: '#ffffff',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // The agent stream is a WebSocket and must never be cached.
            urlPattern: /\/v1\/agent\/stream$/i,
            handler: 'NetworkOnly',
          },
          {
            // Read-heavy endpoints tolerate short staleness; the server is the
            // source of truth, so this is a speed-up, not an authority.
            urlPattern: /\/v1\/(emails|todos|activity)(\?.*)?$/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'reads',
              expiration: { maxEntries: 200, maxAgeSeconds: 300 },
              networkTimeoutSeconds: 10,
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      // The Worker is not deployed yet (docs/PLAN.md Phase 0). Point this at the
      // Worker once it exists, or set VITE_API_BASE for a deployed environment.
      '/v1': {
        target: process.env.WORKER_DEV_URL || 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096,
  },
})