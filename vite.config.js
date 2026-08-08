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
      includeAssets: ['apple-touch-icon.png'],
      workbox: {
        // never serve stale HTML for auth callbacks or the MCP endpoint
        navigateFallbackDenylist: [/^\/__\//, /^\/mcp\//, /^\/api\//],
      },
      manifest: {
        name: 'Meat Grinder',
        short_name: 'Meat Grinder',
        description: 'Grind your macros. Hit your numbers.',
        theme_color: '#0b0f0d',
        background_color: '#0b0f0d',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
