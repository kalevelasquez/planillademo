import { create } from 'zustand';
import type { Empleado, EmpleadoFilters, EmpleadosIndicadores, PeriodoQuincena } from '../services/planillaEmpleadosService';
import { planillaEmpleadosService, PAGE_SIZE } from '../services/planillaEmpleadosService';

interface PlanillaEmpleadosState {
    empleados: Empleado[];
    isLoading: boolean;
    error: string | null;

    // Paginación
    page: number;
    totalCount: number;
    totalPages: number;
    hasMore: boolean;
    searchQuery: string;
    filters: EmpleadoFilters;

    // Indicadores
    indicadores: EmpleadosIndicadores | null;
    isLoadingIndicadores: boolean;
    indicadoresError: string | null;

    // Acciones
    fetchEmpleados: (page?: number, searchQuery?: string, filters?: EmpleadoFilters) => Promise<void>; // Mobile: acumula
    fetchPage: (page: number, searchQuery?: string, filters?: EmpleadoFilters) => Promise<void>; // Desktop: reemplaza
    setFilters: (filters: EmpleadoFilters) => void;
    fetchIndicadores: (periodo?: PeriodoQuincena) => Promise<void>;
    addEmpleado: (empleado: Empleado) => void;
    updateEmpleadoLocal: (id: string, data: Partial<Empleado>) => void;
}

// Guard de carrera (QA-Empleados gap #1): fetchEmpleados y fetchPage son fire-and-forget desde
// la vista (búsqueda con debounce, cambio de página) — sin esto, una respuesta ancha (sin
// filtro) que resuelve DESPUÉS de una más específica pisa en silencio el resultado correcto.
// Contador módulo-level compartido entre ambas funciones: cada llamada captura su propio
// requestId antes de despachar el fetch, y solo aplica su `set(...)` de resultado si sigue
// siendo la más reciente emitida al momento de resolver.
let requestCounter = 0;

export const usePlanillaEmpleadosStore = create<PlanillaEmpleadosState>((set, get) => ({
    empleados: [],
    isLoading: false,
    error: null,
    page: 1,
    totalCount: 0,
    totalPages: 1,
    hasMore: false,
    searchQuery: '',
    filters: {},
    indicadores: null,
    isLoadingIndicadores: false,
    indicadoresError: null,

    fetchEmpleados: async (page = 1, searchQuery = '', filters) => {
        const currentFilters = filters ?? get().filters;
        const requestId = ++requestCounter;
        set({ isLoading: true, error: null, page, searchQuery, filters: currentFilters });
        try {
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('El servidor tardó demasiado en responder.')), 15000)
            );

            const result = await Promise.race([
                planillaEmpleadosService.getEmpleados(page, searchQuery, currentFilters, PAGE_SIZE),
                timeout
            ]);

            if (requestId !== requestCounter) return; // respuesta obsoleta, se descarta

            const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
            const state = get();

            set({
                empleados: page === 1 ? result.data : [...state.empleados, ...result.data],
                totalCount: result.total,
                totalPages,
                hasMore: page < totalPages,
            });
        } catch (error: unknown) {
            if (requestId !== requestCounter) return; // error de una request obsoleta
            console.error('Error fetching empleados:', error);
            const msg = error instanceof Error ? error.message : 'Error al cargar empleados';
            set({ error: msg });
        } finally {
            if (requestId === requestCounter) set({ isLoading: false });
        }
    },

    fetchPage: async (page, searchQuery, filters) => {
        const currentQuery = searchQuery ?? get().searchQuery;
        const currentFilters = filters ?? get().filters;
        const requestId = ++requestCounter;
        set({ isLoading: true, error: null, page, searchQuery: currentQuery, filters: currentFilters });
        try {
            const result = await planillaEmpleadosService.getEmpleados(page, currentQuery, currentFilters, PAGE_SIZE);

            if (requestId !== requestCounter) return; // respuesta obsoleta, se descarta

            const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

            set({
                empleados: result.data,
                totalCount: result.total,
                totalPages,
                hasMore: page < totalPages,
            });
        } catch (error: unknown) {
            if (requestId !== requestCounter) return; // error de una request obsoleta
            console.error('Error fetching page:', error);
            const msg = error instanceof Error ? error.message : 'Error al cargar empleados';
            set({ error: msg });
        } finally {
            if (requestId === requestCounter) set({ isLoading: false });
        }
    },

    setFilters: (filters) => set({ filters, page: 1 }),

    // QA-Empleados gap #4 — mismo criterio de "no confundir fetch fallido con dato real" que ya
    // se aplicó a la tabla principal (ver `error` arriba): antes esto solo hacía console.error y
    // dejaba `indicadores` en null, que la vista mostraba como 0 en las 4 tarjetas — indistinguible
    // de un tenant realmente sin empleados.
    fetchIndicadores: async (periodo) => {
        set({ isLoadingIndicadores: true, indicadoresError: null });
        try {
            const indicadores = await planillaEmpleadosService.getIndicadores(periodo);
            set({ indicadores, indicadoresError: null });
        } catch (error: unknown) {
            console.error('Error fetching indicadores:', error);
            const msg = error instanceof Error ? error.message : 'Error al cargar los indicadores';
            set({ indicadoresError: msg });
        } finally {
            set({ isLoadingIndicadores: false });
        }
    },

    addEmpleado: (empleado) => set((state) => ({
        empleados: [empleado, ...state.empleados],
        totalCount: state.totalCount + 1,
        totalPages: Math.max(1, Math.ceil((state.totalCount + 1) / PAGE_SIZE)),
    })),

    updateEmpleadoLocal: (id, data) => set((state) => ({
        empleados: state.empleados.map((e) => (e.id === id ? { ...e, ...data } : e)),
    })),
}));
