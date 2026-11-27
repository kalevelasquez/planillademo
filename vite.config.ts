/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { pwaOptions, adminChunkFileNames } from './pwa.config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA(pwaOptions),
  ],
  build: {
    rollupOptions: {
      output: {
        // Prefijo `admin-` para los chunks del shell admin (se excluyen del precache, ver pwa.config.ts).
        chunkFileNames: adminChunkFileNames,
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
