import { create } from 'zustand';
import { auditService } from '../services/auditService';
import type { AuditEntry, AuditFilters } from '../services/auditService';

interface AuditState {
    logs: AuditEntry[];
    isLoading: boolean;
    error: string | null;
    totalCount: number;
    currentPage: number;
    pageSize: number;
    filters: AuditFilters;
    fetchLogs: (tenantId: string, page?: number) => Promise<void>;
    setFilters: (filters: AuditFilters) => void;
    resetFilters: () => void;
}

export const useAuditStore = create<AuditState>((set, get) => ({
    logs: [],
    isLoading: false,
    error: null,
    totalCount: 0,
    currentPage: 1,
    pageSize: 20,
    filters: {},

    setFilters: (filters) => {
        set({ filters, currentPage: 1 });
    },

    resetFilters: () => {
        set({ filters: {}, currentPage: 1 });
    },

    fetchLogs: async (tenantId: string, page = 1) => {
        set({ isLoading: true, error: null });
        try {
            const { filters, pageSize } = get();
            const response = await auditService.getAuditLogs(tenantId, page, pageSize, filters);

            set({
                logs: response.data,
                totalCount: response.count,
                currentPage: page,
                isLoading: false
            });
        } catch (error: any) {
            set({
                error: error.message || 'Error al cargar el log de auditoría',
                isLoading: false
            });
        }
    }
}));
