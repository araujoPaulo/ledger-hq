import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png', 'icon-maskable.png'],
      manifest: {
        name: 'Ledger HQ',
        short_name: 'Ledger HQ',
        lang: 'pt-PT',
        dir: 'ltr',
        start_url: '/',
        display: 'standalone',
        background_color: '#f8fafc',
        theme_color: '#0f172a',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // Reads degrade to the last known state, clearly marked as stale.
            urlPattern: ({ url, request }) =>
              url.pathname.startsWith('/api/v1') && request.method === 'GET',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-reads',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          // Writes fail loudly rather than pretending to succeed. Workbox's
          // Route binds to exactly one HTTP method (workbox-routing's
          // `HTTPMethod` is a single-value union, not an array), so each
          // write verb needs its own entry to actually be intercepted —
          // a single rule with no `method` defaults to 'GET' and would
          // silently never match a write.
          ...(['POST', 'PUT', 'PATCH', 'DELETE'] as const).map((method) => ({
            urlPattern: ({ url }: { url: URL }) => url.pathname.startsWith('/api/v1'),
            handler: 'NetworkOnly' as const,
            method,
          })),
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:3000', changeOrigin: true } },
  },
})
