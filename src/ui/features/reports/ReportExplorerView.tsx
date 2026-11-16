import React from 'react';
import {
    BarChart3, Users, Package, ShoppingBag,
    Calendar, Download, Filter, ArrowUpDown,
    TrendingUp, TrendingDown, Clock, AlertCircle,
    ChevronDown, FileSpreadsheet, FileText
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useReportExplorer } from './hooks/useReportExplorer';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/Button';

export const ReportExplorerView: React.FC = () => {
    const { t } = useTranslation();
    const {
        activeTab, setActiveTab, isLoading, isExporting,
        dateRange, setDateRange, sortedData, sortConfig,
        handleSort, exportToExcel, exportToPDF
    } = useReportExplorer();

    const [showExportMenu, setShowExportMenu] = useState(false);

    // Cerrar menú al hacer click fuera
    useEffect(() => {
        const handleClickOutside = () => setShowExportMenu(false);
        if (showExportMenu) {
            window.addEventListener('click', handleClickOutside);
        }
        return () => window.removeEventListener('click', handleClickOutside);
    }, [showExportMenu]);

    const formatCurrency = (val: number) =>
        `$${val.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const tabs = [
        { id: 'sellers', label: t('reports.tab_sellers'), icon: Users },
        { id: 'products', label: t('reports.tab_products'), icon: Package },
        { id: 'customers', label: t('reports.tab_customers'), icon: ShoppingBag },
    ];



    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <PageHeader
                icon={BarChart3}
                title={t('reports.header_title')}
                description={t('reports.header_desc')}
            />

            {/* Toolbar: Tabs & Dates */}
            <div className="flex flex-col gap-md lg:flex-row lg:justify-between lg:items-center bg-white p-md rounded-xl border border-border shadow-sm w-full overflow-hidden">
                <div className="w-full lg:w-auto overflow-hidden">
                    <div className="flex bg-surface p-1 rounded-lg border border-border overflow-x-auto scrollbar-none scroll-smooth items-center">
                        {tabs.map(tab => (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id as 'sellers' | 'products' | 'customers')}
                                className={`flex items-center justify-center gap-2 px-xl py-2 rounded-md font-bold transition-all whitespace-nowrap min-w-0 flex-1 lg:flex-none text-[11px] sm:text-xs
                                    ${activeTab === tab.id
                                        ? 'bg-white text-primary shadow-sm shadow-black/5 ring-1 ring-black/5'
                                        : 'text-text-secondary hover:text-heading hover:bg-white/50'
                                    }`}
                            >
                                <tab.icon size={16} className="shrink-0" />
                                <span>{tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="flex flex-col sm:flex-row items-center gap-sm sm:w-auto w-full">
                    <div className="flex items-center justify-center gap-2 bg-surface px-3 py-1.5 rounded-lg border border-border w-full sm:w-auto">
                        <Calendar size={14} className="text-text-secondary shrink-0" />
                        <div className="flex items-center gap-1 flex-1 sm:flex-none">
                            <input
                                type="date"
                                className="bg-transparent border-none text-[11px] font-bold outline-none text-heading w-full sm:w-28"
                                value={dateRange.start}
                                onChange={(e) => setDateRange((prev: typeof dateRange) => ({ ...prev, start: e.target.value }))}
                            />
                            <span className="text-text-secondary text-[10px] lowercase">al</span>
                            <input
                                type="date"
                                className="bg-transparent border-none text-[11px] font-bold outline-none text-heading w-full sm:w-28"
                                value={dateRange.end}
                                onChange={(e) => setDateRange((prev: typeof dateRange) => ({ ...prev, end: e.target.value }))}
                            />
                        </div>
                    </div>

                    {/* Export Dropdown Button */}
                    <div className="relative w-full sm:w-auto">
                        <Button
                            variant="primary"
                            size="sm"
                            className="h-9 w-full sm:w-auto px-md flex items-center justify-center gap-2 pr-2"
                            onClick={(e) => { e.stopPropagation(); setShowExportMenu(!showExportMenu); }}
                            isLoading={isExporting}
                            disabled={sortedData.length === 0}
                        >
                            <Download size={16} />
                            <span className="text-xs">{t('reports.action_export')}</span>
                            <ChevronDown size={14} className={`transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
                        </Button>

                        {showExportMenu && (
                            <div className="absolute right-0 top-full mt-2 w-56 bg-white border border-border rounded-xl shadow-modals z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                <div className="p-2 flex flex-col gap-1">
                                    <button
                                        onClick={() => exportToExcel()}
                                        className="flex items-center gap-sm w-full p-md text-sm text-left hover:bg-surface rounded-lg transition-colors group"
                                    >
                                        <div className="bg-success-light text-success p-1.5 rounded-md group-hover:bg-success group-hover:text-white transition-colors">
                                            <FileSpreadsheet size={16} />
                                        </div>
                                        <span className="font-medium text-heading">{t('reports.action_export_xlsx')}</span>
                                    </button>
                                    <button
                                        onClick={() => exportToPDF()}
                                        className="flex items-center gap-sm w-full p-md text-sm text-left hover:bg-surface rounded-lg transition-colors group border-t border-border/50 pt-3"
                                    >
                                        <div className="bg-error-light text-error p-1.5 rounded-md group-hover:bg-error group-hover:text-white transition-colors">
                                            <FileText size={16} />
                                        </div>
                                        <span className="font-medium text-heading">{t('reports.action_export_pdf')}</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Report Content */}
            <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden min-h-[500px]">
                {isLoading ? (
                    <div className="flex flex-col items-center justify-center p-24 gap-md">
                        <div className="w-12 h-12 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
                        <span className="text-caption text-text-secondary font-bold uppercase tracking-widest">{t('reports.exporting')}</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto scroll-smooth w-full rounded-b-xl scrollbar-thin scrollbar-thumb-border scrollbar-track-transparent">
                        <table className="w-full text-left border-collapse min-w-[750px] lg:min-w-0">
                            <thead className="bg-surface border-b border-border">
                                <tr>
                                    {activeTab === 'sellers' && (
                                        <>
                                            <SortableHeader label={t('reports.table_seller')} sortKey="seller_name" currentSort={sortConfig} onClick={handleSort} />
                                            <SortableHeader label={t('reports.table_orders')} sortKey="orders_count" currentSort={sortConfig} onClick={handleSort} align="center" />
                                            <SortableHeader label={t('reports.table_total')} sortKey="total_sales" currentSort={sortConfig} onClick={handleSort} align="right" />
                                            <SortableHeader label={t('reports.table_avg_ticket')} sortKey="avg_ticket" currentSort={sortConfig} onClick={handleSort} align="right" />
                                        </>
                                    )}
                                    {activeTab === 'products' && (
                                        <>
                                            <SortableHeader label={t('reports.table_product')} sortKey="product_name" currentSort={sortConfig} onClick={handleSort} />
                                            <SortableHeader label={t('reports.table_category')} sortKey="category" currentSort={sortConfig} onClick={handleSort} />
                                            <SortableHeader label={t('reports.table_quantity')} sortKey="total_quantity" currentSort={sortConfig} onClick={handleSort} align="center" />
                                            <SortableHeader label={t('reports.table_revenue')} sortKey="total_revenue" currentSort={sortConfig} onClick={handleSort} align="right" />
                                        </>
                                    )}
                                    {activeTab === 'customers' && (
                                        <>
                                            <SortableHeader label={t('reports.table_customer')} sortKey="business_name" currentSort={sortConfig} onClick={handleSort} />
                                            <SortableHeader label={t('reports.table_frequency')} sortKey="monthly_frequency" currentSort={sortConfig} onClick={handleSort} align="center" />
                                            <SortableHeader label={t('reports.table_last_order')} sortKey="last_order_at" currentSort={sortConfig} onClick={handleSort} />
                                            <SortableHeader label={t('reports.table_status')} sortKey="is_inactive" currentSort={sortConfig} onClick={handleSort} />
                                            <SortableHeader label={t('reports.table_total')} sortKey="accumulated_amount" currentSort={sortConfig} onClick={handleSort} align="right" />
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {sortedData.length === 0 ? (
                                    <tr>
                                        <td colSpan={10} className="p-24 text-center">
                                            <div className="flex flex-col items-center opacity-40">
                                                <Filter size={48} className="mb-md" />
                                                <span className="text-h3 text-heading">{t('reports.no_data')}</span>
                                                <span className="text-body text-text-secondary">{t('reports.no_data_desc')}</span>
                                            </div>
                                        </td>
                                    </tr>
                                ) : sortedData.map((item: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-surface/30 transition-colors">
                                        {activeTab === 'sellers' && (
                                            <>
                                                <td className="px-3 py-4 sm:p-md text-sm font-bold text-heading">{(item as any).seller_name}</td>
                                                <td className="px-3 py-4 sm:p-md text-sm text-center font-medium">{(item as any).orders_count}</td>
                                                <td className="px-3 py-4 sm:p-md text-sm text-right font-display font-bold text-primary">{formatCurrency((item as any).total_sales)}</td>
                                                <td className="px-3 py-4 sm:p-md text-sm text-right font-medium text-text-secondary">{formatCurrency((item as any).avg_ticket)}</td>
                                            </>
                                        )}
                                        {activeTab === 'products' && (
                                            <>
                                                <td className="px-3 py-4 sm:p-md text-sm font-bold text-heading">{(item as any).product_name}</td>
                                                <td className="px-3 py-4 sm:p-md text-xs font-bold uppercase text-text-secondary">
                                                    <span className="bg-surface px-2 py-1 rounded border border-border">{(item as any).category}</span>
                                                </td>
                                                <td className="px-3 py-4 sm:p-md text-sm text-center font-bold">
                                                    {(item as any).total_quantity}
                                                    {(item as any).total_quantity > 0 ? <TrendingUp size={12} className="inline ml-1 text-success" /> : <TrendingDown size={12} className="inline ml-1 text-error" />}
                                                </td>
                                                <td className="px-3 py-4 sm:p-md text-sm text-right font-display font-bold text-primary">{formatCurrency((item as any).total_revenue)}</td>
                                            </>
                                        )}
                                        {activeTab === 'customers' && (
                                            <>
                                                <td className="px-3 py-4 sm:p-md text-sm font-bold text-heading">{(item as any).business_name}</td>
                                                <td className="px-3 py-4 sm:p-md text-sm text-center font-medium">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <Clock size={12} className="text-text-secondary" />
                                                        {(item as any).monthly_frequency}
                                                    </div>
                                                </td>
                                                <td className="px-3 py-4 sm:p-md text-xs text-text-secondary">
                                                    {(item as any).last_order_at ? new Date((item as any).last_order_at).toLocaleDateString('es-SV') : 'N/A'}
                                                </td>
                                                <td className="px-3 py-4 sm:p-md text-xs">
                                                    {(item as any).is_inactive ? (
                                                        <span className="flex items-center gap-1 text-error font-bold italic">
                                                            <AlertCircle size={12} />
                                                            {t('reports.status_inactive')}
                                                        </span>
                                                    ) : (
                                                        <span className="text-success font-bold">● {t('reports.status_active')}</span>
                                                    )}
                                                </td>
                                                <td className="px-3 py-4 sm:p-md text-sm text-right font-display font-bold text-success">{formatCurrency((item as any).accumulated_amount)}</td>
                                            </>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

const SortableHeader: React.FC<{
    label: string,
    sortKey: string,
    currentSort: { key: string, direction: 'asc' | 'desc' } | null,
    onClick: (key: string) => void,
    align?: 'left' | 'center' | 'right'
}> = ({ label, sortKey, currentSort, onClick, align = 'left' }) => {
    const isSorted = currentSort?.key === sortKey;

    return (
        <th
            className={`px-3 py-4 sm:p-md cursor-pointer group hover:bg-black/[0.02] transition-colors ${align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : ''}`}
            onClick={() => onClick(sortKey)}
        >
            <div className={`flex items-center gap-2 text-xs font-bold text-text-secondary uppercase tracking-widest ${align === 'center' ? 'justify-center' : align === 'right' ? 'justify-end' : ''}`}>
                {label}
                <ArrowUpDown
                    size={14}
                    className={`transition-colors ${isSorted ? 'text-primary' : 'text-text-secondary/30 group-hover:text-text-secondary'}`}
                />
            </div>
        </th>
    );
};
