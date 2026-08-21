import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
  return {
    // Capacitor serves from a local origin where absolute '/assets/...'
    // paths 404. Must stay relative.
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        disable: mode === 'development',
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
          // woff2 included: the pixel fonts are now bundled, not fetched.
          globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
          clientsClaim: true,
          skipWaiting: true,
        },
      }),
    ],
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
