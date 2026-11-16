import { Zap } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Product } from '../../../../services/productService';
import { ProductCard } from './ProductCard';

interface TrendingSectionProps {
    products: Product[];
    isLoading: boolean;   // true → skeletons; false → carrusel real
}

/**
 * Sección "Frecuentemente Solicitados" — historial real del cliente.
 * Blueprint v3.0 — Estandarización Simétrica (03-Mar-2026).
 *
 * items-stretch: todas las celdas adoptan la altura de la más alta del grupo.
 * Sin h-[...] fijo: la tarjeta respira según su contenido real.
 * w-[300px]: ~3.5 cards visibles en desktop, ~1.15 en mobile (peeking natural).
 */
export const TrendingSection: React.FC<TrendingSectionProps> = ({ products, isLoading }) => {
    const { t } = useTranslation();

    // ── Skeleton loader ───────────────────────────────────────────────────────
    if (isLoading) {
        return (
            <div className="flex flex-col gap-3">
                {/* Título skeleton */}
                <div className="flex items-center gap-2 px-1">
                    <div className="w-4 h-4 rounded bg-border/40 animate-pulse" />
                    <div className="w-44 h-5 rounded-md bg-border/40 animate-pulse" />
                </div>
                {/* Cards skeleton — mismas dimensiones que la celda real */}
                <div className="flex items-stretch gap-4 overflow-x-hidden">
                    {[0, 1, 2].map(i => (
                        <div
                            key={i}
                            className="w-[300px] min-w-[300px] flex-shrink-0 min-h-[160px] flex flex-col bg-white border border-border rounded-lg p-4 gap-3 shadow-cards animate-pulse"
                        >
                            <div className="h-4 w-3/4 rounded-md bg-border/40" />
                            <div className="h-3 w-1/2 rounded-md bg-border/30" />
                            <div className="h-3 w-2/3 rounded-md bg-border/30" />
                            <div className="mt-auto flex items-center justify-between">
                                <div className="h-5 w-16 rounded-md bg-border/40" />
                                <div className="h-8 w-24 rounded-lg bg-border/30" />
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ── Sin historial → no renderiza la sección ───────────────────────────────
    if (products.length === 0) return null;

    // ── Carrusel horizontal ───────────────────────────────────────────────────
    return (
        <div className="flex flex-col gap-3">
            {/* Título */}
            <div className="flex items-center gap-2 px-1">
                <Zap size={16} className="text-warning fill-warning shrink-0" />
                <h2 className="text-base font-bold text-heading">
                    {t('catalog.trending_title')}
                </h2>
            </div>

            {/*
                Contenedor v3.0:
                - items-stretch → todas las celdas adoptan la altura de la más alta
                - w-[300px] celda → ~3.5 cards en desktop, peeking natural de la 4ª
                - snap-mandatory → scroll "pesado" con inercia entre ítems
            */}
            <div className="flex items-stretch gap-4 overflow-x-auto pb-3
                            snap-x snap-mandatory scrollbar-hide
                            -mx-4 px-4 sm:mx-0 sm:px-0">
                {products.map((product) => (
                    <div
                        key={product.id}
                        className="w-[300px] min-w-[300px] flex-shrink-0 snap-start flex flex-col"
                    >
                        <ProductCard product={product} />
                    </div>
                ))}
            </div>
        </div>
    );
};
