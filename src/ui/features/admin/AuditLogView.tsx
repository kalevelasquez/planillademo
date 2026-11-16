import React, { useState, useEffect } from 'react';
import { History, Search, Filter, RotateCcw, Eye, User, Activity, Download } from 'lucide-react';
import { useAuditManagement } from './hooks/useAuditManagement';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { InputField } from '../../components/InputField';
import { Pagination } from '../../components/Pagination';
import { AuditDiffModal } from './components/AuditDiffModal';
import { userService, type UserManagementProfile } from '../../../services/userService';
import { useAuthStore } from '../../../store/authStore';
import type { AuditEntry, AuditAction } from '../../../services/auditService';
import { getAuditLabel, AUDIT_COLORS } from './hooks/auditTranslate';
import { useTranslation, Trans } from 'react-i18next';

export const AuditLogView: React.FC = () => {
    const { t } = useTranslation();
    const {
        logs,
        isLoading,
        error,
        totalCount,
        currentPage,
        pageSize,
        isExporting,
        handlePageChange,
        handleApplyFilters,
        handleResetFilters,
        handleExport
    } = useAuditManagement();

    const { profile } = useAuthStore();
    const [selectedEntry, setSelectedEntry] = useState<AuditEntry | null>(null);
    const [isDiffModalOpen, setIsDiffModalOpen] = useState(false);
    const [users, setUsers] = useState<UserManagementProfile[]>([]);
    const [localFilters, setLocalFilters] = useState({
        userId: '',
        resourceType: '',
        action: '' as AuditAction | '',
        dateFrom: '',
        dateTo: ''
    });

    useEffect(() => {
        if (profile?.tenant_id) {
            userService.getUsers(profile.tenant_id)
                .then(res => setUsers(res.data))
                .catch(err => console.error('Error loading users for filter:', err));
        }
    }, [profile?.tenant_id]);

    const handleOpenDiff = (entry: AuditEntry) => {
        setSelectedEntry(entry);
        setIsDiffModalOpen(true);
    };

    const applyLocalFilters = () => {
        handleApplyFilters({
            userId: localFilters.userId || undefined,
            resourceType: localFilters.resourceType || undefined,
            action: localFilters.action || undefined,
            dateFrom: localFilters.dateFrom || undefined,
            dateTo: localFilters.dateTo || undefined
        });
    };

    const resetLocalFilters = () => {
        setLocalFilters({ userId: '', resourceType: '', action: '', dateFrom: '', dateTo: '' });
        handleResetFilters();
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <PageHeader
                icon={History}
                title={t('audit.header_title')}
                description={t('audit.header_desc')}
            />

            {/* Filters Card */}
            <div className="bg-white rounded-lg shadow-cards border border-border p-md md:p-lg">
                <div className="flex items-center gap-2 mb-md text-text-secondary">
                    <Filter size={18} />
                    <span className="text-sm font-bold uppercase tracking-wider">{t('audit.filters_title')}</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-md">
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('audit.filter_user')}</label>
                        <select
                            value={localFilters.userId}
                            onChange={(e) => setLocalFilters({ ...localFilters, userId: e.target.value })}
                            className="h-10 px-md rounded-md border border-border bg-surface text-body text-heading focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                        >
                            <option value="">{t('audit.all_users')}</option>
                            {users.map(u => (
                                <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('audit.filter_action')}</label>
                        <select
                            value={localFilters.action}
                            onChange={(e) => setLocalFilters({ ...localFilters, action: e.target.value as AuditAction || '' })}
                            className="h-10 px-md rounded-md border border-border bg-surface text-body text-heading focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                        >
                            <option value="">{t('audit.all_actions')}</option>
                            <option value="CREATE">{t('audit.labels.CREATE')}</option>
                            <option value="UPDATE">{t('audit.labels.UPDATE')}</option>
                            <option value="DELETE">{t('audit.labels.DELETE')}</option>
                            <option value="LOGIN">{t('audit.labels.LOGIN')}</option>
                            <option value="LOGIN_FAILED">{t('audit.labels.LOGIN_FAILED')}</option>
                            <option value="LOGOUT">{t('audit.labels.LOGOUT')}</option>
                            <option value="PASSWORD_CHANGE">{t('audit.labels.PASSWORD_CHANGE')}</option>
                            <option value="MFA_ENABLED">{t('audit.labels.MFA_ENABLED')}</option>
                            <option value="MFA_DISABLED">{t('audit.labels.MFA_DISABLED')}</option>
                            <option value="EXPORT">{t('audit.labels.EXPORT')}</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('audit.filter_module')}</label>
                        <select
                            value={localFilters.resourceType}
                            onChange={(e) => setLocalFilters({ ...localFilters, resourceType: e.target.value })}
                            className="h-10 px-md rounded-md border border-border bg-surface text-body text-heading focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                        >
                            <option value="">{t('audit.all_modules')}</option>
                            <option value="orders">{getAuditLabel('orders')}</option>
                            <option value="order_items">{getAuditLabel('order_items')}</option>
                            <option value="products">{getAuditLabel('products')}</option>
                            <option value="customers">{getAuditLabel('customers')}</option>
                            <option value="user_profiles">{getAuditLabel('user_profiles')}</option>
                            <option value="permission_matrix">{getAuditLabel('permission_matrix')}</option>
                            <option value="dispatchers">{getAuditLabel('dispatchers')}</option>
                            <option value="tenants">{getAuditLabel('tenants')}</option>
                            <option value="audit_log">{getAuditLabel('audit_log')}</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('audit.filter_from')}</label>
                        <InputField
                            type="date"
                            value={localFilters.dateFrom}
                            onChange={(e) => setLocalFilters({ ...localFilters, dateFrom: e.target.value })}
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase text-text-secondary ml-1">{t('audit.filter_to')}</label>
                        <InputField
                            type="date"
                            value={localFilters.dateTo}
                            onChange={(e) => setLocalFilters({ ...localFilters, dateTo: e.target.value })}
                        />
                    </div>
                </div>

                <div className="mt-lg flex flex-wrap gap-md justify-between items-center border-t border-border pt-md">
                    <div className="flex items-center gap-md">
                        <p className="text-caption text-text-secondary">
                            <Trans
                                i18nKey="audit.showing_count"
                                values={{ count: logs.length, total: totalCount }}
                                components={[<span className="font-bold text-heading" key="0" />, <span className="font-bold text-heading" key="2" />]}
                            />
                        </p>

                        <div className="h-4 w-[1px] bg-border mx-2 hidden md:block" />

                        <div className="flex gap-2">
                            <Button
                                variant="outline-success"
                                size="sm"
                                onClick={() => handleExport('excel')}
                                isLoading={isExporting === 'excel'}
                                disabled={isExporting !== null}
                                className="text-[10px] font-bold uppercase tracking-wider h-8 border-success/30 text-success hover:bg-success/5"
                            >
                                <Download size={14} className="mr-1" /> {t('audit.label_excel')}
                            </Button>
                            <Button
                                variant="outline-primary"
                                size="sm"
                                onClick={() => handleExport('csv')}
                                isLoading={isExporting === 'csv'}
                                disabled={isExporting !== null}
                                className="text-[10px] font-bold uppercase tracking-wider h-8 border-primary/30 text-primary hover:bg-primary/5"
                            >
                                <Download size={14} className="mr-1" /> {t('audit.label_csv')}
                            </Button>
                        </div>
                    </div>

                    <div className="flex gap-sm">
                        <Button variant="secondary" onClick={resetLocalFilters} className="flex items-center gap-2">
                            <RotateCcw size={16} /> {t('audit.btn_clear')}
                        </Button>
                        <Button onClick={applyLocalFilters} className="flex items-center gap-2 px-xl">
                            <Search size={16} /> {t('audit.btn_search')}
                        </Button>
                    </div>
                </div>
            </div>

            {/* Table Card */}
            <div className="bg-white rounded-lg shadow-cards border border-border overflow-hidden">
                {/* ── MOBILE: Card Layout ── */}
                <div className="md:hidden divide-y divide-border/50">
                    {isLoading ? (
                        Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="p-md animate-pulse flex flex-col gap-2">
                                <div className="h-4 bg-surface rounded w-1/3"></div>
                                <div className="h-8 bg-surface rounded w-full"></div>
                                <div className="h-4 bg-surface rounded w-1/2"></div>
                            </div>
                        ))
                    ) : logs.map((entry: AuditEntry) => {
                        const date = new Date(entry.created_at);
                        return (
                            <div key={entry.id} className="p-md flex flex-col gap-sm hover:bg-surface/30 transition-colors">
                                <div className="flex justify-between items-start">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-bold text-heading">
                                            {date.toLocaleDateString('es-SV')}
                                        </span>
                                        <span className="text-[10px] text-text-secondary">
                                            {date.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${AUDIT_COLORS[entry.action] || AUDIT_COLORS.DEFAULT}`}>
                                        {getAuditLabel(entry.action)}
                                    </span>
                                </div>

                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 bg-surface rounded-full text-text-secondary shrink-0">
                                        <User size={12} />
                                    </div>
                                    <span className="text-xs text-heading font-medium truncate">
                                        {entry.user_email || 'Sistema'}
                                    </span>
                                </div>

                                <div className="flex justify-between items-center">
                                    <div className="flex items-center gap-2">
                                        <Activity size={12} className="text-primary opacity-60" />
                                        <span className="text-xs font-bold text-heading capitalize">{getAuditLabel(entry.resource_type)}</span>
                                        {entry.resource_id && (
                                            <span className="text-[9px] font-mono text-text-secondary bg-surface px-1.5 rounded">
                                                ID: {entry.resource_id?.substring(0, 8)}
                                            </span>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleOpenDiff(entry)}
                                        className="p-2 text-primary hover:bg-primary/5 rounded-full transition-colors"
                                    >
                                        <Eye size={18} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* ── Desktop UI (Table) ── */}
                <div className="hidden lg:block overflow-x-auto">
                    <table className="w-full text-left border-collapse table-fixed">
                        <thead>
                            <tr className="bg-surface border-b border-border text-[10px] text-text-secondary uppercase tracking-wider">
                                <th className="p-sm font-semibold w-[15%]">{t('audit.table_date')}</th>
                                <th className="p-sm font-semibold w-[15%]">{t('audit.table_user')}</th>
                                <th className="p-sm font-semibold w-[10%] text-center">{t('audit.table_action')}</th>
                                <th className="p-sm font-semibold w-[12%] text-center">{t('audit.table_resource')}</th>
                                <th className="p-sm font-semibold w-[40%] text-right pr-lg">{t('audit.table_detail')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-border/50">
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i} className="animate-pulse">
                                        <td colSpan={5} className="p-sm h-16 bg-surface/30"></td>
                                    </tr>
                                ))
                            ) : logs.map((entry) => {
                                const date = new Date(entry.created_at);
                                return (
                                    <tr key={entry.id} className="hover:bg-surface/50 transition-colors">
                                        <td className="p-sm text-xs text-text-secondary whitespace-nowrap">
                                            {date.toLocaleString('es-SV', {
                                                day: '2-digit', month: '2-digit', year: 'numeric',
                                                hour: '2-digit', minute: '2-digit'
                                            })}
                                        </td>
                                        <td className="p-sm">
                                            <div className="flex items-center gap-2">
                                                <div className="p-1 bg-surface rounded-full text-text-secondary overflow-hidden shrink-0">
                                                    <User size={12} />
                                                </div>
                                                <span className="text-xs font-bold text-heading truncate" title={entry.user_email || ''}>
                                                    {entry.user_email || 'Sistema'}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="p-sm text-center">
                                            <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border ${AUDIT_COLORS[entry.action] || AUDIT_COLORS.DEFAULT}`}>
                                                {getAuditLabel(entry.action)}
                                            </span>
                                        </td>
                                        <td className="p-sm text-center">
                                            <div className="flex items-center justify-center gap-2">
                                                <span className="text-xs font-bold text-heading capitalize">{getAuditLabel(entry.resource_type)}</span>
                                                {entry.resource_id && (
                                                    <span className="text-[9px] font-mono text-text-secondary bg-surface px-1.5 rounded">
                                                        {entry.resource_id.substring(0, 8)}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-sm text-right pr-lg">
                                            <button
                                                onClick={() => handleOpenDiff(entry)}
                                                className="p-2 text-primary hover:bg-primary/5 rounded-full transition-colors"
                                                title={t('audit.view_detail_title')}
                                            >
                                                <Eye size={18} />
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {!isLoading && logs.length === 0 && (
                    <div className="p-xl text-center">
                        <div className="flex flex-col items-center justify-center opacity-60">
                            <History size={48} className="text-text-secondary mb-md" />
                            <span className="text-h3 text-heading">{t('audit.no_logs')}</span>
                            <span className="text-body text-text-secondary mt-1">{t('audit.adjust_filters')}</span>
                        </div>
                    </div>
                )}

                {totalCount > pageSize && (
                    <div className="p-md border-t border-border bg-surface/30">
                        <Pagination
                            currentPage={currentPage}
                            totalPages={Math.ceil(totalCount / pageSize)}
                            onPageChange={handlePageChange}
                            totalItems={totalCount}
                            pageSize={pageSize}
                        />
                    </div>
                )}
            </div>

            {error && (
                <div className="p-md bg-error/10 border border-error/20 rounded-lg text-error text-sm font-medium">
                    {error}
                </div>
            )}

            <AuditDiffModal
                isOpen={isDiffModalOpen}
                onClose={() => setIsDiffModalOpen(false)}
                entry={selectedEntry}
            />
        </div>
    );
};
