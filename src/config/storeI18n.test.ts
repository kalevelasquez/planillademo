import { describe, it, expect } from 'vitest';
import es from '../../public/locales/es/common.json';
import en from '../../public/locales/en/common.json';

const flatten = (obj: Record<string, unknown>, prefix = ''): string[] =>
    Object.entries(obj).flatMap(([k, v]) =>
        v && typeof v === 'object' ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`],
    );

const get = (obj: unknown, path: string) => path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj);

const REQUIRED = [
    'store.nav.catalog',
    'store.nav.cart',
    'store.nav.account',
    'store.nav.staffLogin',
    'store.landing.heroTitle',
    'store.landing.heroSubtitle',
    'store.landing.cta',
    'store.landing.contactTitle',
    'store.catalog.search',
    'store.catalog.empty',
    'store.catalog.available',
    'store.catalog.soldOut',
    'store.catalog.addToCart',
    'store.catalog.price',
    'store.errors.store_unavailable',
    'store.errors.product_unavailable',
    'store.errors.generic',
    'inventory.image.label',
    'inventory.image.invalidType',
    'inventory.image.tooLarge',
    'inventory.image.uploadError',
];

describe('i18n store.* e inventory.image.* (es/en)', () => {
    it.each(REQUIRED)('%s existe y no esta vacia en ambos idiomas', (key) => {
        for (const dict of [es, en]) {
            const v = get(dict, key);
            expect(typeof v).toBe('string');
            expect((v as string).trim().length).toBeGreaterThan(0);
        }
    });

    it('es y en tienen exactamente las mismas claves en store.* e inventory.*', () => {
        const pick = (d: unknown) =>
            flatten({ store: (d as Record<string, unknown>).store ?? {}, inventory: (d as Record<string, unknown>).inventory ?? {} }).sort();
        expect(pick(es)).toEqual(pick(en));
        expect(pick(es).length).toBeGreaterThanOrEqual(REQUIRED.length);
    });
});
