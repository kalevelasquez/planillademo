import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useDebounce } from '../../../hooks/useDebounce';
import { usePermissions } from '../../../hooks/usePermissions';

import { PAGE_SIZE } from '../../../services/customerService';
import { useTranslation } from 'react-i18next';
import { useOrderStore } from '../../../store/orderStore';
import { useCustomerStore } from '../../../store/customerStore';
import { formatPhoneForDisplay } from '../../../utils/phoneUtils';
import { useCustomerManagement } from './hooks/useCustomerManagement';
import { StatusBadge } from '../../components/StatusBadge';
import type { Customer, CustomerFilters } from '../../../services/customerService';

import { Button } from '../../components/Button';
import { InputField } from '../../components/InputField';
import { LoadMoreButton } from '../../components/LoadMoreButton';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';

import { Plus, X, Building, User, Phone, ShoppingCart, Search, Loader2, MessageCircle, MapPin, Tag, SlidersHorizontal, Edit2, History } from 'lucide-react';
import { CustomerHistoryModal } from './components/CustomerHistoryModal';


interface CustomerListViewProps {
    onStartOrder?: () => void;
}

export const CustomerListView: React.FC<CustomerListViewProps> = ({ onStartOrder }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { setCustomer } = useOrderStore();

    const {
        customers, isLoading, hasMore,
        page, totalCount, totalPages,
        filters,
        fetchCustomers, fetchPage, setFilters
    } = useCustomerStore(
        useShallow(state => ({
            customers: state.customers,
            isLoading: state.isLoading,
            hasMore: state.hasMore,
            page: state.page,
            totalCount: state.totalCount,
            totalPages: state.totalPages,
            filters: state.filters,
            fetchCustomers: state.fetchCustomers,
            fetchPage: state.fetchPage,
            setFilters: state.setFilters,
        }))
    );

    // ── Search ────────────────────────────────────────────────────
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearch = useDebounce(searchTerm, 300);

    // Al cambiar búsqueda o filtros → siempre vuelve a página 1
    useEffect(() => {
        fetchCustomers(1, debouncedSearch, filters);
    }, [debouncedSearch, fetchCustomers, filters]);

    const handleFilterChange = (newFilters: CustomerFilters) => {
        setFilters({ ...filters, ...newFilters });
    };

    const clearFilters = () => {
        setFilters({});
    };

    const [showFilters, setShowFilters] = useState(false);

    // ── Handlers de Paginación ────────────────────────────────────
    const handleLoadMore = useCallback(() => {
        fetchCustomers(page + 1, debouncedSearch, filters);
    }, [fetchCustomers, page, debouncedSearch, filters]);

    const handlePageChange = useCallback((newPage: number) => {
        fetchPage(newPage, debouncedSearch, filters);
        // Scroll suave hacia arriba del contenedor de datos
        document.getElementById('customer-table-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [fetchPage, debouncedSearch, filters]);

    const {
        formData,
        isModalOpen,
        isSubmitting,
        error,
        updateField,
        openCreateModal,
        openEditModal,
        closeModal,
        handleSaveCustomer,
        handleAssignSeller,
        sellers,
        isAssigningSeller,
    } = useCustomerManagement();

    const { canAssignSeller } = usePermissions();

    // ── Historial de Cliente ──
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [selectedCustomerHistory, setSelectedCustomerHistory] = useState<Customer | null>(null);

    const openHistoryModal = (customer: Customer) => {
        setSelectedCustomerHistory(customer);
        setIsHistoryModalOpen(true);
    };

    // ── Render ────────────────────────────────────────────────────
    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <PageHeader
                icon={Building}
                title={t('customers.header_title')}
                description={t('customers.header_desc')}
                className="mb-0 pb-md"
            />

            <div className="bg-white rounded-lg shadow-cards border border-border flex flex-col w-full flex-1 min-h-0 overflow-hidden relative">

                {/* ── Toolbar: Búsqueda + Filtros + Nuevo Cliente ── */}
                {(customers.length > 0 || searchTerm || isLoading || Object.keys(filters).length > 0) && (
                    <div className="sticky top-0 z-20 bg-surface/80 backdrop-blur-sm border-b border-border p-md flex flex-row gap-sm items-center justify-between animate-in fade-in slide-in-from-top-2 duration-300">
                        <InputField
                            isSearch
                            placeholder={t('customers.search_placeholder')}
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            onClear={() => setSearchTerm('')}
                            className="flex-1 min-w-0"
                        />
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`flex items-center gap-1.5 h-[42px] px-3 rounded-lg border text-caption font-semibold transition-all shrink-0
                                ${showFilters
                                    ? 'bg-primary/10 border-primary text-primary'
                                    : 'border-border text-text-secondary hover:border-primary hover:text-primary hover:bg-primary/5'
                                }`}
                        >
                            <SlidersHorizontal size={16} />
                            <span className="hidden sm:inline">{t('customers.filters_label')}</span>
                        </button>
                        <Button
                            onClick={openCreateModal}
                            className="flex items-center justify-center p-sm md:px-md shadow-sm shrink-0 h-[42px] w-auto"
                        >
                            <Plus size={20} className="sm:mr-2" />
                            <span className="hidden sm:inline-block">{t('customers.new_customer')}</span>
                        </Button>
                    </div>
                )}

                {/* ── Barra de Filtros Avanzados (CA2) ── */}
                {showFilters && (
                    <div className="border-b border-border bg-surface/20 px-md py-3 animate-in slide-in-from-top-1 duration-200">
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('customers.filter_status')}</label>
                                <select
                                    value={filters.status || ''}
                                    onChange={(e) => handleFilterChange({ status: e.target.value || undefined })}
                                    className="bg-white border border-border rounded-lg px-3 py-1.5 text-xs text-heading focus:outline-none focus:border-primary"
                                >
                                    <option value="">{t('customers.filter_all_statuses')}</option>
                                    <option value="activo">{t('customers.filter_active')}</option>
                                    <option value="inactivo">{t('customers.filter_inactive')}</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('customers.filter_price_type')}</label>
                                <select
                                    value={filters.price_type || ''}
                                    onChange={(e) => handleFilterChange({ price_type: e.target.value || undefined })}
                                    className="bg-white border border-border rounded-lg px-3 py-1.5 text-xs text-heading focus:outline-none focus:border-primary"
                                >
                                    <option value="">{t('customers.filter_all_prices')}</option>
                                    <option value="cliente">{t('customers.filter_price_regular')}</option>
                                    <option value="empleado">{t('customers.filter_price_employee')}</option>
                                    <option value="mayoreo">{t('customers.filter_price_wholesale')}</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('customers.filter_department')}</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder={t('customers.filter_department_placeholder')}
                                        value={filters.department || ''}
                                        onChange={(e) => handleFilterChange({ department: e.target.value || undefined })}
                                        className="w-full bg-white border border-border rounded-lg px-3 py-1.5 text-xs text-heading focus:outline-none focus:border-primary"
                                    />
                                    {filters.department && (
                                        <button onClick={() => handleFilterChange({ department: undefined })} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-error">
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                        {(filters.status || filters.price_type || filters.department) && (
                            <div className="mt-2 flex justify-end">
                                <button onClick={clearFilters} className="text-[10px] font-bold text-primary hover:underline flex items-center gap-1">
                                    <X size={10} /> {t('customers.clear_filters')}
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Contenido Principal ── */}
                {isLoading && customers.length === 0 ? (
                    /* Skeleton inicial (primera carga) */
                    <>
                        <div className="grid grid-cols-1 gap-md lg:hidden p-md w-full">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="bg-white rounded-lg shadow-cards border border-border p-md flex flex-col gap-sm animate-pulse">
                                    <div className="h-5 bg-surface rounded w-2/3"></div>
                                    <div className="flex flex-col gap-xs">
                                        <div className="h-4 bg-surface rounded w-1/2"></div>
                                        <div className="h-4 bg-surface rounded w-1/3"></div>
                                    </div>
                                    <div className="pt-sm border-t border-border/50 flex gap-sm">
                                        <div className="h-9 bg-surface rounded flex-1"></div>
                                        <div className="h-9 bg-surface rounded w-20"></div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div className="hidden lg:flex flex-col overflow-hidden animate-pulse w-full">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="p-md w-[35%]"><div className="h-3 bg-border/50 rounded w-32"></div></th>
                                        <th className="p-md w-[25%]"><div className="h-3 bg-border/50 rounded w-24"></div></th>
                                        <th className="p-md w-[25%]"><div className="h-3 bg-border/50 rounded w-20"></div></th>
                                        <th className="p-md w-[15%]"><div className="h-3 bg-border/50 rounded w-16 ml-auto"></div></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/50">
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <tr key={i}>
                                            <td className="p-md w-[35%]"><div className="h-4 bg-surface rounded w-40"></div></td>
                                            <td className="p-md w-[25%]"><div className="h-4 bg-surface rounded w-28"></div></td>
                                            <td className="p-md w-[25%]"><div className="h-4 bg-surface rounded w-24"></div></td>
                                            <td className="p-md w-[15%]"><div className="h-8 bg-surface rounded w-20 ml-auto"></div></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                ) : customers.length === 0 ? (
                    /* Estado Vacío */
                    <div className="p-xl text-center flex flex-col items-center justify-center min-h-[400px]">
                        <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-md">
                            {searchTerm
                                ? <Search size={32} className="text-text-secondary/50" />
                                : <Building size={32} className="text-text-secondary/50" />}
                        </div>
                        <h3 className="text-h3 text-heading">
                            {searchTerm ? `${t('common.no_results')} "${searchTerm}"` : t('customers.no_customers')}
                        </h3>
                        <p className="text-body text-text-secondary mt-xs max-w-[300px]">
                            {searchTerm
                                ? t('customers.no_customers_desc_search')
                                : t('customers.no_customers_desc_empty')}
                        </p>
                        {searchTerm ? (
                            <Button variant="secondary" className="mt-md" onClick={() => setSearchTerm('')}>
                                {t('common.clear_search')}
                            </Button>
                        ) : (
                            <Button variant="secondary" className="mt-md"
                                onClick={openCreateModal}>
                                {t('customers.add_first_customer')}
                            </Button>
                        )}
                    </div>
                ) : (
                    <>
                        {/* ════════════════════════════════════
                            VISTA MOBILE — Cards + Load More
                        ════════════════════════════════════ */}
                        <div className="lg:hidden">
                            <div className="grid grid-cols-1 gap-md p-md bg-surface/10">
                                {customers.map(customer => (
                                    <div key={customer.id} className="bg-white rounded-lg shadow-cards border border-border p-md flex flex-col gap-sm">
                                        <div className="flex justify-between items-start gap-2">
                                            <h3 className="text-h3 font-display text-heading line-clamp-2 break-words">
                                                {customer.business_name}
                                            </h3>
                                            <div className="flex gap-1 shrink-0">
                                                <button onClick={() => openEditModal(customer)} className="p-1.5 bg-surface border border-border rounded-md text-text-secondary hover:text-primary transition-colors">
                                                    <Edit2 size={14} />
                                                </button>
                                                <button onClick={() => openHistoryModal(customer)} className="p-1.5 bg-surface border border-border rounded-md text-text-secondary hover:text-primary transition-colors" title="Ver Historial">
                                                    <History size={14} />
                                                </button>
                                                <StatusBadge status={customer.status === 'activo' ? 'Approved' : 'Cancelled'} customLabel={customer.status === 'activo' ? 'ACTIVO' : 'INACTIVO'} />
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-2 mb-1">
                                            {customer.department && (
                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary/5 text-primary text-[10px] font-bold rounded-full border border-primary/10">
                                                    <MapPin size={10} /> {customer.department}
                                                </span>
                                            )}
                                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface text-text-secondary text-[10px] font-bold rounded-full border border-border italic capitalize">
                                                <Tag size={10} /> {customer.price_type || 'cliente'}
                                            </span>
                                        </div>
                                        <div className="flex flex-col gap-xs text-body text-text-secondary">
                                            <div className="flex items-center gap-xs min-w-0">
                                                <User size={15} className="shrink-0 opacity-60" />
                                                <span className="truncate flex-1 min-w-0">
                                                    {customer.contact_name || <span className="opacity-50 italic">{t('common.contact_unavailable')}</span>}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-xs min-w-0">
                                                <Phone size={15} className="shrink-0 opacity-60" />
                                                {customer.phone ? (
                                                    <div className="flex items-center gap-2 min-w-0 flex-1">
                                                        <a
                                                            href={`tel:+${customer.phone.replace(/-/g, '')}`}
                                                            className="truncate flex-1 min-w-0 text-text-secondary hover:text-primary transition-colors"
                                                        >
                                                            {formatPhoneForDisplay(customer.phone)}
                                                        </a>
                                                        <button
                                                            onClick={async () => {
                                                                const { openWhatsApp } = await import('../../../utils/whatsappUtils');
                                                                openWhatsApp(customer.phone);
                                                            }}
                                                            className="text-[#25D366] shrink-0 cursor-pointer"
                                                            title="WhatsApp"
                                                        >
                                                            <MessageCircle size={15} fill="currentColor" />
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <span className="opacity-50 italic">{t('common.phone_unavailable')}</span>
                                                )}
                                            </div>
                                            {canAssignSeller && (
                                                <div className="flex items-center gap-xs min-w-0 mt-1 pt-1 border-t border-border/50">
                                                    <span className="text-caption truncate w-24 shrink-0">Vendedor:</span>
                                                    <div className="relative flex-1">
                                                        {isAssigningSeller === customer.id ? (
                                                            <div className="flex items-center gap-2">
                                                                <Loader2 size={12} className="animate-spin text-primary" />
                                                                <span className="text-caption text-text-secondary">{t('customers.assigning')}</span>
                                                            </div>
                                                        ) : (
                                                            <select
                                                                value={customer.assigned_seller_id || 'unassigned'}
                                                                onChange={(e) => handleAssignSeller(customer.id, e.target.value)}
                                                                className="w-full bg-surface border border-border rounded p-1 text-xs text-heading focus:outline-none focus:border-primary"
                                                            >
                                                                <option value="unassigned">Sin asignar</option>
                                                                {customer.assigned_seller_id && !sellers.find(s => s.id === customer.assigned_seller_id) && (
                                                                    <option value={customer.assigned_seller_id}>{customer.seller?.full_name || 'Vendedor Desconocido'}</option>
                                                                )}
                                                                {sellers
                                                                    .filter(s => s.role === 'vendedor' || s.id === customer.assigned_seller_id)
                                                                    .map(s => (
                                                                        <option key={s.id} value={s.id}>{s.full_name}</option>
                                                                    ))}
                                                            </select>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="pt-sm border-t border-border/50 flex items-center justify-center w-full">
                                            <Button
                                                variant="outline-secondary"
                                                size="sm"
                                                className="w-full flex items-center justify-center gap-2 font-bold shadow-sm"
                                                onClick={() => {
                                                    setCustomer(customer);
                                                    if (onStartOrder) onStartOrder();
                                                    else navigate('/catalogo');
                                                }}
                                            >
                                                <ShoppingCart size={15} />
                                                {t('customers.action_create_order')}
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {/* Load More — solo mobile */}
                            {hasMore && (
                                <LoadMoreButton
                                    onClick={handleLoadMore}
                                    isLoading={isLoading}
                                    label={t('customers.load_more')}
                                    loadingLabel={t('common.loading')}
                                />
                            )}
                        </div>

                        {/* ════════════════════════════════════
                            VISTA DESKTOP — Tabla + Pagination
                        ════════════════════════════════════ */}
                        <div className="hidden lg:flex flex-col overflow-hidden w-full">
                            {/* Ancla para scroll-to-top al cambiar página */}
                            <div id="customer-table-top" />

                            {/* Overlay de carga al paginar (sin desaparecer la tabla) */}
                            <div className="relative">
                                {isLoading && customers.length > 0 && (
                                    <div className="absolute inset-0 z-10 bg-white/70 flex items-center justify-center rounded-sm">
                                        <Loader2 size={28} className="animate-spin text-primary" />
                                    </div>
                                )}

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-surface border-b border-border text-caption text-text-secondary uppercase tracking-wider">
                                                <th className="p-md font-semibold w-[22%]">{t('customers.table_company')}</th>
                                                <th className="p-md font-semibold w-[15%]">{t('customers.table_contact')}</th>
                                                <th className="p-md font-semibold w-[15%]">{t('customers.table_phone')}</th>
                                                <th className="p-md font-semibold w-[12%]">{t('customers.table_department')}</th>
                                                <th className="p-md font-semibold w-[12%] text-center">Lista / {t('customers.filter_status')}</th>
                                                {canAssignSeller && <th className="p-md font-semibold w-[14%]">{t('customers.vendedor_label')}</th>}
                                                <th className="p-md font-semibold text-right w-[10%]">{t('orders.table_actions')}</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {customers.map(customer => (
                                                <tr key={customer.id} className="hover:bg-surface/50 transition-colors group">
                                                    <td className="p-md font-semibold text-heading">
                                                        {customer.business_name}
                                                    </td>
                                                    <td className="p-md text-body text-text-secondary">
                                                        <div className="flex items-center gap-2">
                                                            <User size={14} className="text-text-secondary/50 shrink-0" />
                                                            <span className="truncate">
                                                                {customer.contact_name || <span className="opacity-40 italic">{t('common.contact_unavailable')}</span>}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td className="p-md text-body text-text-secondary">
                                                        {customer.phone ? (
                                                            <div className="flex items-center gap-2 group">
                                                                <a
                                                                    href={`tel:+${customer.phone.replace(/-/g, '')}`}
                                                                    className="hover:text-primary transition-colors tabular-nums"
                                                                    title="Llamar"
                                                                >
                                                                    {formatPhoneForDisplay(customer.phone)}
                                                                </a>
                                                                <button
                                                                    onClick={async () => {
                                                                        const { openWhatsApp } = await import('../../../utils/whatsappUtils');
                                                                        openWhatsApp(customer.phone);
                                                                    }}
                                                                    className="text-[#25D366] opacity-0 group-hover:opacity-100 transition-opacity hover:scale-110 transform cursor-pointer"
                                                                    title="Enviar WhatsApp"
                                                                >
                                                                    <MessageCircle size={15} fill="currentColor" />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <span className="text-text-secondary/40 italic text-caption">{t('common.phone_unavailable')}</span>
                                                        )}
                                                    </td>
                                                    <td className="p-md text-caption text-text-secondary">
                                                        {customer.department ? (
                                                            <div className="flex items-center gap-1">
                                                                <MapPin size={12} className="opacity-50" />
                                                                {customer.department}
                                                            </div>
                                                        ) : (
                                                            <span className="opacity-30 italic">Sin depto</span>
                                                        )}
                                                    </td>
                                                    <td className="p-md text-center">
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-[10px] font-bold uppercase tracking-wider text-text-secondary bg-surface px-1.5 py-0.5 rounded border border-border">
                                                                {customer.price_type || 'cliente'}
                                                            </span>
                                                            <StatusBadge
                                                                status={customer.status === 'activo' ? 'Approved' : 'Cancelled'}
                                                                customLabel={customer.status === 'activo' ? 'ACTIVO' : 'INACTIVO'}
                                                            />
                                                        </div>
                                                    </td>
                                                    {canAssignSeller && (
                                                        <td className="p-md text-sm">
                                                            {isAssigningSeller === customer.id ? (
                                                                <div className="flex items-center gap-2">
                                                                    <Loader2 size={14} className="animate-spin text-primary" />
                                                                    <span className="text-text-secondary">Asignando...</span>
                                                                </div>
                                                            ) : (
                                                                <select
                                                                    value={customer.assigned_seller_id || 'unassigned'}
                                                                    onChange={(e) => handleAssignSeller(customer.id, e.target.value)}
                                                                    className="w-full bg-surface border border-border rounded p-1.5 text-sm text-heading focus:outline-none focus:border-primary truncate max-w-[200px]"
                                                                >
                                                                    <option value="unassigned">Sin asignar</option>
                                                                    {customer.assigned_seller_id && !sellers.find(s => s.id === customer.assigned_seller_id) && (
                                                                        <option value={customer.assigned_seller_id}>{customer.seller?.full_name || 'Vendedor Desconocido'}</option>
                                                                    )}
                                                                    {sellers
                                                                        .filter(s => s.role === 'vendedor' || s.id === customer.assigned_seller_id)
                                                                        .map(s => (
                                                                            <option key={s.id} value={s.id}>{s.full_name}</option>
                                                                        ))}
                                                                </select>
                                                            )}
                                                        </td>
                                                    )}
                                                    <td className="p-md text-right">
                                                        <div className="flex justify-end gap-1">
                                                            <button
                                                                onClick={() => openEditModal(customer)}
                                                                className="p-2 text-text-secondary hover:text-primary transition-colors bg-surface border border-border rounded-md"
                                                                title="Editar información"
                                                            >
                                                                <Edit2 size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => openHistoryModal(customer)}
                                                                className="p-2 text-text-secondary hover:text-primary transition-colors bg-surface border border-border rounded-md"
                                                                title="Ver Historial"
                                                            >
                                                                <History size={16} />
                                                            </button>
                                                            <Button
                                                                variant="outline-secondary"
                                                                size="sm"
                                                                className="inline-flex items-center gap-xs"
                                                                onClick={() => {
                                                                    setCustomer(customer);
                                                                    if (onStartOrder) onStartOrder();
                                                                    else navigate('/catalogo');
                                                                }}
                                                            >
                                                                <ShoppingCart size={14} />
                                                                {t('customers.action_order')}
                                                            </Button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Pagination — solo desktop, solo si hay más de una página */}
                            {totalPages > 1 && (
                                <div className="border-t border-border p-md">
                                    <Pagination
                                        currentPage={page}
                                        totalPages={totalPages}
                                        totalItems={totalCount}
                                        pageSize={PAGE_SIZE}
                                        onPageChange={handlePageChange}
                                    />
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* ══════════════════════════════════════════════════
                Modal: Registrar/Editar Cliente
            ══════════════════════════════════════════════════ */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div
                        className="bg-white rounded-xl shadow-modals w-[95vw] md:w-[700px] max-w-full flex flex-col overflow-hidden max-h-[90vh] animate-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex justify-between items-center px-lg py-6 border-b border-border bg-surface/50">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary shadow-sm">
                                    <Building size={20} />
                                </div>
                                <div className="flex flex-col">
                                    <h2 className="text-xl font-bold text-heading leading-tight">
                                        {formData.id ? t('customers.modal_title_edit') : t('customers.modal_title_create')}
                                    </h2>
                                    <p className="text-xs text-text-secondary">
                                        {formData.id ? t('customers.modal_subtitle_edit') : t('customers.modal_subtitle_create')}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={closeModal}
                                className="p-xs text-text-secondary hover:bg-white hover:text-error rounded-sm transition-colors"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleSaveCustomer} className="flex flex-col flex-1 min-h-0 min-w-0">
                            <div className="p-lg flex flex-col gap-8 overflow-y-auto custom-scrollbar">

                                {/* —— Sección 1: Identificación y Empresa —— */}
                                <section className="flex flex-col gap-4">
                                    <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                                        <Tag size={14} className="text-primary" />
                                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('customers.modal_section_identification')}</h3>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <InputField
                                            id="customer-business-name"
                                            label={t('customers.input_business_name')}
                                            placeholder={t('customers.input_business_name_placeholder')}
                                            icon={<Building size={18} />}
                                            value={formData.businessName}
                                            onChange={(e) => updateField('businessName', e.target.value)}
                                            required
                                            className="sm:col-span-2"
                                        />
                                        <InputField
                                            id="customer-internal-code"
                                            label={t('customers.input_internal_code')}
                                            placeholder={t('customers.internal_code_placeholder')}
                                            icon={<Tag size={18} />}
                                            value={formData.internalCode}
                                            onChange={(e) => updateField('internalCode', e.target.value)}
                                        />
                                        <InputField
                                            id="customer-identification"
                                            label={t('customers.input_identification')}
                                            placeholder={t('customers.identification_placeholder')}
                                            icon={<Search size={18} />}
                                            value={formData.identificationNumber}
                                            onChange={(e) => updateField('identificationNumber', e.target.value)}
                                        />
                                    </div>
                                </section>

                                {/* —— Sección 2: Contacto y Ubicación —— */}
                                <section className="flex flex-col gap-4">
                                    <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                                        <MapPin size={14} className="text-primary" />
                                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('customers.modal_section_contact')}</h3>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <InputField
                                            id="customer-contact-name"
                                            label={t('customers.input_contact_name')}
                                            placeholder={t('customers.contact_person_placeholder')}
                                            icon={<User size={18} />}
                                            value={formData.contactName}
                                            onChange={(e) => updateField('contactName', e.target.value)}
                                        />
                                        <InputField
                                            id="customer-phone"
                                            label={t('customers.input_phone')}
                                            mask="phone"
                                            value={formData.phone}
                                            onChange={(e) => updateField('phone', e.target.value)}
                                        />
                                        <InputField
                                            id="customer-department"
                                            label={t('customers.input_department')}
                                            placeholder={t('customers.filter_department')}
                                            icon={<MapPin size={18} />}
                                            value={formData.department}
                                            onChange={(e) => updateField('department', e.target.value)}
                                        />
                                        <InputField
                                            id="customer-municipality"
                                            label={t('customers.input_municipality')}
                                            placeholder={t('customers.input_municipality')}
                                            icon={<MapPin size={18} />}
                                            value={formData.municipality}
                                            onChange={(e) => updateField('municipality', e.target.value)}
                                        />
                                        <div className="flex flex-col gap-1.5 sm:col-span-2">
                                            <label className="text-sm font-semibold text-heading ml-0.5">{t('customers.input_address')}</label>
                                            <textarea
                                                rows={2}
                                                className="w-full bg-white border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm resize-none"
                                                placeholder={t('customers.input_address_placeholder')}
                                                value={formData.address}
                                                onChange={(e) => updateField('address', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </section>

                                {/* —— Sección 3: Configuración y Administración —— */}
                                <section className="flex flex-col gap-4">
                                    <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                                        <SlidersHorizontal size={14} className="text-primary" />
                                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('customers.modal_section_config')}</h3>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-sm font-semibold text-heading ml-0.5">{t('customers.input_price_type')}</label>
                                            <select
                                                value={formData.price_type}
                                                onChange={(e) => updateField('price_type', e.target.value as any)}
                                                className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm appearance-none cursor-pointer"
                                            >
                                                <option value="cliente">{t('customers.filter_price_regular')}</option>
                                                <option value="empleado">{t('customers.filter_price_employee')}</option>
                                                <option value="mayoreo">{t('customers.filter_price_wholesale')}</option>
                                            </select>
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <label className="text-sm font-semibold text-heading ml-0.5">{t('customers.input_status')}</label>
                                            <div className="flex bg-surface p-1 rounded-xl border border-border h-[42px]">
                                                <button
                                                    type="button"
                                                    onClick={() => updateField('status', 'activo')}
                                                    className={`flex-1 flex items-center justify-center text-xs font-bold rounded-lg transition-all ${formData.status === 'activo' ? 'bg-primary text-white shadow-md' : 'text-text-secondary hover:text-heading hover:bg-white'}`}
                                                >
                                                    {t('customers.filter_active')}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => updateField('status', 'inactivo')}
                                                    className={`flex-1 flex items-center justify-center text-xs font-bold rounded-lg transition-all ${formData.status === 'inactivo' ? 'bg-error text-white shadow-md' : 'text-text-secondary hover:text-heading hover:bg-white'}`}
                                                >
                                                    {t('customers.filter_inactive')}
                                                </button>
                                            </div>
                                        </div>

                                        {canAssignSeller && (
                                            <div className="flex flex-col gap-1.5 sm:col-span-2 mt-1">
                                                <label className="text-sm font-semibold text-heading ml-0.5 flex items-center gap-2">
                                                    {t('customers.input_seller')}
                                                </label>
                                                <div className="relative">
                                                    <select
                                                        value={formData.assigned_seller_id || 'unassigned'}
                                                        onChange={(e) => updateField('assigned_seller_id', e.target.value === 'unassigned' ? '' : e.target.value)}
                                                        className="w-full bg-white border border-border rounded-xl px-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm appearance-none cursor-pointer"
                                                    >
                                                        <option value="unassigned">{t('customers.unassigned_seller')}</option>
                                                        {sellers.map(s => (
                                                            <option key={s.id} value={s.id}>{s.full_name}</option>
                                                        ))}
                                                    </select>
                                                    <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary/50" />
                                                </div>
                                            </div>
                                        )}

                                        <div className="flex flex-col gap-1.5 sm:col-span-2 mt-2">
                                            <label className="text-sm font-semibold text-heading ml-0.5">Notas y Observaciones Internas</label>
                                            <textarea
                                                rows={3}
                                                className="w-full bg-white border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm resize-none"
                                                placeholder="Horarios de entrega, preferencias del cliente, restricciones de crédito..."
                                                value={formData.notes}
                                                onChange={(e) => updateField('notes', e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </section>

                                {error && (
                                    <div className="p-4 bg-error/10 border border-error/20 rounded-xl text-error text-sm font-medium flex items-center gap-3 animate-in fade-in slide-in-from-top-1">
                                        <X size={18} className="bg-error text-white rounded-full p-0.5" />
                                        {error}
                                    </div>
                                )}
                            </div>

                            <div className="px-lg py-6 pb-24 sm:pb-6 bg-surface border-t border-border flex flex-col sm:flex-row justify-end gap-3 shrink-0">
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={closeModal}
                                    disabled={isSubmitting}
                                    className="w-full sm:w-auto order-2 sm:order-1 h-12 px-8 font-bold"
                                >
                                    {t('common.cancel')}
                                </Button>
                                <Button
                                    type="submit"
                                    isLoading={isSubmitting}
                                    className="w-full sm:w-auto order-1 sm:order-2 h-12 px-8 font-bold shadow-md shadow-primary/20"
                                >
                                    {formData.id ? t('customers.save_changes') : t('customers.register_customer')}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* ══════════════════════════════════════════════════
                Modal: Historial del Cliente
            ══════════════════════════════════════════════════ */}
            <CustomerHistoryModal
                customer={selectedCustomerHistory}
                isOpen={isHistoryModalOpen}
                onClose={() => setIsHistoryModalOpen(false)}
            />
        </div>
    );
};
