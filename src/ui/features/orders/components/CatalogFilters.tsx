import React, { useState } from 'react';
import { Tag, Hash, Ruler, ShieldCheck, Package, ListFilter } from 'lucide-react';
import type { FilterState, FilterOptions } from '../../../../services/productService';
import { FilterBar } from '../../../components/FilterBar';
import { SelectField } from '../../../components/SelectField';
import { useTranslation } from 'react-i18next';

interface CatalogFiltersProps {
    filters: FilterState;
    filterOptions: FilterOptions;
    onFilterChange: (key: keyof FilterState, value: string) => void;
    onClearAll: () => void;
}

/**
 * Barra de filtros homologada con el módulo de Órdenes (FilterBar + SelectField).
 * Fix 03-Mar-2026:
 *   - Opción { value: '', label: 'Todas' } prepended en cada select → limpieza individual.
 *   - Acordeón mobile: el FilterBar colapsa en pantallas < md con botón toggle.
 *   - Filtro de categoría: server-side vía pre-fetch de category_id (ver productService.ts).
 */
export const CatalogFilters: React.FC<CatalogFiltersProps> = ({
    filters,
    filterOptions,
    onFilterChange,
    onClearAll,
}) => {
    const { t } = useTranslation();
    const [isExpanded, setIsExpanded] = useState(false);

    const hasAnyOption = [
        filterOptions.categories,
        filterOptions.calibers,
        filterOptions.brands,
        filterOptions.qualities,
        filterOptions.shipmentNumbers,
    ].some(arr => arr.length > 0);

    if (!hasAnyOption) return null;

    // Helper: convierte array de strings a SelectOption[] con opción de reset al inicio.
    // Al seleccionar value='', handleFilterChange recibe '' → el filtro se limpia.
    const toOptions = (arr: string[], placeholder: string) => [
        { value: '', label: placeholder },
        ...arr.map(v => ({ value: v, label: v })),
    ];

    return (
        <div className="flex flex-col gap-2">
            {/* ── Header Mobile — botón Toggle (oculto en md+) ──────────────── */}
            <div className="md:hidden flex items-center justify-between bg-surface/50 rounded-lg px-3 py-2 border border-border/40 font-bold">
                <div className="flex items-center gap-2">
                    <ListFilter size={16} className="text-text-secondary" />
                    <span className="text-sm font-bold text-text-secondary">{t('products.filters_title')}</span>
                    {/* Indicador de filtros activos */}
                    {(filters.category || filters.brand || filters.caliber ||
                        filters.quality || filters.shipmentNumber) && (
                            <span className="bg-primary text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none">
                                {[filters.category, filters.brand, filters.caliber,
                                filters.quality, filters.shipmentNumber].filter(Boolean).length}
                            </span>
                        )}
                </div>
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-1.5 text-sm text-primary font-bold hover:text-primary-dark transition-colors"
                    aria-expanded={isExpanded}
                    aria-label={isExpanded ? t('products.filter_hide_label') : t('products.filter_show_label')}
                >
                    <ListFilter size={16} />
                    {isExpanded ? t('products.filter_hide') : t('products.filter_show')}
                </button>
            </div>

            {/* ── FilterBar — colapsable en mobile, siempre visible en md+ ─── */}
            <div className={`${isExpanded ? 'block' : 'hidden'} md:block animate-in fade-in slide-in-from-top-2 duration-200`}>
                <FilterBar onReset={() => { onClearAll(); setIsExpanded(false); }}>

                    {/* Col 1 — Categoría (Master — fuente: product_categories) */}
                    <SelectField
                        label={t('products.filter_category')}
                        value={filters.category}
                        onChange={e => onFilterChange('category', e.target.value)}
                        options={toOptions(filterOptions.categories, t('products.filter_all'))}
                        startIcon={<Tag size={16} />}
                        placeholder={t('products.filter_all')}
                    />

                    {/* Col 2 — Marca (reactiva en cascada) */}
                    <SelectField
                        label={t('products.filter_brand')}
                        value={filters.brand}
                        onChange={e => onFilterChange('brand', e.target.value)}
                        options={toOptions(filterOptions.brands, t('products.filter_all'))}
                        startIcon={<Hash size={16} />}
                        placeholder={t('products.filter_all')}
                        disabled={filterOptions.brands.length === 0}
                    />

                    {/* Col 3 — Calibre (reactivo en cascada) */}
                    <SelectField
                        label={t('products.filter_caliber')}
                        value={filters.caliber}
                        onChange={e => onFilterChange('caliber', e.target.value)}
                        options={toOptions(filterOptions.calibers, t('products.filter_all_m'))}
                        startIcon={<Ruler size={16} />}
                        placeholder={t('products.filter_all_m')}
                        disabled={filterOptions.calibers.length === 0}
                    />

                    {/* Col 4 — Calidad (reactiva en cascada) */}
                    <SelectField
                        label={t('products.filter_quality')}
                        value={filters.quality}
                        onChange={e => onFilterChange('quality', e.target.value)}
                        options={toOptions(filterOptions.qualities, t('products.filter_all'))}
                        startIcon={<ShieldCheck size={16} />}
                        placeholder={t('products.filter_all')}
                        disabled={filterOptions.qualities.length === 0}
                    />

                    {/* Col 5 — Embarque (reactivo en cascada) */}
                    <SelectField
                        label={t('products.filter_shipment')}
                        value={filters.shipmentNumber}
                        onChange={e => onFilterChange('shipmentNumber', e.target.value)}
                        options={toOptions(filterOptions.shipmentNumbers, t('products.filter_all_m'))}
                        startIcon={<Package size={16} />}
                        placeholder={t('products.filter_all_m')}
                        disabled={filterOptions.shipmentNumbers.length === 0}
                    />

                </FilterBar>
            </div>
        </div>
    );
};
