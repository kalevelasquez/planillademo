import { describe, it, expect } from 'vitest';

// Guardia de regresion: "/" ya NO es el dashboard (es la landing/gate). Ningun link, redirect ni
// entrada de menu del admin debe seguir apuntando a "/" esperando el dashboard: va a "/inicio".
const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const FORBIDDEN: Array<[string, RegExp]> = [
    ["navigate('/')", /navigate\(\s*['"`]\/['"`]/],
    ['to="/" (Link/NavLink/Navigate)', /\bto=\{?\s*['"`]\/['"`]/],
    ["menu path: '/'", /\bpath:\s*['"`]\/['"`]/],
    ["mainPaths con '/'", /mainPaths\s*=\s*\[\s*['"`]\/['"`]/],
];

describe('ninguna referencia admin al dashboard en "/"', () => {
    const files = Object.entries(sources).filter(([p]) => !/\.test\.tsx?$/.test(p));

    it('hay fuentes que escanear', () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it.each(FORBIDDEN)('sin %s', (_label, re) => {
        const offenders = files.filter(([, src]) => re.test(src)).map(([p]) => p);
        expect(offenders).toEqual([]);
    });
});
