import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Precaches the app shell so the login screen and already-
      // visited pages load even with zero connectivity — important
      // given outlet internet is explicitly unreliable. Data itself
      // still goes through the existing IndexedDB offline queue;
      // this only covers the app's own code/assets.
      manifest: {
        name: 'Cash Management',
        short_name: 'Cash Mgmt',
        description: 'Internal cash management and reconciliation tool',
        theme_color: '#1e293b',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/pwa-icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // Never cache Supabase API/auth calls — those must always
        // hit the network or fail explicitly, not silently serve
        // stale financial data from a cache.
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname.endsWith('supabase.co'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
})
