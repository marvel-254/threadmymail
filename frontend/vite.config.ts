import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'logo.svg'],
      manifest: {
        // The app lives at /app; / is the marketing page. An installed user
        // wants the app, and RequireSession redirects to /signin if they are
        // not signed in, so this cannot strand anyone at a landing page.
        start_url: '/app',
        // Stable identity. Without this the browser derives the app id from the
        // start_url, so changing the path later would look like a second,
        // unrelated app to install.
        id: '/app',
        name: 'ThreadMyMail',
        short_name: 'ThreadMyMail',
        // Matches --surface-low in styles/silk.css and the theme-color meta in
        // index.html. These three had drifted: the manifest still carried the
        // pre-redesign blue #2563EB on a light #F8FAFC, which is how an
        // installed app ends up with a white title bar on a dark UI.
        theme_color: '#0b1326',
        background_color: '#060e20',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone', 'browser'],
        scope: '/',
        orientation: 'any',
        lang: 'en',
        dir: 'ltr',
        categories: ['productivity', 'utilities'],
        description:
          'An autonomous assistant that works your inbox. Millo triages what arrives, drafts what needs an answer, and runs the follow-ups you forget.',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Maskable variants sit the logo in the 80% safe zone on a solid
          // brand field — required for Android adaptive icons.
          { src: 'pwa-192x192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
        navigateFallback: '/index.html',
        // OAuth start and callback are top-level navigations. Do not let the
        // app-shell fallback turn those API paths into the landing page.
        navigateFallbackDenylist: [/^\/v1(?:\/|$)/],
        runtimeCaching: [
          {
            // The agent stream is a WebSocket and must never be cached.
            urlPattern: /\/v1\/agent\/stream$/i,
            handler: 'NetworkOnly',
            method: 'GET',
          },
          {
            // Session, credentials and provider keys are per-user and
            // cookie-gated. Caching any of them would put one user's mail
            // metadata on another user's device via a shared cache entry.
            urlPattern: /\/v1\/(auth\/session|auth\/logout|settings|settings\/providers|settings\/usage|credentials)$/i,
            handler: 'NetworkOnly',
            method: 'GET',
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
              cacheableResponse: { statuses: [200] },
            },
            method: 'GET',
          },
          {
            // Catch-all: any other /v1/* request (e.g. OAuth start, skills,
            // emails sync) must reach the same-origin OAuth proxy as-is.
            urlPattern: /^\/v1\//i,
            handler: 'NetworkOnly',
            method: 'GET',
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    proxy: {
      // Point this at the deployed Worker, or set VITE_API_BASE for a
      // deployed environment.
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