import { describe, it, expect } from 'vitest';
import { isAdminModule, adminChunkFileNames, pwaOptions } from '../../pwa.config';

describe('isAdminModule', () => {
    it.each([
        '/repo/src/AdminApp.tsx',
        '/repo/src/ui/layout/MainLayout.tsx',
        '/repo/src/ui/features/planilla/PlanillaLayout.tsx',
        '/repo/src/ui/features/orders/CatalogView.tsx',
        '/repo/src/ui/features/auth/LoginView.tsx',
        '/repo/src/ui/features/reports/DashboardView.tsx',
    ])('%s es modulo admin', (id) => expect(isAdminModule(id)).toBe(true));

    it.each([
        '/repo/src/ui/features/store/PublicApp.tsx',
        '/repo/src/ui/features/store/pages/CatalogPage.tsx',
        '/repo/src/App.tsx',
        '/repo/src/main.tsx',
        '/repo/src/services/storeService.ts',
        '/repo/node_modules/react/index.js',
    ])('%s NO es modulo admin', (id) => expect(isAdminModule(id)).toBe(false));

    it('es null-safe', () => {
        expect(isAdminModule(undefined)).toBe(false);
        expect(isAdminModule(null)).toBe(false);
        expect(isAdminModule('')).toBe(false);
    });
});

describe('adminChunkFileNames', () => {
    it('prefija con admin- los chunks cuyo facadeModuleId es admin', () => {
        expect(adminChunkFileNames({ facadeModuleId: '/repo/src/ui/features/planilla/EmpleadosListView.tsx' })).toBe('assets/admin-[name]-[hash].js');
    });
    it('deja el nombre normal al resto (store, compartidos, vendor)', () => {
        expect(adminChunkFileNames({ facadeModuleId: '/repo/src/ui/features/store/pages/CatalogPage.tsx' })).toBe('assets/[name]-[hash].js');
        expect(adminChunkFileNames({ facadeModuleId: null })).toBe('assets/[name]-[hash].js');
    });
});

describe('pwaOptions', () => {
    it('el manifest arranca en /inicio y conserva scope /', () => {
        expect(pwaOptions.manifest).toMatchObject({ start_url: '/inicio', scope: '/' });
    });

    it('globIgnores cubre los chunks admin y pdf-engine (la tienda publica no precachea admin)', () => {
        const ignores = (pwaOptions.workbox as { globIgnores: string[] }).globIgnores;
        expect(ignores).toContain('**/admin-*.js');
        expect(ignores).toContain('**/pdf-engine-*.js');
    });

    it('los chunks admin se cachean en runtime con CacheFirst', () => {
        const rc = (pwaOptions.workbox as { runtimeCaching: Array<{ urlPattern: RegExp; handler: string; options: { cacheName: string } }> }).runtimeCaching;
        const admin = rc.find((r) => r.options.cacheName === 'admin-chunks');
        expect(admin).toBeDefined();
        expect(admin!.handler).toBe('CacheFirst');
        expect(admin!.urlPattern.test('/assets/admin-DashboardView-abc123.js')).toBe(true);
        expect(admin!.urlPattern.test('/assets/pdf-engine-abc123.js')).toBe(true);
        expect(admin!.urlPattern.test('/assets/index-abc123.js')).toBe(false);
    });

    it('devOptions apagado (el SW en dev interfiere con el HMR y con la tienda)', () => {
        expect(pwaOptions.devOptions).toEqual({ enabled: false });
    });
});
