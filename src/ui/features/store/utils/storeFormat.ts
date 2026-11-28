import type { StoreProduct } from '../../../../services/storeService';

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** Precio de catalogo en USD ("$12.50"). Un valor no finito se muestra como $0.00 (nunca "NaN"). */
export const formatPrice = (value: number): string => usd.format(Number.isFinite(value) ? value : 0);

/** Telefono DB (503XXXXXXXX, sin "+") a formato legible. Otros formatos: solo se antepone "+". */
export const formatPhone = (raw: string): string => {
    const digits = raw.replace(/\D/g, '');
    const sv = /^503(\d{4})(\d{4})$/.exec(digits);
    return sv ? `+503 ${sv[1]}-${sv[2]}` : `+${digits}`;
};

const featuredRank = (p: StoreProduct): number => {
    if (p.availability !== 'Disponible') return 2;
    return p.imageUrl ? 0 : 1;
};

/**
 * Productos destacados de la landing: primero disponibles con foto, luego disponibles sin foto y
 * al final agotados. Orden estable dentro de cada grupo (el RPC ya ordena por nombre).
 */
export const pickFeatured = (products: StoreProduct[], max: number): StoreProduct[] =>
    products
        .map((product, index) => ({ product, index }))
        .sort((a, b) => featuredRank(a.product) - featuredRank(b.product) || a.index - b.index)
        .slice(0, max)
        .map(({ product }) => product);
