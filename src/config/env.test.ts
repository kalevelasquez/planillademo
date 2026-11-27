import { describe, it, expect, afterEach, vi } from 'vitest';

const load = async () => {
    vi.resetModules();
    return import('./env');
};

describe('config/env (tienda)', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('sin variables: tenant vacio y captcha apagado', async () => {
        vi.stubEnv('VITE_STORE_TENANT_ID', '');
        vi.stubEnv('VITE_STORE_CAPTCHA_ENABLED', '');
        const env = await load();
        expect(env.STORE_TENANT_ID).toBe('');
        expect(env.STORE_CAPTCHA_ENABLED).toBe(false);
    });

    it('lee VITE_STORE_TENANT_ID (recortado)', async () => {
        vi.stubEnv('VITE_STORE_TENANT_ID', '  11111111-1111-1111-1111-111111111111 ');
        const env = await load();
        expect(env.STORE_TENANT_ID).toBe('11111111-1111-1111-1111-111111111111');
    });

    it('captcha solo se enciende con el literal "true"', async () => {
        vi.stubEnv('VITE_STORE_CAPTCHA_ENABLED', 'true');
        expect((await load()).STORE_CAPTCHA_ENABLED).toBe(true);
        vi.stubEnv('VITE_STORE_CAPTCHA_ENABLED', 'false');
        expect((await load()).STORE_CAPTCHA_ENABLED).toBe(false);
        vi.stubEnv('VITE_STORE_CAPTCHA_ENABLED', '1');
        expect((await load()).STORE_CAPTCHA_ENABLED).toBe(false);
    });
});
