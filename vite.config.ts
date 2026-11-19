/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Teknergy - Sistema de Planilla',
        short_name: 'Teknergy',
        description: 'Plataforma de gestión de planilla de Teknergy.',
        theme_color: '#122255',
        background_color: '#FFFFFF',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        orientation: 'portrait-primary',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: '/maskable-icon.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
      devOptions: {
        enabled: true
      }
    })
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-engine': ['@react-pdf/renderer'],
          'ui-icons': ['lucide-react'],
          'vendor': ['react', 'react-dom', 'react-router-dom', 'zustand'],
        }
      }
    },
    chunkSizeWarningLimit: 800, // Increase slightly if needed
  },
  server: {
    proxy: {
      '/api/health': {
        target: 'http://localhost:54321',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/health/, '/functions/v1/system-health'),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // e2e/*.spec.ts son specs de Playwright, no de vitest — el glob default de vitest
    // (**/*.spec.ts) los agarraría igual e intentaría correrlos con su propio runner.
    // Se agrega a la lista default de exclude (no la reemplaza) para no perder node_modules/dist/etc.
    exclude: [
        '**/node_modules/**', '**/dist/**', '**/cypress/**',
        '**/.{idea,git,cache,output,temp}/**',
        '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
        '**/e2e/**',
    ],
    // createClient() de @supabase/supabase-js valida que la URL sea sintácticamente
    // válida incluso si nunca se usa (los tests mockean la capa de store/service, no
    // hacen red real) — sin esto, cualquier test que importe algo de services/ revienta
    // al no encontrar VITE_SUPABASE_URL en el entorno de test.
    env: {
      VITE_SUPABASE_URL: 'http://localhost:54321',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
    },
  },
})
