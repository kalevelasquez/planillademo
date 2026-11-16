import { create } from 'zustand';
import type { Quincena } from '../services/quincenasService';
import { quincenasService } from '../services/quincenasService';

interface QuincenasState {
    quincenas: Quincena[];
    isLoading: boolean;
    error: string | null;
    quincenaSeleccionadaId: string;

    fetchQuincenas: () => Promise<void>;
    addQuincena: (quincena: Quincena) => void;
    setQuincenaSeleccionadaId: (id: string) => void;
}

// Store mínimo por ahora — IMPL-10 (dashboard) e IMPL-12 (estados) lo van a extender
// con la noción de "quincena activa" y el selector.
export const useQuincenasStore = create<QuincenasState>((set) => ({
    quincenas: [],
    isLoading: false,
    error: null,
    // Vive acá (no como useState local de PlanillaLayout) para sobrevivir remontes del layout
    // — ej. /planilla/empleados/nuevo está fuera de PlanillaLayout a propósito, y navegar ahí y
    // volver remonta el layout; con useState local eso reseteaba la selección del usuario a la
    // "quincena activa" por defecto (bug encontrado en UAT de IMPL-2).
    quincenaSeleccionadaId: '',

    fetchQuincenas: async () => {
        set({ isLoading: true, error: null });
        try {
            const quincenas = await quincenasService.getQuincenas();
            set({ quincenas });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Error al cargar quincenas';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },

    addQuincena: (quincena) => set((state) => ({ quincenas: [quincena, ...state.quincenas] })),
    setQuincenaSeleccionadaId: (id) => set({ quincenaSeleccionadaId: id }),
}));
