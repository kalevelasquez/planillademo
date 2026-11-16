import { useState, useCallback, useEffect } from 'react';
import { useAuditStore } from '../../../../store/auditStore';
import { useAuthStore } from '../../../../store/authStore';
import { auditService } from '../../../../services/auditService';
import type { AuditFilters } from '../../../../services/auditService';
import { useToast } from '../../../../context/ToastContext';
import { useTranslation } from 'react-i18next';
import { exportToExcel, exportToCSV } from '../../../../utils/exportUtils';
import { getAuditLabel } from './auditTranslate';

export const useAuditManagement = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const {
        logs,
        isLoading,
        error,
        totalCount,
        currentPage,
        pageSize,
        filters,
        fetchLogs,
        setFilters,
        resetFilters
    } = useAuditStore();

    const [isFirstLoad, setIsFirstLoad] = useState(true);
    const [isExporting, setIsExporting] = useState<'excel' | 'csv' | null>(null);

    const loadLogs = useCallback((page = 1) => {
        if (profile?.tenant_id) {
            fetchLogs(profile.tenant_id, page);
        }
    }, [profile?.tenant_id, fetchLogs]);

    useEffect(() => {
        if (isFirstLoad && profile?.tenant_id) {
            loadLogs(1);
            setIsFirstLoad(false);
        }
    }, [isFirstLoad, profile?.tenant_id, loadLogs]);

    const handlePageChange = (newPage: number) => {
        loadLogs(newPage);
    };

    const handleApplyFilters = (newFilters: AuditFilters) => {
        setFilters(newFilters);
        loadLogs(1);
    };

    const handleResetFilters = () => {
        resetFilters();
        loadLogs(1);
    };

    const handleExport = async (format: 'excel' | 'csv') => {
        if (!profile?.tenant_id) return;

        setIsExporting(format);
        try {
            // CA3: Registrar exportación AL INICIO para asegurar persistencia
            await auditService.logAction('EXPORT', 'audit_log', undefined, {
                format: format.toUpperCase(),
                filters_applied: filters
            });

            // Refresco con ligero delay para asegurar que el insert sea visible en el select subsiguiente
            setTimeout(() => loadLogs(1), 500);

            // Obtener lote completo (máximo 5000 para exportar)
            const { data } = await auditService.getAuditLogs(
                profile.tenant_id,
                1,
                5000,
                filters
            );

            if (data.length === 0) {
                showToast(t('common.no_results'), 'info');
                return;
            }

            // Mapeo y formateo para reporte profesional
            const reportData = data.map(entry => {
                const date = new Date(entry.created_at);
                return {
                    'Fecha': date.toLocaleDateString('es-SV'),
                    'Hora': date.toLocaleTimeString('es-SV'),
                    'Usuario': entry.user_email || 'Sistema',
                    'Acción': getAuditLabel(entry.action),
                    'Recurso': getAuditLabel(entry.resource_type),
                    'ID Recurso': entry.resource_id || t('common.not_available'),
                    'Valores Anteriores': entry.old_values ? JSON.stringify(entry.old_values, null, 2) : '',
                    'Valores Nuevos': entry.new_values ? JSON.stringify(entry.new_values, null, 2) : ''
                };
            });

            const fileName = `${t('audit.export_filename')}_${new Date().toISOString().split('T')[0]}`;

            if (format === 'excel') {
                await exportToExcel(reportData, fileName, 'Auditoría');
            } else {
                await exportToCSV(reportData, fileName);
            }

            showToast(t('audit.export_success'), 'success');
        } catch (err) {
            console.error('[Export] Error:', err);
            showToast(t('audit.export_error'), 'error');
        } finally {
            setIsExporting(null);
        }
    };

    return {
        logs,
        isLoading,
        error,
        totalCount,
        currentPage,
        pageSize,
        filters,
        isExporting,
        handlePageChange,
        handleApplyFilters,
        handleResetFilters,
        handleExport,
        refresh: () => loadLogs(currentPage)
    };
};
