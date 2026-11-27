import type { VitePWAOptions } from 'vite-plugin-pwa';

/**
 * Opciones PWA extraidas de vite.config.ts para poder testearlas (src/config/pwaConfig.test.ts).
 *
 * Objetivo: la tienda publica (/, /tienda, /cuenta) NO debe precachear el codigo admin.
 *  - Los chunks admin salen con prefijo `admin-` (output.chunkFileNames) y se excluyen del
 *    precache con `globIgnores`; se cachean en runtime (CacheFirst) cuando el vendedor los usa.
 *  - `pdf-engine` (react-pdf, pesado) tambien se excluye: solo lo usa el admin.
 *
 * Nota de diseno: se usa `chunkFileNames` por funcion (no `manualChunks`) porque manualChunks
 * fusionaria todas las vistas admin en un unico chunk y rompia el lazy loading por vista.
 */

/** `true` si el modulo pertenece al shell admin (AdminApp, layout y features salvo `store`). */
export const isAdminModule = (id?: string | null): boolean =>
    !!id && /\/src\/(AdminApp|ui\/layout|ui\/features\/(?!store\/))/.test(id);

export const adminChunkFileNames = (chunk: { facadeModuleId?: string | null }): string =>
    isAdminModule(chunk.facadeModuleId) ? 'assets/admin-[name]-[hash].js' : 'assets/[name]-[hash].js';

export const pwaOptions: Partial<VitePWAOptions> = {
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
        // El dashboard admin vive en /inicio ("/" es la landing publica). Las PWA ya instaladas
        // con start_url '/' siguen funcionando: "/" redirige a /inicio (con sesion) o /login.
        start_url: '/inicio',
        scope: '/',
        orientation: 'portrait-primary',
        icons: [
            { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/maskable-icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
    },
    workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        globIgnores: ['**/admin-*.js', '**/pdf-engine-*.js'],
        runtimeCaching: [
            {
                urlPattern: /\/assets\/(admin|pdf-engine)-.*\.js$/,
                handler: 'CacheFirst',
                options: {
                    cacheName: 'admin-chunks',
                    expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
                },
            },
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
    },
    devOptions: {
        enabled: false,
    },
};
