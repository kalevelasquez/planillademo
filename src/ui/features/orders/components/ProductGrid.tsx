import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, PackageOpen, Search, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '../../../components/Button';
import type { Product } from '../../../../services/productService';
import { ProductListItem } from './ProductListItem';

interface ProductGridProps {
    products: Product[];
    isLoading: boolean;
    hasMore: boolean;
    searchTerm: string;
    isFiltered?: boolean;
    onLoadMore: () => void;
    onClearSearch: () => void;
}

/**
 * Grid paginado de productos agrupados por categoría.
 * El agrupamiento `groupedProducts` vive aquí (Blueprint v2.0 §2.2).
 * ProductCard gestiona su propio estado de carrito via useOrderStore.
 */
export const ProductGrid: React.FC<ProductGridProps> = ({
    products,
    isLoading,
    hasMore,
    searchTerm,
    isFiltered = false,
    onLoadMore,
    onClearSearch,
}) => {
    const { t } = useTranslation();
    // Estado para categorías colapsadas (false = expandido por defecto)
    const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

    const groupedProducts = useMemo(() => {
        // US-ORD-10: Si hay búsqueda o filtros, priorizamos un orden global por Calibre.
        // Esto responde a la queja del usuario sobre calibres desordenados en distintas categorías.
        const isSearchActive = searchTerm.trim().length > 0 || isFiltered;

        const groups = products.reduce((acc, current) => {
            const categoryName = isSearchActive
                ? (t('catalog.search_results') as string)
                : (current.category || (t('common.unknown') as string));

            if (!acc[categoryName]) acc[categoryName] = [];
            acc[categoryName].push(current);
            return acc;
        }, {} as Record<string, Product[]>);

        // Calibre (Numérico) -> Marca -> Calidad -> Embarque
        Object.keys(groups).forEach(category => {
            groups[category].sort((a, b) => {
                // 1. Calibre (Ej: '100', '113')
                const caliberCompare = (a.caliber || '').localeCompare(b.caliber || '', undefined, { numeric: true });
                if (caliberCompare !== 0) return caliberCompare;

                // 2. Marca
                const brandCompare = (a.brand || '').localeCompare(b.brand || '');
                if (brandCompare !== 0) return brandCompare;

                // 3. Calidad
                const qualityCompare = (a.quality || '').localeCompare(b.quality || '');
                if (qualityCompare !== 0) return qualityCompare;

                return (b.shipment_number || '').localeCompare(a.shipment_number || '', undefined, { numeric: true });
            });
        });

        const sortedCategories = Object.keys(groups).sort((a, b) => a.localeCompare(b));
        const sortedGroups: Record<string, Product[]> = {};

        sortedCategories.forEach(category => {
            sortedGroups[category] = groups[category];
        });

        return sortedGroups;
    }, [products, t]);

    const toggleCategory = (category: string) => {
        setCollapsedCategories(prev => ({
            ...prev,
            [category]: !prev[category]
        }));
    };

    if (products.length === 0 && !isLoading) {
        return (
            <div className="bg-white rounded-lg shadow-cards border border-border p-xl text-center flex flex-col items-center">
                <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-md">
                    {searchTerm
                        ? <Search size={32} className="text-text-secondary/50" />
                        : <PackageOpen size={32} className="text-text-secondary/50" />
                    }
                </div>
                <h3 className="text-h3 text-heading">
                    {searchTerm ? `${t('common.no_results')} "${searchTerm}"` : t('catalog.no_products')}
                </h3>
                <p className="text-body text-text-secondary mt-xs max-w-[300px]">
                    {searchTerm
                        ? t('catalog.no_products_desc')
                        : t('catalog.no_products_desc_empty') || t('catalog.no_products_desc')}
                </p>
                {searchTerm && (
                    <Button variant="secondary" className="mt-md" onClick={onClearSearch}>
                        {t('common.clear_search')}
                    </Button>
                )}
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-xl">
            {Object.entries(groupedProducts).map(([category, prods]) => {
                const isCollapsed = !!collapsedCategories[category];
                return (
                    <div key={category} className="flex flex-col gap-sm">
                        <button
                            onClick={() => toggleCategory(category)}
                            className="flex items-center gap-2 group self-start hover:opacity-80 transition-all focus:outline-none"
                        >
                            <h2 className="text-h3 font-display font-semibold text-heading px-sm border-b-2 border-primary/20 pb-xs inline-block">
                                {category}
                            </h2>
                            <div className={`text-primary transition-transform duration-200 ${isCollapsed ? 'rotate-0' : 'rotate-0'}`}>
                                {isCollapsed ? <ChevronRight size={22} /> : <ChevronDown size={22} />}
                            </div>
                        </button>

                        {!isCollapsed && (
                            <div className="flex flex-col gap-sm animate-in fade-in slide-in-from-left-2 duration-300">
                                {prods.map((product) => (
                                    <ProductListItem key={product.id} product={product} />
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}

            {hasMore && (
                <div className="flex justify-center mt-lg mb-xl pb-10">
                    <Button
                        variant="secondary"
                        onClick={onLoadMore}
                        disabled={isLoading}
                        className="w-full max-w-[300px] flex items-center justify-center gap-xs"
                    >
                        {isLoading
                            ? <Loader2 className="animate-spin w-5 h-5" />
                            : t('catalog.load_more') || 'Cargar más productos'
                        }
                    </Button>
                </div>
            )}
        </div>
    );
};
