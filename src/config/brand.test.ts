import { describe, it, expect } from 'vitest';
import { BRAND, CONTACT } from './brand';

describe('brand CONTACT (contacto comercial)', () => {
    it('usa el email comercial provisional', () => {
        expect(CONTACT.SALES_EMAIL).toBe('ventas@teknergy.com');
    });

    it('define telefono y whatsapp placeholder en formato DB (503XXXXXXXX)', () => {
        expect(CONTACT.SALES_PHONE).toMatch(/^503\d{8}$/);
        expect(CONTACT.SALES_WHATSAPP).toMatch(/^503\d{8}$/);
    });

    it('define direccion placeholder', () => {
        expect(typeof CONTACT.ADDRESS).toBe('string');
        expect(CONTACT.ADDRESS.length).toBeGreaterThan(0);
    });

    it('no reutiliza ningun dato personal / interno de BRAND', () => {
        const values = Object.values(CONTACT).map(String);
        expect(values).not.toContain(BRAND.SUPPORT_EMAIL);
        expect(values).not.toContain(BRAND.PHONE_BODEGA);
        expect(values.join(' ').toLowerCase()).not.toContain('alexis');
        expect(values.join(' ')).not.toContain('77772397');
    });

    it('marca explicitamente los valores como PLACEHOLDER', () => {
        expect(CONTACT.IS_PLACEHOLDER).toBe(true);
    });

    it('el shell publico (src/ui/features/store) no usa SUPPORT_EMAIL ni PHONE_BODEGA', () => {
        const files = import.meta.glob('/src/ui/features/store/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
        const offenders = Object.entries(files)
            .filter(([path]) => !/\.test\.tsx?$/.test(path))
            .filter(([, src]) => /SUPPORT_EMAIL|PHONE_BODEGA/.test(src))
            .map(([path]) => path);
        expect(offenders).toEqual([]);
    });
});
