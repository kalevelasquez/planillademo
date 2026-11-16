import React, { useState, useEffect, useRef } from 'react';

import { useAuthStore } from '../../../store/authStore';
import { useOrderStore } from '../../../store/orderStore';
import { useProductStore } from '../../../store/productStore';
import { useDebounce } from '../../../hooks/useDebounce';
import type { FilterState, FilterOptions } from '../../../services/productService';
import { INITIAL_FILTERS, productService } from '../../../services/productService';
import type { Product } from '../../../services/productService';
import { Button } from '../../components/Button';

import { CatalogHeader } from './components/CatalogHeader';
import { TrendingSection } from './components/TrendingSection';
import { ProductGrid } from './components/ProductGrid';
import { FloatingSummary } from './components/FloatingSummary';
import { RepeatOrderBanner } from './components/RepeatOrderBanner';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useOrderCalculations } from './hooks/useOrderCalculations';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDraftAutosave } from '../../../hooks/useDraftAutosave';

// ─────────────────────────────────────────────────────────────────────────────
// CatalogView — Orquestador (Homologación UI v1.0 — 03-Mar-2026)
//
// ARQUITECTURA DE EFFECTS
// ══════════════════════
//
// [Mount Effect]  → productService.getCategories()
//                   Rellena filterOptions.categories (tabla maestra, estática).
//
// [Effect A]  dep: [debouncedSearchTerm]
//                   Reset filtros + fetch base. isResettingRef → Effect B skip.
//
// [Effect B]  dep: [filters]
//                   Fetch con filtros activos. Skip: primer render + reset de A.
//
// [Effect C]  dep: [debouncedSearchTerm, filters.category]
//                   CASCADA: fetch ligero (200) con solo search + category.
//                   Actualiza brand/caliber/quality/shipmentNumber options.
//                   NO depende de brand/caliber/quality → opciones estables.
//
// [Effect E]  dep: [selectedCustomer.id]
//                   Trending por cliente: getTopProductsForCustomer().
//                   INDEPENDIENTE del catálogo — no se recarga al filtrar/buscar.
// ─────────────────────────────────────────────────────────────────────────────

export const CatalogView: React.FC<{ onBack: () => void; onCheckout: () => void }> = ({
    onBack,
    onCheckout,
}) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const {
        selectedCustomer,
        initializeDraft,
        items,
        lastOrderPreview,
        fetchLastOrder,
        duplicateLastOrder,
        clearLastOrderPreview
    } = useOrderStore();
    const { products, isLoading, hasMore, fetchProducts } = useProductStore();

    // ── Estado local ────────────────────────────────────────────────────────
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const [currentPage, setCurrentPage] = useState(1);
    const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);

    const [filterOptions, setFilterOptions] = useState<FilterOptions>({
        categories: [], calibers: [], brands: [], qualities: [], shipmentNumbers: [],
    });
    const [trendingProducts, setTrendingProducts] = useState<Product[]>([]);
    const [trendingLoading, setTrendingLoading] = useState(true);
    const [isConfirmingRepeat, setIsConfirmingRepeat] = useState(false);
    const [isDuplicating, setIsDuplicating] = useState(false);


    // ── Refs de control de flow ───────────────────────────────────────────────
    const isResettingRef = useRef(false);
    const filterEffectMounted = useRef(false);
    const latestSearchRef = useRef('');

    // Clave estable para Effect C — string simple, no array
    const categoryKey = filters.category;

    // ── [Mount Effect] Categorías desde tabla maestra ─────────────────────────
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        productService.getCategories()
            .then(cats => setFilterOptions(prev => ({
                ...prev,
                categories: cats.map(c => c.name),
            })))
            .catch(err => console.error('Error cargando categorías:', err));
    }, []);

    // ── [Effect A] Texto de búsqueda cambia ───────────────────────────────────
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        latestSearchRef.current = debouncedSearchTerm;
        isResettingRef.current = true;
        setCurrentPage(1);
        setFilters(INITIAL_FILTERS);
        fetchProducts(1, debouncedSearchTerm, INITIAL_FILTERS);
    }, [debouncedSearchTerm]);

    // ── [Effect B] Chips/selects de filtro cambian ────────────────────────────
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!filterEffectMounted.current) { filterEffectMounted.current = true; return; }
        if (isResettingRef.current) { isResettingRef.current = false; return; }
        setCurrentPage(1);
        fetchProducts(1, latestSearchRef.current, filters);
    }, [filters]);

    // ── [Effect C] Cascada: opciones reactivas por categoría ───────────────────
    // Dep: [debouncedSearchTerm, categoryKey] — NOT brand/caliber/etc.
    // Garantiza que al cambiar Marca, las demás marcas siguen disponibles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        const categoryOnlyFilters: FilterState = {
            ...INITIAL_FILTERS,
            category: filters.category,
        };
        productService
            .getProducts(1, debouncedSearchTerm, 200, 'active', categoryOnlyFilters)
            .then(({ data }) => {
                if (data.length === 0) return;
                const unique = <T,>(arr: T[]) =>
                    [...new Set(arr)].filter((v): v is T => Boolean(v));
                setFilterOptions(prev => ({
                    ...prev, // Preserva 'categories' (fuente: tabla maestra)
                    brands: unique(data.map(p => p.brand)),
                    calibers: unique(data.map(p => p.caliber)),
                    qualities: unique(data.map(p => p.quality)),
                    shipmentNumbers: unique(data.map(p => p.shipment_number)),
                }));
            })
            .catch(err => console.error('Error cargando opciones de filtros:', err));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearchTerm, categoryKey]);

    // ── [Effect D] Rehidratación de Borrador — dep: selectedCustomer.id ────
    // Recupera el draft existente al seleccionar un cliente para que el carrito flotante
    // muestre el contador correcto y los ítems estén listos en el catalog.
    useEffect(() => {
        if (!selectedCustomer || !profile?.id || !profile?.tenant_id) return;
        initializeDraft(profile.id, selectedCustomer.id, profile.tenant_id);
    }, [selectedCustomer?.id, profile?.id, profile?.tenant_id, initializeDraft]);

    // ── [Effect D2] Cargar preview de último pedido (US-ORD-08) ──────────────
    useEffect(() => {
        const hasItems = Object.keys(items).length > 0;
        if (selectedCustomer && !hasItems) {
            fetchLastOrder(selectedCustomer.id);
        } else {
            clearLastOrderPreview();
        }
    }, [selectedCustomer?.id, items, fetchLastOrder, clearLastOrderPreview]);

    // ── [Effect E] Trending por cliente — dep: selectedCustomer.id ───────────
    // Independiente del catálogo: no se redispara al filtrar ni al buscar.
    // RN-T01: si no hay pedidos históricos, products[] queda vacío → null.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        if (!selectedCustomer) return;
        setTrendingLoading(true);
        productService
            .getTopProductsForCustomer(selectedCustomer.id, 5)
            .then(setTrendingProducts)
            .catch(err => console.error('Trending error:', err))
            .finally(() => setTrendingLoading(false));
    }, [selectedCustomer?.id]);

    // ── Handlers ─────────────────────────────────────────────────────────────

    const handleLoadMore = () => {
        const nextPage = currentPage + 1;
        setCurrentPage(nextPage);
        fetchProducts(nextPage, debouncedSearchTerm, filters);
    };

    /**
     * RN-01: Al cambiar categoría → resetea filtros secundarios a ''.
     * Para marca/calibre/etc: solo actualiza esa clave.
     */
    const handleFilterChange = (key: keyof FilterState, value: string) => {
        setFilters(prev => {
            if (key === 'category') {
                // Cambio de categoría → cascada completa
                return {
                    ...INITIAL_FILTERS,
                    category: value,
                };
            }
            return { ...prev, [key]: value };
        });
    };

    const handleClearFilters = () => setFilters(INITIAL_FILTERS);
    const handleClearSearch = () => setSearchTerm('');

    const handleRepeatLastOrder = async () => {
        if (!lastOrderPreview) return;
        setIsDuplicating(true);
        try {
            await duplicateLastOrder();
            setIsConfirmingRepeat(false);
        } finally {
            setIsDuplicating(false);
        }
    };

    // ── Autosave: Persiste el Borrador (Hook centralizado) ──
    const { isSaving } = useDraftAutosave();

    // ── Cálculos para FloatingSummary (RN-06) ─────────────────────────────────
    const { totalItemsCount: totalItems, subtotal } = useOrderCalculations();


    // ── Guard: sin cliente seleccionado ──────────────────────────────────────
    if (!selectedCustomer) {
        return (
            <div className="flex flex-col items-center justify-center p-xl text-center h-[50vh]">
                <h2 className="text-h2 text-heading mb-xs">{t('catalog.no_customer')}</h2>
                <p className="text-text-secondary text-body mb-lg">
                    {t('catalog.no_customer_desc')}
                </p>
                <Button onClick={onBack} variant="primary">{t('catalog.back_to_customers')}</Button>
            </div>
        );
    }

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div className={`flex flex-col gap-lg animate-in fade-in duration-300 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 ${totalItems > 0 ? 'pb-28' : 'pb-4'}`}>

            {/* 1. Header card unificado (búsqueda + filtros) */}
            <CatalogHeader
                customer={selectedCustomer}
                searchTerm={searchTerm}
                totalItems={totalItems}
                onSearchChange={setSearchTerm}
                onClearSearch={handleClearSearch}
                onBack={onBack}
                onCheckout={onCheckout}
                filters={filters}
                filterOptions={filterOptions}
                onFilterChange={handleFilterChange}
                onClearAll={handleClearFilters}
                isSaving={isSaving}
            />

            {/* 2. Banner de Repetir Pedido (US-ORD-08) */}
            {lastOrderPreview && Object.keys(items).length === 0 && (
                <RepeatOrderBanner
                    order={lastOrderPreview}
                    onRepeat={() => setIsConfirmingRepeat(true)}
                    onDismiss={clearLastOrderPreview}
                />
            )}

            <ConfirmModal
                isOpen={isConfirmingRepeat}
                onClose={() => setIsConfirmingRepeat(false)}
                onConfirm={handleRepeatLastOrder}
                title={t('catalog.repeat_confirm_title', { number: lastOrderPreview?.order_number })}
                message={t('catalog.repeat_confirm_msg')}
                confirmLabel={t('catalog.repeat_confirm_btn')}
                Icon={RefreshCw}
                isLoading={isDuplicating}
            />

            {/* 3. Trending — historial real del cliente (Effect E / RN-T03) */}
            <TrendingSection
                products={trendingProducts}
                isLoading={trendingLoading}
            />

            {/* 4. Spinner de carga inicial */}
            {isLoading && currentPage === 1 ? (
                <div className="bg-white rounded-lg shadow-cards border border-border p-xl flex flex-col items-center justify-center">
                    <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-sm" />
                    <p className="text-caption text-text-secondary">{t('catalog.loading_catalog')}</p>
                </div>
            ) : (
                <ProductGrid
                    products={products}
                    isLoading={isLoading}
                    hasMore={hasMore}
                    searchTerm={searchTerm}
                    isFiltered={JSON.stringify(filters) !== JSON.stringify(INITIAL_FILTERS)}
                    onLoadMore={handleLoadMore}
                    onClearSearch={handleClearSearch}
                />
            )}

            {/* 5. Floating Summary CA8 */}
            <FloatingSummary
                totalItems={totalItems}
                subtotal={subtotal}
                onCheckout={onCheckout}
            />
        </div>
    );
};
