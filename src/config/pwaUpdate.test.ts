import { describe, it, expect } from 'vitest';
import { pwaOptions } from '../../pwa.config';

type NavRule = {
    urlPattern: (ctx: { request: { mode: string }; url: URL }) => boolean;
    handler: string;
    options: { cacheName: string; networkTimeoutSeconds?: number; plugins?: Array<Record<string, unknown>> };
};
const workbox = pwaOptions.workbox as Record<string, unknown> & { runtimeCaching: Array<NavRule & { options: { cacheName: string } }> };
const nav = () => workbox.runtimeCaching.find((r) => r.options.cacheName === 'pages') as NavRule;

describe('pwaOptions: actualizacion automatica', () => {
    it('registerType autoUpdate + skipWaiting + clientsClaim + cleanupOutdatedCaches', () => {
        expect(pwaOptions.registerType).toBe('autoUpdate');
        expect(workbox.skipWaiting).toBe(true);
        expect(workbox.clientsClaim).toBe(true);
        expect(workbox.cleanupOutdatedCaches).toBe(true);
    });

    it('no usa navigateFallback (index.html precacheado serviria HTML viejo); navegaciones van NetworkFirst', () => {
        expect(workbox.navigateFallback).toBeUndefined();
        const rule = nav();
        expect(rule).toBeDefined();
        expect(rule.handler).toBe('NetworkFirst');
        expect(rule.options.networkTimeoutSeconds).toBeGreaterThan(0);
    });

    it('la regla de navegacion solo aplica a navigate y no a /api/', () => {
        const u = (p: string) => new URL(p, 'https://x.test');
        const m = nav().urlPattern;
        expect(m({ request: { mode: 'navigate' }, url: u('/tienda') })).toBe(true);
        expect(m({ request: { mode: 'navigate' }, url: u('/api/health') })).toBe(false);
        expect(m({ request: { mode: 'cors' }, url: u('/assets/a.js') })).toBe(false);
    });

    it('todas las navegaciones comparten la clave /index.html en cache (SPA offline)', () => {
        const plugin = nav().options.plugins![0] as { cacheKeyWillBeUsed: () => Promise<string> };
        return expect(plugin.cacheKeyWillBeUsed()).resolves.toBe('/index.html');
    });
});
