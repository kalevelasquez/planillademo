import React, { useState, useEffect } from 'react';
import { UploadCloud, CheckCircle2, AlertCircle, X, Download, FileSpreadsheet, Package, ChevronLeft, ChevronRight, Search, ShieldAlert, History, Eye, EyeOff, Edit3, Check, PackagePlus } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { useToast } from '../../../context/ToastContext';
import { productService, INITIAL_FILTERS } from '../../../services/productService';
import type { Product, InventoryImportRecord } from '../../../services/productService';
import { exportQuarantineToExcel, exportToExcel } from '../../../utils/exportUtils';
import { QuarantineEditModal } from './components/QuarantineEditModal';
import { QuarantineTable } from './components/QuarantineTable';
import { QuarantineCards } from './components/QuarantineCards';
import { ProductHistoryModal } from './components/ProductHistoryModal';
import { AddProductModal } from './components/AddProductModal';
import { useQuarantine } from './hooks/useQuarantine';
import { Button } from '../../components/Button';
import { Banner } from '../../components/Banner';
import { EXCEL_HEADERS } from '../../../config/constants';
import { useInventoryImport } from './useInventoryImport';
import { useDebounce } from '../../../hooks/useDebounce';
import { PageHeader } from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';

export const ProductManagementView: React.FC = () => {
    const { t } = useTranslation();
    const { profile, permissions } = useAuthStore();
    const canAddProduct = permissions.find(p => p.resource === 'inventario')?.can_create ?? false;
    const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
    const [localProducts, setLocalProducts] = useState<Product[]>([]);
    const [storeLoading, setStoreLoading] = useState(false);
    const [isFetchingMore, setIsFetchingMore] = useState(false);

    const { processImport, isImporting, importProgress } = useInventoryImport();

    const { showToast } = useToast();
    const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<'active' | 'quarantine' | 'history'>('active');
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 500);

    // CA3/CA4: Modal de resumen post-importación
    const [showImportSummaryModal, setShowImportSummaryModal] = useState(false);
    const [importSummary, setImportSummary] = useState<{
        totalRows: number;
        successCount: number;
        errorCount: number;
        errors: string[];
        newCount?: number;
        updatedCount?: number;
        versionId?: string;
    } | null>(null);

    const {
        quarantineItems,
        quarantineEdits,
        quarantineFieldErrors,
        isPromoting,
        editingQuarantineId,
        setEditingQuarantineId,
        isQuarantineLoading,
        quarantineDBCount,
        handleQuarantineEdit,
        handlePromote,
        injectQuarantineItems
    } = useQuarantine({
        tenantId: profile?.tenant_id,
        activeTab,
        showToast,
        onPromoteSuccess: () => loadProducts(page, ['active', 'incomplete', 'unavailable'], debouncedSearchTerm) // Auto-refresh inventory
    });

    // Paginación
    const [page, setPage] = useState(1);
    const [totalCount, setTotalCount] = useState(0);
    const [activeCount, setActiveCount] = useState(0);
    const [limit, setLimit] = useState(20);
    const PAGE_SIZE_OPTIONS = [20, 50, 100, 200];

    const [editingProductId, setEditingProductId] = useState<string | null>(null);
    const [tempStockValue, setTempStockValue] = useState<number>(0);
    const [isSavingStock, setIsSavingStock] = useState(false);

    // US-INV-04: Estados para Edición Inline de Precio
    const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
    const [tempPriceValue, setTempPriceValue] = useState<number>(0);
    const [isSavingPrice, setIsSavingPrice] = useState(false);

    const [selectedHistoryProduct, setSelectedHistoryProduct] = useState<Product | null>(null);
    const [isExportingInventory, setIsExportingInventory] = useState(false);
    const totalPages = Math.ceil(totalCount / limit) || 1;

    const loadInventoryCounts = async () => {
        if (!profile?.tenant_id) return;
        try {
            const stats = await productService.getInventoryStats(profile.tenant_id);
            setActiveCount(stats.activeCount);

            // Si la vista acaba de montar y no hemos importado nada localmente, 
            // llenamos la alerta de cuarentena desde la BD para que no desaparezca al refrescar
            if (stats.latestQuarantineData && quarantineItems.length === 0) {
                injectQuarantineItems(stats.latestQuarantineData);
            }
        } catch (error) {
            console.error('Error fetching inventory stats', error);
        }
    };

    const loadProducts = async (currentPage: number, tabStatus: string | string[], sTerm: string = '', isLoadMore = false, currentLimit = limit) => {
        if (isLoadMore) {
            setIsFetchingMore(true);
        } else {
            setStoreLoading(true);
        }
        try {
            // Pasamos INITIAL_FILTERS y excludeHistorical (verdadero si estamos en el tab activo o incluyendo la lista principal)
            const isMainCatalog = Array.isArray(tabStatus) ? tabStatus.includes('active') : tabStatus === 'active';
            const { data, count } = await productService.getProducts(currentPage, sTerm, currentLimit, tabStatus, INITIAL_FILTERS, isMainCatalog);
            if (isLoadMore) {
                setLocalProducts(prev => {
                    const existingIds = new Set(prev.map(p => p.id));
                    const newItems = data.filter(d => !existingIds.has(d.id));
                    return [...prev, ...newItems];
                });
            } else {
                setLocalProducts(data);
            }
            setTotalCount(count);
        } catch (error) {
            console.error('Error fetching products', error);
        } finally {
            setStoreLoading(false);
            setIsFetchingMore(false);
        }
    };

    // Al cambiar el término de búsqueda o el límite, reseteamos a página 1
    useEffect(() => {
        setPage(1);
    }, [debouncedSearchTerm, limit]);

    // Initial Fetch for Master Inventory Stats
    useEffect(() => {
        loadInventoryCounts();
    }, [profile?.tenant_id]);

    useEffect(() => {
        if (activeTab === 'active') {
            loadProducts(page, ['active', 'incomplete', 'unavailable'], debouncedSearchTerm, false, limit);
        }
    }, [page, activeTab, profile?.tenant_id, debouncedSearchTerm, limit]);

    // CA8: Historial de importaciones
    const [importHistory, setImportHistory] = useState<InventoryImportRecord[]>([]);
    const [isHistoryLoading, setIsHistoryLoading] = useState(false);

    const loadImportHistory = async () => {
        if (!profile?.tenant_id) return;
        setIsHistoryLoading(true);
        try {
            const records = await productService.getImportHistory(profile.tenant_id);
            setImportHistory(records);
        } catch (err) {
            console.error('Error cargando historial de importaciones:', err);
            showToast(t('products.error_loading_history'), 'error');
        } finally {
            setIsHistoryLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'history') loadImportHistory();
    }, [activeTab, profile?.tenant_id]);



    const handleDownloadTemplate = async () => {
        const { utils, writeFile } = await import('xlsx');
        const dummyData = [
            {
                [EXCEL_HEADERS.PRODUCTO]: 'Manzana Gala',
                [EXCEL_HEADERS.CALIBRE]: '100s',
                [EXCEL_HEADERS.MARCA]: 'Washington',
                [EXCEL_HEADERS.CALIDAD]: 'CAT 1',
                [EXCEL_HEADERS.EMBARQUE]: 'EMB-001',
                [EXCEL_HEADERS.INGRESO]: '2026-02-25',
                [EXCEL_HEADERS.DIAS_EN_BODEGA]: 13,   // CA2: referencia visual para el usuario
                [EXCEL_HEADERS.INVENTARIO]: 500,
                [EXCEL_HEADERS.PRECIO]: 1.50,
                [EXCEL_HEADERS.CATEGORIA]: 'Frutas'
            },
            {
                [EXCEL_HEADERS.PRODUCTO]: 'Uva Red Globe',
                [EXCEL_HEADERS.CALIBRE]: 'L',
                [EXCEL_HEADERS.MARCA]: 'Campos del Sur',
                [EXCEL_HEADERS.CALIDAD]: 'Premium',
                [EXCEL_HEADERS.EMBARQUE]: 'EMB-002',
                [EXCEL_HEADERS.INGRESO]: '2026-02-26',
                [EXCEL_HEADERS.DIAS_EN_BODEGA]: 12,   // CA2: referencia visual para el usuario
                [EXCEL_HEADERS.INVENTARIO]: 300,
                [EXCEL_HEADERS.PRECIO]: 2.80,
                [EXCEL_HEADERS.CATEGORIA]: 'Uvas'
            }
        ];

        const worksheet = utils.json_to_sheet(dummyData);
        // Custom column widths — 10 columnas ahora (incluye DÍAS EN BODEGA)
        worksheet['!cols'] = [
            { wch: 25 }, { wch: 10 }, { wch: 20 }, { wch: 15 }, { wch: 15 },
            { wch: 15 }, { wch: 18 }, { wch: 15 }, { wch: 15 }, { wch: 20 }
        ];

        const workbook = utils.book_new();
        utils.book_append_sheet(workbook, worksheet, 'Lotes_ImporFrut');

        writeFile(workbook, 'PlantillaBase_Lotes.xlsx');

        setIsTemplateModalOpen(false);
    };

    const handleExportInventory = async () => {
        if (!profile?.tenant_id) return;
        setIsExportingInventory(true);
        try {
            // Obtener todos los productos para exportar (maneja paginación interna para >1000 items)
            const data = await productService.getAllProductsForExport(['active', 'incomplete', 'unavailable']);

            if (data.length === 0) {
                showToast(t('products.no_products_export'), 'info');
                return;
            }

            const exportData = data.map(p => ({
                [EXCEL_HEADERS.PRODUCTO]: p.name,
                [EXCEL_HEADERS.CATEGORIA]: p.category,
                [EXCEL_HEADERS.MARCA]: p.brand,
                [EXCEL_HEADERS.CALIBRE]: p.caliber,
                [EXCEL_HEADERS.CALIDAD]: p.quality,
                [EXCEL_HEADERS.EMBARQUE]: p.shipment_number,
                [EXCEL_HEADERS.INGRESO]: p.entry_date || 'N/A',
                [EXCEL_HEADERS.DIAS_EN_BODEGA]: calcDaysInStorage(p.entry_date),
                [EXCEL_HEADERS.INVENTARIO]: p.available_quantity,
                [EXCEL_HEADERS.PRECIO]: p.price,
                'SKU': p.sku_sintetico || ''
            }));

            const fileName = `Inventario_Completo_${new Date().toISOString().split('T')[0]}`;
            await exportToExcel(exportData, fileName, 'Inventario');

            showToast(t('products.export_success'), 'success');

            import('../../../services/auditService').then(({ auditService }) => {
                auditService.logAction('EXPORT', 'inventory_excel');
            });
        } catch (err) {
            console.error('Error exporting inventory:', err);
            showToast(t('products.export_error'), 'error');
        } finally {
            setIsExportingInventory(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // CA1: Validar tamaño antes de intentar parsear (evita crash del hilo con xlsx)
        const MAX_SIZE_MB = 10;
        const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
        if (file.size > MAX_SIZE_BYTES) {
            showToast(
                `Error: El archivo excede el límite de ${MAX_SIZE_MB} MB. Por favor, seleccione un archivo con un peso menor.`,
                'error'
            );
            e.target.value = '';
            return;
        }

        const result = await processImport(file);

        // Reset file input
        e.target.value = '';

        if (result.success) {
            // CA3/CA4: Mostrar modal de resumen en lugar de solo Toast
            setImportSummary({
                totalRows: result.totalRows ?? 0,
                successCount: result.successCount ?? 0,
                errorCount: result.errorCount ?? 0,
                errors: result.errors ?? [],
                newCount: result.newCount,
                updatedCount: result.updatedCount,
                versionId: result.versionId,
            });
            setShowImportSummaryModal(true);

            if (result.errorCount && result.errorCount > 0) {
                setActiveTab('quarantine');
            } else {
                injectQuarantineItems([]);
            }

            loadInventoryCounts();
            setPage(1);
            loadProducts(1, ['active', 'incomplete', 'unavailable'], debouncedSearchTerm);

            // Auditoría de Carga (US-AUD-01)
            import('../../../services/auditService').then(({ auditService }) => {
                auditService.logAction('UPLOAD', 'inventory_excel');
            });
        } else {
            showToast(result.message, 'error');
        }
    };

    // US-INV-04: Funciones para Edición Inline
    const handleSaveStock = async (product: Product) => {
        if (tempStockValue === product.available_quantity) {
            setEditingProductId(null);
            return;
        }

        setIsSavingStock(true);
        try {
            const newStatus = 'active';
            // Mantener 'unavailable' si ya estaba así (CA5 manual override: pausado manual)
            const finalStatus = product.status === 'unavailable' ? 'unavailable' : newStatus;

            await productService.updateStock(product.id, tempStockValue, finalStatus);

            // Optimistic update
            setLocalProducts(prev => prev.map(p =>
                p.id === product.id
                    ? { ...p, available_quantity: tempStockValue, status: finalStatus }
                    : p
            ));

            showToast(t('products.success_stock_update'), 'success');
            setEditingProductId(null);
            loadInventoryCounts(); // Refresh counters
        } catch (error) {
            console.error('Error updating stock:', error);
            showToast(t('products.stock_update_error'), 'error');
        } finally {
            setIsSavingStock(false);
        }
    };

    const handleCancelStock = () => {
        setEditingProductId(null);
    };

    const handleSavePrice = async (product: Product) => {
        if (tempPriceValue === product.price) {
            setEditingPriceId(null);
            return;
        }

        setIsSavingPrice(true);
        try {
            await productService.updatePrice(product.id, tempPriceValue);

            // Optimistic update
            setLocalProducts(prev => prev.map(p =>
                p.id === product.id
                    ? { ...p, price: tempPriceValue }
                    : p
            ));

            showToast(t('products.success_price_update'), 'success');
            setEditingPriceId(null);
        } catch (error) {
            console.error('Error updating price:', error);
            showToast(t('products.price_update_error'), 'error');
        } finally {
            setIsSavingPrice(false);
        }
    };

    const handleCancelPrice = () => {
        setEditingPriceId(null);
    };

    const toggleProductAvailability = async (product: Product) => {
        const newStatus = product.status === 'unavailable' ? 'active' : 'unavailable';

        // Optimistic UI Update
        setLocalProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: newStatus } : p));

        try {
            await productService.updateStock(product.id, product.available_quantity, newStatus);
            showToast(t('products.availability_success', { status: t(`products.availability_${newStatus === 'active' ? 'disponible' : 'no_disponible'}`) }), 'success');
            loadInventoryCounts();
        } catch (err) {
            console.error('Toggle availability error:', err);
            showToast(t('products.availability_error'), 'error');
            // Revert on error
            setLocalProducts(prev => prev.map(p => p.id === product.id ? { ...p, status: product.status } : p));
        }
    };

    const filteredProducts = localProducts
        .filter(p => {
            if (!searchTerm) return true;
            const term = searchTerm.toLowerCase();
            return (
                p.name?.toLowerCase().includes(term) ||
                p.brand?.toLowerCase().includes(term) ||
                p.shipment_number?.toLowerCase().includes(term) ||
                p.sku_sintetico?.toLowerCase().includes(term)
            );
        })
        .sort((a, b) => {
            // US-INV-04/US-ORD-10: Criterio de orden maestro solicitado por el usuario: CALIBRE
            const caliberA = a.caliber || 'S/C';
            const caliberB = b.caliber || 'S/C';

            const calCompare = caliberA.localeCompare(caliberB, undefined, { numeric: true });
            if (calCompare !== 0) return calCompare;

            // Secundarios para estabilidad
            const nameCompare = (a.name || '').localeCompare(b.name || '');
            if (nameCompare !== 0) return nameCompare;

            return (a.brand || '').localeCompare(b.brand || '');
        });

    /** CA2 US-INV-01 — Cálculo dinámico desde entry_date. Sin columna extra en DB. */
    const calcDaysInStorage = (entry_date?: string | null): string => {
        if (!entry_date) return t('common.not_available');
        const diff = Math.floor(
            (Date.now() - new Date(entry_date).getTime()) / (1000 * 60 * 60 * 24)
        );
        return t('products.days_label', { count: diff });
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {/* Header Unified */}
            <PageHeader
                icon={Package}
                title={t('products.header_title')}
                description={t('products.header_desc')}
            />

            <div className="flex flex-col sm:flex-row gap-md justify-between items-start sm:items-center">
                {/* Izquierda: Barra de Búsqueda */}
                <div className="relative w-full sm:w-[320px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary w-5 h-5" />
                    <input
                        type="text"
                        placeholder={t('products.search_placeholder')}
                        className="w-full pl-10 pr-4 py-2 border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent bg-white text-body transition-shadow shadow-sm"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                {/* Derecha: Acciones */}
                <div className="flex flex-wrap items-center gap-sm w-full sm:w-auto">
                    {canAddProduct && (
                        <Button
                            onClick={() => setIsAddProductModalOpen(true)}
                            className="flex-1 sm:flex-none flex items-center justify-center gap-2 h-[42px] px-md shadow-sm"
                        >
                            <PackagePlus size={18} />
                            <span className="whitespace-nowrap">Agregar producto</span>
                        </Button>
                    )}
                    <Button
                        onClick={handleExportInventory}
                        isLoading={isExportingInventory}
                        variant="secondary"
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 h-[42px] px-md shadow-sm"
                    >
                        <Download size={18} />
                        <span className="whitespace-nowrap">{t('products.btn_export_all')}</span>
                    </Button>
                    <Button
                        onClick={() => setIsTemplateModalOpen(true)}
                        variant="secondary"
                        className="flex-1 sm:flex-none flex items-center justify-center gap-2 h-[42px] px-md shadow-sm"
                    >
                        <FileSpreadsheet size={18} />
                        <span className="whitespace-nowrap">{t('products.btn_template')}</span>
                    </Button>
                    <div className="relative overflow-hidden flex-1 sm:flex-none min-w-[120px]">
                        <Button
                            isLoading={isImporting}
                            progress={importProgress.total > 0 ? (importProgress.current / importProgress.total) * 100 : 0}
                            loadingMessage={t('loading_sync')}
                            className="w-full flex items-center justify-center gap-2 h-[42px] px-md relative z-10 pointer-events-none shadow-sm"
                        >
                            <UploadCloud size={18} />
                            <span className="whitespace-nowrap">
                                {isImporting ? t('products.importing_progress', { current: importProgress.current, total: importProgress.total }) : t('products.btn_import')}
                            </span>
                        </Button>
                        {!isImporting && (
                            <input
                                type="file"
                                accept=".xlsx, .xls, .csv"
                                title={t('products.btn_import')}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
                                onChange={handleFileUpload}
                            />
                        )}
                    </div>
                </div>
            </div>

            {/* ── Modal Agregar Producto (CA-1..CA-9) ── */}
            {isAddProductModalOpen && (
                <AddProductModal
                    onClose={() => setIsAddProductModalOpen(false)}
                    onSuccess={() => {
                        loadProducts(1, ['active', 'incomplete', 'unavailable'], debouncedSearchTerm);
                        loadInventoryCounts();
                        setPage(1);
                    }}
                />
            )}

            {/* ── Modal Resumen de Importación (CA3/CA4) ── */}
            {showImportSummaryModal && importSummary && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white rounded-xl shadow-modals w-[90vw] md:w-[560px] max-w-full flex flex-col overflow-hidden max-h-[85vh] animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex justify-between items-center px-lg py-md border-b border-border bg-surface/50">
                            <div className="flex items-center gap-sm">
                                {importSummary.errorCount === 0
                                    ? <CheckCircle2 size={22} className="text-success" />
                                    : <AlertCircle size={22} className="text-warning" />}
                                <h2 className="text-h2 text-heading">{t('products.modal_import_title')}</h2>
                                {importSummary.versionId && (
                                    <span className="text-[10px] font-mono bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20">
                                        {t('products.modal_import_version')} #{importSummary.versionId}
                                    </span>
                                )}
                            </div>
                            <button
                                onClick={() => setShowImportSummaryModal(false)}
                                className="p-xs text-text-secondary hover:bg-white hover:text-error rounded-sm transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Cuerpo */}
                        <div className="p-lg overflow-y-auto flex flex-col gap-md">
                            {/* Métricas */}
                            <div className="grid grid-cols-3 gap-sm">
                                <div className="flex flex-col items-center p-sm bg-surface rounded-lg border border-border">
                                    <span className="text-[11px] uppercase tracking-wider text-text-secondary font-semibold mb-1">{t('products.import_rows_total')}</span>
                                    <span className="text-2xl font-display font-bold text-heading">{importSummary.totalRows}</span>
                                </div>
                                <div className="flex flex-col items-center p-sm bg-success/5 rounded-lg border border-success/20">
                                    <span className="text-[11px] uppercase tracking-wider text-success font-semibold mb-1">{t('products.import_rows_synced')}</span>
                                    <span className="text-2xl font-display font-bold text-success">{importSummary.successCount}</span>
                                </div>
                                <div className="flex flex-col items-center p-sm bg-error/5 rounded-lg border border-error/20">
                                    <span className="text-[11px] uppercase tracking-wider text-error font-semibold mb-1">{t('products.import_rows_errors')}</span>
                                    <span className="text-2xl font-display font-bold text-error">{importSummary.errorCount}</span>
                                </div>
                            </div>

                            {/* Resumen de cambios (US-INV-02 CA1) */}
                            {(importSummary.newCount !== undefined || importSummary.updatedCount !== undefined) && (
                                <div className="flex gap-md py-sm px-md bg-surface border border-dashed border-border rounded-lg justify-center">
                                    <div className="text-center">
                                        <div className="text-[10px] text-text-secondary uppercase font-bold">{t('products.import_rows_new')}</div>
                                        <div className="text-lg font-bold text-heading">{importSummary.newCount || 0}</div>
                                    </div>
                                    <div className="w-[1px] bg-border my-1"></div>
                                    <div className="text-center">
                                        <div className="text-[10px] text-text-secondary uppercase font-bold">{t('products.import_rows_updated')}</div>
                                        <div className="text-lg font-bold text-heading">{importSummary.updatedCount || 0}</div>
                                    </div>
                                </div>
                            )}

                            {/* Errores detallados (CA4) */}
                            {importSummary.errors.length > 0 && (
                                <div className="flex flex-col gap-xs">
                                    <p className="text-caption font-semibold text-error flex items-center gap-1">
                                        <AlertCircle size={14} />
                                        {t('products.quarantine_notice', { count: importSummary.errorCount })}
                                    </p>
                                    <div className="max-h-48 overflow-y-auto flex flex-col gap-1 pr-1">
                                        {importSummary.errors.map((err, i) => (
                                            <div key={i} className="text-[12px] text-error/80 bg-error/5 border border-error/15 rounded px-sm py-1">
                                                {err}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {importSummary.errorCount === 0 && (
                                <p className="text-body text-success text-center font-medium">
                                    ✅ {t('products.import_success_all')}
                                </p>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-lg py-md border-t border-border flex justify-end gap-sm">
                            {importSummary.errorCount > 0 && (
                                <button
                                    onClick={() => { setShowImportSummaryModal(false); setActiveTab('quarantine'); }}
                                    className="px-md py-sm text-caption font-semibold text-warning-dark border border-warning/40 rounded-lg hover:bg-warning/5 transition-colors"
                                >
                                    {t('products.btn_view_quarantine')}
                                </button>
                            )}
                            <button
                                onClick={() => setShowImportSummaryModal(false)}
                                className="px-md py-sm text-caption font-semibold bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
                            >
                                {t('products.btn_understand')}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Plantilla */}
            {isTemplateModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white rounded-lg shadow-modals w-[90vw] md:w-[600px] max-w-full flex flex-col overflow-hidden max-h-[90vh] scale-100 animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header Modal */}
                        <div className="flex justify-between items-center px-lg py-md border-b border-border bg-surface/50">
                            <h2 className="text-h2 text-heading flex items-center gap-sm">
                                <Download size={24} className="text-primary" />
                                {t('products.modal_template_title')}
                            </h2>
                            <button
                                onClick={() => setIsTemplateModalOpen(false)}
                                className="p-xs text-text-secondary hover:bg-white hover:text-error rounded-sm transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Body Modal */}
                        <div className="p-lg overflow-y-auto">
                            <p className="text-body text-text-secondary mb-md">
                                {t('products.modal_template_desc')}
                            </p>

                            <ul className="text-body text-text-secondary flex flex-col gap-sm bg-surface p-md rounded-md border border-border mb-lg">
                                <li className="flex gap-sm items-start">
                                    <CheckCircle2 size={18} className="text-success shrink-0 mt-[2px]" />
                                    <span>{t('products.template_rule_key')}</span>
                                </li>
                                <li className="flex gap-sm items-start">
                                    <CheckCircle2 size={18} className="text-success shrink-0 mt-[2px]" />
                                    <span>{t('products.template_rule_category')}</span>
                                </li>
                                <li className="flex gap-sm items-start">
                                    <AlertCircle size={18} className="text-warning shrink-0 mt-[2px]" />
                                    <span>{t('products.template_rule_quarantine')}</span>
                                </li>
                            </ul>

                            <div className="flex justify-end pt-md border-t border-border">
                                <Button
                                    onClick={() => handleDownloadTemplate()}
                                    className="flex items-center justify-center gap-xs shadow-md"
                                >
                                    <FileSpreadsheet size={18} />
                                    {t('products.btn_download_xlsx')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Inventario Maestro y Cuarentena */}
            <div className="mt-2xl flex flex-col pb-2xl">
                {/* Tabs UI - Estilo Pestaña (Folder) */}
                <div className="flex items-end gap-1 pl-md relative z-10 w-full mx-auto overflow-x-auto [&::-webkit-scrollbar]:hidden">
                    <button
                        onClick={() => { setActiveTab('active'); setPage(1); loadProducts(1, ['active', 'incomplete', 'unavailable'], debouncedSearchTerm, false); }}
                        className={`px-4 py-2 md:px-lg md:py-sm text-sm md:text-base whitespace-nowrap shrink-0 font-semibold flex items-center gap-xs transition-colors border-t border-l border-r rounded-t-lg -mb-px ${activeTab === 'active'
                            ? 'bg-white border-border border-b-white text-primary z-10'
                            : 'bg-surface border-transparent border-b-border text-text-secondary hover:text-heading hover:bg-gray-50 z-0'
                            }`}
                    >
                        <Package size={20} className="w-4 h-4 md:w-5 md:h-5" />
                        <span className="hidden md:inline">{t('products.tab_active')}</span>
                        <span className={`ml-xs text-[10px] md:text-caption px-2 py-0.5 rounded-full ${activeTab === 'active' ? 'bg-primary/10 text-primary-dark' : 'bg-border/50 text-text-secondary'}`}>
                            {activeCount}
                        </span>
                    </button>

                    {(quarantineItems.length > 0 || quarantineDBCount > 0) && (
                        <button
                            onClick={() => { setActiveTab('quarantine'); }}
                            className={`px-4 py-2 md:px-lg md:py-sm text-sm md:text-base whitespace-nowrap shrink-0 font-semibold flex items-center gap-xs transition-colors border-t border-l border-r rounded-t-lg -mb-px ${activeTab === 'quarantine'
                                ? 'bg-white border-border border-b-white text-warning-dark z-10'
                                : 'bg-surface border-transparent border-b-border text-text-secondary hover:text-heading hover:bg-gray-50 z-0'
                                }`}
                        >
                            <ShieldAlert size={20} className="w-4 h-4 md:w-5 md:h-5" />
                            <span className="hidden md:inline">{t('products.tab_quarantine')}</span>
                            <span className={`ml-xs text-[10px] md:text-caption px-2 py-0.5 rounded-full ${activeTab === 'quarantine' ? 'bg-warning/20 text-warning-dark' : 'bg-border/50 text-text-secondary'}`}>
                                {quarantineItems.length > 0 ? quarantineItems.length : quarantineDBCount}
                            </span>
                        </button>
                    )}

                    {/* Tab: Historial de Importaciones (CA8) */}
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`px-4 py-2 md:px-lg md:py-sm text-sm md:text-base whitespace-nowrap shrink-0 font-semibold flex items-center gap-xs transition-colors border-t border-l border-r rounded-t-lg -mb-px ${activeTab === 'history'
                            ? 'bg-white border-border border-b-white text-primary z-10'
                            : 'bg-surface border-transparent border-b-border text-text-secondary hover:text-heading hover:bg-gray-50 z-0'
                            }`}
                    >
                        <History size={20} className="w-4 h-4 md:w-5 md:h-5" />
                        <span className="hidden md:inline">{t('products.tab_history')}</span>
                    </button>
                </div>

                {activeTab === 'history' ? (
                    /* ── Vista: Historial de Importaciones (CA8) ── */
                    <div className="bg-white rounded-lg shadow-cards border border-border mt-0 relative z-0 animate-in fade-in duration-300">
                        <div className="flex items-center justify-between px-lg py-md border-b border-border">
                            <div>
                                <h2 className="text-h3 font-semibold text-heading flex items-center gap-sm">
                                    <History size={18} className="text-primary" />
                                    {t('products.history_title')}
                                </h2>
                                <p className="text-caption text-text-secondary mt-1">{t('products.history_desc')}</p>
                            </div>
                            <button
                                onClick={loadImportHistory}
                                disabled={isHistoryLoading}
                                className="text-caption text-primary hover:underline disabled:opacity-50 flex items-center gap-1"
                            >
                                {isHistoryLoading ? t('common.loading') : `↻ ${t('products.btn_refresh_history')}`}
                            </button>
                        </div>

                        {isHistoryLoading ? (
                            <div className="p-xl flex items-center justify-center gap-sm text-text-secondary">
                                <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
                                <span className="text-caption">{t('products.history_loading')}</span>
                            </div>
                        ) : importHistory.length === 0 ? (
                            <div className="p-xl text-center">
                                <History size={40} className="mx-auto text-text-secondary/20 mb-sm" />
                                <p className="text-body text-text-secondary">{t('products.history_empty')}</p>
                            </div>
                        ) : (
                            <>
                                {/* Desktop Table */}
                                <div className="hidden md:block overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-surface border-b border-border text-caption text-text-secondary uppercase tracking-wider">
                                                <th className="px-lg py-sm font-semibold">{t('products.history_table_version')}</th>
                                                <th className="px-lg py-sm font-semibold">{t('products.history_table_date')}</th>
                                                <th className="px-lg py-sm font-semibold">{t('products.history_table_user')}</th>
                                                <th className="px-lg py-sm font-semibold">{t('products.history_table_file')}</th>
                                                <th className="px-lg py-sm font-semibold">{t('products.history_table_summary')}</th>
                                                <th className="px-lg py-sm font-semibold text-center text-error">{t('products.history_table_errors')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {importHistory.map(record => (
                                                <tr key={record.id} className="hover:bg-surface/50 transition-colors">
                                                    <td className="px-lg py-sm">
                                                        <span className="font-mono text-[10px] bg-primary/5 text-primary border border-primary/10 px-1.5 py-0.5 rounded">
                                                            #{record.id.substring(0, 8).toUpperCase()}
                                                        </span>
                                                    </td>
                                                    <td className="px-lg py-sm text-caption text-text-secondary whitespace-nowrap">
                                                        {new Date(record.created_at).toLocaleString('es-GT', {
                                                            dateStyle: 'medium', timeStyle: 'short'
                                                        })}
                                                    </td>
                                                    <td className="px-lg py-sm text-sm text-heading">{record.created_by_name}</td>
                                                    <td className="px-lg py-sm max-w-[180px]">
                                                        <span
                                                            className="text-xs font-mono text-primary truncate block"
                                                            title={record.file_name}
                                                        >
                                                            {record.file_name}
                                                        </span>
                                                    </td>
                                                    <td className="px-lg py-sm">
                                                        <div className="flex flex-col gap-0.5">
                                                            <div className="text-[10px] text-text-secondary flex justify-between gap-2">
                                                                <span>{t('products.import_rows_new')}:</span>
                                                                <span className="font-bold text-heading">{record.metadata?.new_count || 0}</span>
                                                            </div>
                                                            <div className="text-[10px] text-text-secondary flex justify-between gap-2">
                                                                <span>{t('products.import_rows_updated')}:</span>
                                                                <span className="font-bold text-heading">{record.metadata?.updated_count || 0}</span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-lg py-sm text-center">
                                                        <span className={`font-semibold ${record.error_count > 0 ? 'text-error' : 'text-text-secondary'}`}>
                                                            {record.error_count}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {/* Mobile Cards */}
                                <div className="md:hidden flex flex-col divide-y divide-border/50">
                                    {importHistory.map(record => (
                                        <div key={record.id} className="px-md py-sm flex flex-col gap-xs">
                                            <div className="flex justify-between items-start">
                                                <span className="font-mono text-[11px] text-primary truncate max-w-[60%]" title={record.file_name}>
                                                    {record.file_name}
                                                </span>
                                                <span className="text-[10px] text-text-secondary whitespace-nowrap">
                                                    {new Date(record.created_at).toLocaleDateString('es-GT')}
                                                </span>
                                            </div>
                                            <div className="text-caption text-text-secondary">{record.created_by_name}</div>
                                            <div className="flex gap-md text-caption mt-1">
                                                <span className="text-text-secondary">Total: <strong>{record.row_count}</strong></span>
                                                <span className="text-success">✓ {record.success_count}</span>
                                                <span className={record.error_count > 0 ? 'text-error' : 'text-text-secondary'}>
                                                    ✗ {record.error_count}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                ) : storeLoading ? (
                    <div className="bg-white rounded-lg shadow-cards border border-border p-xl flex flex-col items-center justify-center animate-pulse h-64 mt-0 relative z-0">
                        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-sm"></div>
                        <p className="text-caption text-text-secondary">{t('products.loading_db')}</p>
                    </div>
                ) : filteredProducts.length === 0 ? (
                    <div className="bg-white rounded-lg shadow-cards border border-border p-xl flex flex-col items-center justify-center text-center mt-0 relative z-0">
                        <Package size={48} className="text-text-secondary/30 mb-sm" />
                        <h3 className="text-h3 text-heading">{t('products.no_records')}</h3>
                        <p className="text-body text-text-secondary mt-xs">
                            {activeTab === 'active' ? t('products.no_active_lots') : t('products.no_quarantine_items')}
                        </p>
                    </div>
                ) : activeTab === 'quarantine' ? (
                    <div className="bg-white rounded-lg shadow-cards border border-warning/30 mt-0 relative z-0 animate-in fade-in duration-300">
                        <div className="p-sm">
                            <Banner
                                variant="warning"
                                title={t('products.quarantine_rejected_title')}
                                description={t('products.quarantine_rejected_desc')}
                                action={
                                    <Button
                                        variant="warning"
                                        className="flex items-center gap-2"
                                        onClick={() => exportQuarantineToExcel(quarantineItems)}
                                    >
                                        <FileSpreadsheet size={16} />
                                        {t('products.btn_download_excel')}
                                    </Button>
                                }
                            />
                        </div>

                        {/* Desktop View: Quarantine Table */}
                        <QuarantineTable
                            quarantineItems={quarantineItems}
                            quarantineEdits={quarantineEdits}
                            quarantineFieldErrors={quarantineFieldErrors}
                            isQuarantineLoading={isQuarantineLoading}
                            onEditClick={setEditingQuarantineId}
                        />

                        {/* Mobile View: Quarantine Cards */}
                        <QuarantineCards
                            quarantineItems={quarantineItems}
                            quarantineEdits={quarantineEdits}
                            quarantineFieldErrors={quarantineFieldErrors}
                            isQuarantineLoading={isQuarantineLoading}
                            onEditClick={setEditingQuarantineId}
                        />
                    </div>
                ) : (
                    <>
                        {/* Mobile View: Cards Container */}
                        <div className="grid grid-cols-1 gap-md lg:hidden mt-0 relative z-0">
                            {filteredProducts.map(p => (
                                <div key={p.id} className="bg-white rounded-lg shadow-cards border border-border p-md flex flex-col gap-sm">
                                    <div className="flex justify-between items-start gap-2">
                                        <div className="flex-1 min-w-0">
                                            <h3 className={`text-h3 font-display transition-colors ${p.status === 'unavailable' ? 'text-text-secondary opacity-60' : 'text-heading'}`}>
                                                {p.name}
                                            </h3>
                                            <div className="flex items-center gap-xs mt-1">
                                                <span className="font-mono text-[11px] text-text-secondary bg-surface px-1.5 py-0.5 rounded border border-border">{p.sku_sintetico || 'PENDIENTE'}</span>
                                                {p.status === 'unavailable' && (
                                                    <span className="text-[10px] font-bold text-error bg-error/10 px-1.5 py-0.5 rounded">{t('catalog.unavailable_badge')}</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-2 shrink-0">
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setSelectedHistoryProduct(p)}
                                                    className="p-1.5 rounded-full transition-colors bg-surface text-text-secondary hover:text-primary hover:bg-primary/10 border border-border"
                                                    title={t('products.action_view_history')}
                                                >
                                                    <History size={18} />
                                                </button>
                                                <button
                                                    onClick={() => toggleProductAvailability(p)}
                                                    className={`p-1.5 rounded-full transition-colors ${p.status === 'unavailable' ? 'bg-error/10 text-error hover:bg-error/20' : 'bg-success/10 text-success hover:bg-success/20'}`}
                                                    title={p.status === 'unavailable' ? t('products.action_available') : t('products.action_unavailable')}
                                                >
                                                    {p.status === 'unavailable' ? <EyeOff size={18} /> : <Eye size={18} />}
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                {editingProductId === p.id ? (
                                                    <div className="flex items-center gap-1">
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            autoFocus
                                                            className="w-16 p-1 text-xs border border-primary rounded text-center focus:outline-none focus:ring-1 focus:ring-primary font-bold bg-white"
                                                            value={tempStockValue}
                                                            onChange={e => setTempStockValue(Number(e.target.value))}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') handleSaveStock(p);
                                                                if (e.key === 'Escape') handleCancelStock();
                                                            }}
                                                        />
                                                        <button
                                                            onClick={() => handleSaveStock(p)}
                                                            disabled={isSavingStock}
                                                            className="p-1 bg-success text-white rounded-full hover:bg-success-dark transition-colors"
                                                            title={t('common.save')}
                                                        >
                                                            <Check size={14} />
                                                        </button>
                                                        <button
                                                            onClick={handleCancelStock}
                                                            disabled={isSavingStock}
                                                            className="p-1 bg-surface text-text-secondary rounded-full hover:bg-gray-200 transition-colors"
                                                            title={t('common.cancel')}
                                                        >
                                                            <X size={14} />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <span className={`font-bold ${p.available_quantity === 0 ? 'text-error' : 'text-heading'}`}>
                                                            {p.available_quantity} <span className="text-[10px] font-normal text-text-secondary">{t('products.unit_label')}</span>
                                                        </span>
                                                        <button
                                                            onClick={() => {
                                                                setEditingProductId(p.id);
                                                                setTempStockValue(p.available_quantity);
                                                            }}
                                                            className="p-1 text-text-secondary hover:text-primary hover:bg-primary/5 rounded transition-colors"
                                                            title={t('products.edit_stock_title')}
                                                        >
                                                            <Edit3 size={14} />
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-xs text-caption text-text-secondary mt-xs bg-surface p-sm rounded-md border border-border/50">
                                        <div className="flex justify-between">
                                            <span className="font-medium text-heading">{t('products.label_shipment')}:</span>
                                            <span className="font-mono text-primary font-bold">{p.shipment_number}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="font-medium text-heading">{t('products.label_brand')}:</span>
                                            <span>{p.brand}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="font-medium text-heading">{t('products.label_quality')}:</span>
                                            <span>{p.quality}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="font-medium text-heading">{t('products.label_category')}:</span>
                                            <span className="capitalize">{p.category || t('products.other_category')}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="font-medium text-heading">{t('products.label_caliber')}:</span>
                                            <span>{p.caliber || '-'}</span>
                                        </div>
                                        {p.entry_date && (
                                            <div className="flex justify-between">
                                                <span className="font-medium text-heading">{t('products.label_entry')}:</span>
                                                <span>{p.entry_date}</span>
                                            </div>
                                        )}
                                        <div className="flex justify-between">
                                            <span className="font-medium text-heading">{t('products.label_in_storage')}:</span>
                                            <span className="font-semibold text-warning-dark">{calcDaysInStorage(p.entry_date)}</span>
                                        </div>
                                    </div>

                                    <div className="mt-xs pt-sm border-t border-border/50 flex justify-between items-center">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] uppercase text-text-secondary">{t('products.label_base_price')}</span>
                                            {editingPriceId === p.id ? (
                                                <div className="flex items-center gap-1 mt-1">
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        min="0"
                                                        autoFocus
                                                        className="w-20 p-1 text-xs border border-primary rounded text-center focus:outline-none focus:ring-1 focus:ring-primary font-bold bg-white"
                                                        value={tempPriceValue}
                                                        onChange={e => setTempPriceValue(Number(e.target.value))}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') handleSavePrice(p);
                                                            if (e.key === 'Escape') handleCancelPrice();
                                                        }}
                                                    />
                                                    <button
                                                        onClick={() => handleSavePrice(p)}
                                                        disabled={isSavingPrice}
                                                        className="p-1 bg-success text-white rounded-full hover:bg-success-dark transition-colors"
                                                    >
                                                        <Check size={14} />
                                                    </button>
                                                    <button
                                                        onClick={handleCancelPrice}
                                                        disabled={isSavingPrice}
                                                        className="p-1 bg-surface text-text-secondary rounded-full hover:bg-gray-200 transition-colors"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2">
                                                    <span className="font-display font-bold text-primary">${Number(p.price || 0).toFixed(2)}</span>
                                                    <button
                                                        onClick={() => {
                                                            setEditingPriceId(p.id);
                                                            setTempPriceValue(p.price);
                                                        }}
                                                        className="p-1 text-text-secondary hover:text-primary hover:bg-primary/5 rounded transition-colors"
                                                        title={t('products.edit_price_title')}
                                                    >
                                                        <Edit3 size={12} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Desktop View: Table Container */}
                        <div className="hidden lg:flex flex-col overflow-hidden w-full bg-white rounded-lg shadow-cards border border-border mt-0 relative z-0">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse table-fixed">
                                    <thead>
                                        <tr className="bg-surface border-b border-border text-caption text-text-secondary uppercase tracking-wider">
                                            <th className="p-md font-semibold text-center w-[9%]">{t('products.table_stock')}</th>
                                            <th className="p-md font-semibold w-[13%]">{t('products.table_shipment')}</th>
                                            <th className="p-md font-semibold w-[22%]">{t('products.table_product')}</th>
                                            <th className="p-md font-semibold w-[14%]">{t('products.table_quality')}</th>
                                            <th className="p-md font-semibold w-[10%]">{t('products.history_table_date')}</th>
                                            <th className="p-md font-semibold w-[10%]">{t('products.table_days')}</th>
                                            <th className="p-md font-semibold text-right w-[10%]">{t('products.table_price')}</th>
                                            <th className="p-md font-semibold text-center w-[12%]">{t('products.table_actions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border/50">
                                        {filteredProducts.map(p => (
                                            <tr key={p.id} className={`transition-colors ${p.status === 'unavailable' ? 'bg-error/[0.02] opacity-75 grayscale-[0.3]' : 'hover:bg-surface/50'}`}>
                                                <td className="p-md text-center">
                                                    <div className="flex justify-center items-center gap-1">
                                                        {editingProductId === p.id ? (
                                                            <div className="flex items-center gap-1">
                                                                <input
                                                                    type="number"
                                                                    min="0"
                                                                    autoFocus
                                                                    className="w-16 p-1 text-xs border border-primary rounded text-center focus:outline-none focus:ring-1 focus:ring-primary font-bold bg-white"
                                                                    value={tempStockValue}
                                                                    onChange={e => setTempStockValue(Number(e.target.value))}
                                                                    onKeyDown={e => {
                                                                        if (e.key === 'Enter') handleSaveStock(p);
                                                                        if (e.key === 'Escape') handleCancelStock();
                                                                    }}
                                                                />
                                                                <button
                                                                    onClick={() => handleSaveStock(p)}
                                                                    disabled={isSavingStock}
                                                                    className="p-1 bg-success text-white rounded-full hover:bg-success-dark transition-colors"
                                                                    title={t('common.save')}
                                                                >
                                                                    <Check size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={handleCancelStock}
                                                                    disabled={isSavingStock}
                                                                    className="p-1 bg-surface text-text-secondary rounded-full hover:bg-gray-200 transition-colors"
                                                                    title={t('common.cancel')}
                                                                >
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <div className="flex items-center justify-center gap-2 group">
                                                                <span className={`w-16 p-1 text-xs border border-transparent rounded text-center font-bold
                                                                    ${p.available_quantity > 10 ? 'bg-success/5 text-success-dark' :
                                                                        p.available_quantity > 0 ? 'bg-warning/5 text-warning-dark' :
                                                                            'bg-error/5 text-error-dark'}`}>
                                                                    {p.available_quantity}
                                                                </span>
                                                                <button
                                                                    onClick={() => {
                                                                        setEditingProductId(p.id);
                                                                        setTempStockValue(p.available_quantity);
                                                                    }}
                                                                    className="opacity-0 group-hover:opacity-100 p-1 text-text-secondary hover:text-primary hover:bg-primary/5 rounded transition-all"
                                                                    title={t('products.edit_stock_title')}
                                                                >
                                                                    <Edit3 size={14} />
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-md text-xs font-mono truncate">
                                                    <div className="font-bold text-primary truncate" title={p.shipment_number}>{p.shipment_number}</div>
                                                    <div className="text-[10px] text-text-secondary mt-1 truncate" title={p.sku_sintetico || 'PENDIENTE'}>{p.sku_sintetico || 'PENDIENTE'}</div>
                                                </td>
                                                <td className="p-md truncate">
                                                    <div className={`font-bold transition-all truncate ${p.status === 'unavailable' ? 'text-text-secondary line-through' : 'text-heading'}`} title={p.name}>{p.name}</div>
                                                    <div className="text-caption text-text-secondary truncate" title={`${t('products.table_brand')}: ${p.brand} | Cat: ${p.category || t('products.other_category')}`}>{t('products.table_brand')}: {p.brand} | Cat: <span className="capitalize">{p.category || t('products.other_category')}</span></div>
                                                </td>
                                                <td className="p-md text-body truncate">
                                                    <div className="truncate" title={p.quality}>{p.quality}</div>
                                                    <div className="text-caption text-text-secondary truncate" title={p.caliber ? `${t('products.table_caliber')}: ${p.caliber}` : undefined}>{t('products.table_caliber')}: {p.caliber || '-'}</div>
                                                </td>
                                                <td className="p-md text-sm text-text-secondary truncate">
                                                    {p.entry_date || '-'}
                                                </td>
                                                <td className="p-md text-sm font-semibold text-warning-dark whitespace-nowrap">
                                                    {calcDaysInStorage(p.entry_date)}
                                                </td>
                                                <td className="p-md text-right whitespace-nowrap">
                                                    {editingPriceId === p.id ? (
                                                        <div className="flex items-center justify-end gap-1">
                                                            <input
                                                                type="number"
                                                                step="0.01"
                                                                min="0"
                                                                autoFocus
                                                                className="w-20 p-1 text-xs border border-primary rounded text-right focus:outline-none focus:ring-1 focus:ring-primary font-bold bg-white"
                                                                value={tempPriceValue}
                                                                onChange={e => setTempPriceValue(Number(e.target.value))}
                                                                onKeyDown={e => {
                                                                    if (e.key === 'Enter') handleSavePrice(p);
                                                                    if (e.key === 'Escape') handleCancelPrice();
                                                                }}
                                                            />
                                                            <button
                                                                onClick={() => handleSavePrice(p)}
                                                                disabled={isSavingPrice}
                                                                className="p-1 bg-success text-white rounded-full hover:bg-success-dark transition-colors"
                                                                title={t('common.save')}
                                                            >
                                                                <Check size={14} />
                                                            </button>
                                                            <button
                                                                onClick={handleCancelPrice}
                                                                disabled={isSavingPrice}
                                                                className="p-1 bg-surface text-text-secondary rounded-full hover:bg-gray-200 transition-colors"
                                                                title={t('common.cancel')}
                                                            >
                                                                <X size={14} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <div className="flex items-center justify-end gap-2 group">
                                                            <span className="font-display font-bold text-primary">${Number(p.price || 0).toFixed(2)}</span>
                                                            <button
                                                                onClick={() => {
                                                                    setEditingPriceId(p.id);
                                                                    setTempPriceValue(p.price);
                                                                }}
                                                                className="opacity-0 group-hover:opacity-100 p-1 text-text-secondary hover:text-primary hover:bg-primary/5 rounded transition-opacity"
                                                                title={t('products.edit_price_title')}
                                                            >
                                                                <Edit3 size={14} />
                                                            </button>
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-md text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            onClick={() => setSelectedHistoryProduct(p)}
                                                            className="p-2 rounded-lg inline-flex items-center justify-center transition-all bg-surface text-text-secondary hover:text-primary hover:bg-primary/10 border border-border"
                                                            title={t('products.action_view_history')}
                                                        >
                                                            <History size={18} />
                                                        </button>
                                                        <button
                                                            onClick={() => toggleProductAvailability(p)}
                                                            className={`p-2 rounded-lg inline-flex items-center justify-center transition-all ${p.status === 'unavailable'
                                                                ? 'bg-error/10 text-error hover:bg-error/20 border border-error/20'
                                                                : 'bg-success/10 text-success hover:bg-success/20 border border-success/20'
                                                                }`}
                                                            title={p.status === 'unavailable' ? t('products.action_available') : t('products.action_unavailable')}
                                                        >
                                                            {p.status === 'unavailable' ? <EyeOff size={18} /> : <Eye size={18} />}
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination Desktop Integrada */}
                            {totalPages > 0 && (
                                <div className="bg-surface/30 border-t border-border px-md py-sm flex justify-between items-center">
                                    <span className="text-caption text-text-secondary">
                                        {t('common.showing')} {localProducts.length} {t('common.records')} {t('common.of')} {totalCount}
                                    </span>
                                    <div className="flex items-center gap-sm">
                                        <div className="flex items-center gap-2 mr-4 border-r border-border pr-4">
                                            <span className="text-[10px] uppercase font-bold text-text-secondary tracking-widest whitespace-nowrap">{t('common.showing')}</span>
                                            <select
                                                value={limit}
                                                onChange={(e) => setLimit(Number(e.target.value))}
                                                className="bg-surface border border-border rounded px-2 py-0.5 text-xs font-bold text-primary focus:outline-none focus:ring-1 focus:ring-primary/30"
                                            >
                                                {PAGE_SIZE_OPTIONS.map(opt => (
                                                    <option key={opt} value={opt}>{opt}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <button
                                            onClick={() => {
                                                const prev = Math.max(1, page - 1);
                                                setPage(prev);
                                                loadProducts(prev, activeTab === 'active' ? ['active', 'incomplete', 'unavailable'] : activeTab, debouncedSearchTerm, false, limit);
                                            }}
                                            disabled={page === 1 || storeLoading}
                                            className="p-xs text-text-secondary hover:text-heading hover:bg-white border border-transparent hover:border-border rounded-sm transition-all disabled:opacity-50 disabled:pointer-events-none duration-200"
                                            title={t('common.previous')}
                                        >
                                            <ChevronLeft size={16} />
                                        </button>
                                        <span className="text-caption font-medium px-sm text-text-secondary">
                                            {page} / {totalPages}
                                        </span>
                                        <button
                                            onClick={() => {
                                                const next = Math.min(totalPages, page + 1);
                                                setPage(next);
                                                loadProducts(next, activeTab === 'active' ? ['active', 'incomplete', 'unavailable'] : activeTab, debouncedSearchTerm, false, limit);
                                            }}
                                            disabled={page === totalPages || storeLoading}
                                            className="p-xs text-text-secondary hover:text-heading hover:bg-white border border-transparent hover:border-border rounded-sm transition-all disabled:opacity-50 disabled:pointer-events-none duration-200"
                                            title={t('common.next')}
                                        >
                                            <ChevronRight size={16} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Mobile Load More */}
                        {page < totalPages && (
                            <div className="lg:hidden p-md bg-transparent flex justify-center w-full mt-sm">
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        const next = page + 1;
                                        setPage(next);
                                        loadProducts(next, activeTab === 'active' ? ['active', 'incomplete', 'unavailable'] : activeTab, debouncedSearchTerm, true);
                                    }}
                                    disabled={isFetchingMore || storeLoading}
                                    className="w-full flex items-center justify-center gap-2"
                                >
                                    {isFetchingMore ? <div className="animate-spin w-4 h-4 border-2 border-primary border-t-transparent rounded-full" /> : null}
                                    <span>{isFetchingMore ? t('products.loading_more') : t('products.btn_load_more_mobile')}</span>
                                </Button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Quarantine Edit Modal */}
            <QuarantineEditModal
                item={editingQuarantineId ? (quarantineItems.find(q => q.id === editingQuarantineId) || null) : null}
                edits={editingQuarantineId ? quarantineEdits[editingQuarantineId] : null}
                localErrs={editingQuarantineId ? quarantineFieldErrors[editingQuarantineId] : null}
                isPromoting={isPromoting === editingQuarantineId}
                onClose={() => setEditingQuarantineId(null)}
                onEdit={(field, value) => editingQuarantineId && handleQuarantineEdit(editingQuarantineId, field, value)}
                onPromote={() => editingQuarantineId && handlePromote(editingQuarantineId)}
            />

            {/* Modal de Historial de Cambios (US-INV-04 CA4) */}
            <ProductHistoryModal
                isOpen={!!selectedHistoryProduct}
                onClose={() => setSelectedHistoryProduct(null)}
                product={selectedHistoryProduct}
                tenantId={profile?.tenant_id || ''}
            />
        </div >
    );
};
