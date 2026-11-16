import { create } from 'zustand';
import type { Customer, CustomerFilters } from '../services/customerService';
import { customerService, PAGE_SIZE } from '../services/customerService';

interface CustomerState {
    customers: Customer[];
    isLoading: boolean;
    error: string | null;

    // Paginación
    page: number;
    totalCount: number;     // Total de registros del servidor
    totalPages: number;     // Páginas calculadas
    hasMore: boolean;       // Para el modo "Load More" (mobile)
    searchQuery: string;
    filters: CustomerFilters;

    // Acciones
    fetchCustomers: (page?: number, searchQuery?: string, filters?: CustomerFilters) => Promise<void>;
    fetchPage: (page: number, searchQuery?: string, filters?: CustomerFilters) => Promise<void>;  // Desktop: reemplaza registros
    setFilters: (filters: CustomerFilters) => void;
    addCustomer: (customer: Customer) => void;
    updateCustomer: (customerId: string, data: Partial<Customer>) => void;
}

export const useCustomerStore = create<CustomerState>((set, get) => ({
    customers: [],
    isLoading: false,
    error: null,
    page: 1,
    totalCount: 0,
    totalPages: 1,
    hasMore: false,
    searchQuery: '',
    filters: {},

    /**
     * fetchCustomers — Modo "Load More" (Mobile)
     * page=1: reemplaza lista. page>1: acumula hacia abajo.
     */
    fetchCustomers: async (page = 1, searchQuery = '', filters) => {
        const currentFilters = filters ?? get().filters;
        set({ isLoading: true, error: null, page, searchQuery, filters: currentFilters });
        try {
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('El servidor tardó demasiado en responder.')), 15000)
            );

            const result = await Promise.race([
                customerService.getCustomers(page, searchQuery, currentFilters, PAGE_SIZE),
                timeout
            ]);

            const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
            const state = get();

            set({
                customers: page === 1 ? result.data : [...state.customers, ...result.data],
                totalCount: result.total,
                totalPages,
                hasMore: page < totalPages,
            });
        } catch (error: unknown) {
            console.error('Error fetching customers:', error);
            const msg = error instanceof Error ? error.message : 'Error al cargar clientes';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },

    /**
     * fetchPage — Modo "Pagination" (Desktop)
     * Siempre reemplaza los registros actuales con la página solicitada.
     */
    fetchPage: async (page, searchQuery, filters) => {
        const currentQuery = searchQuery ?? get().searchQuery;
        const currentFilters = filters ?? get().filters;
        set({ isLoading: true, error: null, page, searchQuery: currentQuery, filters: currentFilters });
        try {
            const result = await customerService.getCustomers(page, currentQuery, currentFilters, PAGE_SIZE);
            const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

            set({
                customers: result.data,
                totalCount: result.total,
                totalPages,
                hasMore: page < totalPages,
            });
        } catch (error: unknown) {
            console.error('Error fetching page:', error);
            const msg = error instanceof Error ? error.message : 'Error al cargar clientes';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },

    setFilters: (filters) => set({ filters, page: 1 }),

    addCustomer: (customer) => set((state) => ({
        customers: [customer, ...state.customers],
        totalCount: state.totalCount + 1,
        totalPages: Math.max(1, Math.ceil((state.totalCount + 1) / PAGE_SIZE)),
    })),

    updateCustomer: (customerId, data) => set((state) => ({
        customers: state.customers.map((c) => (c.id === customerId ? { ...c, ...data } : c)),
    })),
}));
