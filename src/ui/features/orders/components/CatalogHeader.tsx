import React from 'react';
import { ArrowLeft, ShoppingCart, Loader2 } from 'lucide-react';
import type { Customer } from '../../../../services/customerService';
import type { FilterState, FilterOptions } from '../../../../services/productService';
import { InputField } from '../../../components/InputField';
import { CatalogFilters } from './CatalogFilters';
import { useTranslation } from 'react-i18next';

interface CatalogHeaderProps {
    customer: Customer;
    searchTerm: string;
    totalItems: number;
    onSearchChange: (value: string) => void;
    onClearSearch: () => void;
    onBack: () => void;
    onCheckout: () => void;
    // Props de filtros — consolidadas en este bloque card (HO 03-Mar-2026)
    filters: FilterState;
    filterOptions: FilterOptions;
    onFilterChange: (key: keyof FilterState, value: string) => void;
    onClearAll: () => void;
    isSaving?: boolean;
}

/**
 * Bloque card del catálogo: navegación, búsqueda y barra de filtros unificados.
 * Consolidación HO 03-Mar-2026: buscador (InputField del UI Kit) + CatalogFilters
 * dentro de una única tarjeta blanca. Layout sticky en desktop.
 */
export const CatalogHeader: React.FC<CatalogHeaderProps> = ({
    customer,
    searchTerm,
    totalItems,
    onSearchChange,
    onClearSearch,
    onBack,
    onCheckout,
    filters,
    filterOptions,
    onFilterChange,
    onClearAll,
    isSaving = false,
}) => {
    const { t } = useTranslation();
    return (
        <div className="sticky top-0 z-20 bg-white rounded-b-lg md:rounded-xl shadow-cards border border-border flex flex-col gap-2 md:gap-4 p-3 md:p-6">

            {/* ── Fila Superior: Back + Cliente + Carrito ───────────────────── */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                    <button
                        onClick={onBack}
                        className="shrink-0 p-1.5 text-text-secondary w-[36px] h-[36px] flex items-center justify-center hover:bg-surface rounded-lg transition-colors"
                        aria-label={t('common.back')}
                    >
                        <ArrowLeft size={22} />
                    </button>
                    <div className="min-w-0">
                        <h1 className="text-h2 md:text-h1 text-heading truncate max-w-[140px] sm:max-w-[220px] md:max-w-none">
                            {customer.business_name}
                        </h1>
                        <p className="text-caption text-text-secondary uppercase tracking-wide flex items-center gap-2">
                            {t('catalog.title_for')}{' '}
                            <span className="font-bold text-primary">{customer.business_name}</span>
                            {isSaving && (
                                <span className="flex items-center gap-1 text-[10px] text-text-secondary normal-case animate-in fade-in duration-300">
                                    <Loader2 size={10} className="animate-spin" />
                                    {t('orders.saving_draft')}
                                </span>
                            )}
                        </p>
                    </div>
                </div>

                {/* Cart badge */}
                <div className="relative shrink-0">
                    <button
                        onClick={onCheckout}
                        className="flex items-center gap-2 border border-border bg-white rounded-lg px-3 py-1.5 shadow-sm hover:bg-surface transition-colors text-sm font-medium text-heading"
                        aria-label={t('catalog.view_order')}
                    >
                        <ShoppingCart size={18} />
                        <span className="hidden sm:inline">{t('catalog.view_order')}</span>
                    </button>
                    {totalItems > 0 && (
                        <div className="absolute -top-2 -right-2 bg-error text-white text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full shadow-sm pointer-events-none">
                            {totalItems > 99 ? '99+' : totalItems}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Separador ─────────────────────────────────────────────────── */}
            <div className="h-px bg-border/50" />

            {/* ── Buscador — InputField del UI Kit ──────────────────────────── */}
            <div className="flex items-center gap-2">
                <div className="flex-1">
                    <InputField
                        id="catalog-search"
                        placeholder={t('catalog.search_placeholder')}
                        isSearch
                        value={searchTerm}
                        onChange={(e) => onSearchChange(e.target.value)}
                        onClear={onClearSearch}
                    />
                </div>
            </div>

            {/* ── Filtros — FilterBar integrado en la misma card ────────────── */}
            <CatalogFilters
                filters={filters}
                filterOptions={filterOptions}
                onFilterChange={onFilterChange}
                onClearAll={onClearAll}
            />
        </div>
    );
};
