import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['apple-touch-icon.png'],
        manifest: {
          name: 'Neon Cell',
          short_name: 'Neon Cell',
          description: 'Eat orbs, dodge angry cells, survive the neon arena.',
          theme_color: '#020617',
          background_color: '#020617',
          display: 'standalone',
          orientation: 'portrait',
          icons: [
            {src: 'pwa-192.png', sizes: '192x192', type: 'image/png'},
            {src: 'pwa-512.png', sizes: '512x512', type: 'image/png'},
            {src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable'},
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,png,svg,ico}'],
          // Cache the Google Fonts so the pixel fonts work offline
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {cacheName: 'google-fonts-css', expiration: {maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365}},
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {cacheName: 'google-fonts-files', expiration: {maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365}},
            },
          ],
        },
      }),
    ],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
