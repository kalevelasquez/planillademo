import { create } from 'zustand';
import type { TipoContrato } from '../services/tiposContratoService';
import { tiposContratoService } from '../services/tiposContratoService';

interface TiposContratoState {
    tiposContrato: TipoContrato[];
    isLoading: boolean;
    error: string | null;

    fetchTiposContrato: () => Promise<void>;
    upsertTipoContrato: (tipoContrato: TipoContrato) => void;
}

// Compartido entre TiposContratoConfigView (CRUD) y EmpleadoDetailView (select del formulario).
export const useTiposContratoStore = create<TiposContratoState>((set) => ({
    tiposContrato: [],
    isLoading: false,
    error: null,

    fetchTiposContrato: async () => {
        set({ isLoading: true, error: null });
        try {
            const tiposContrato = await tiposContratoService.getTiposContrato();
            set({ tiposContrato });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Error al cargar tipos de contrato';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },

    upsertTipoContrato: (tipoContrato) =>
        set((state) => {
            const existe = state.tiposContrato.some((tc) => tc.id === tipoContrato.id);
            return {
                tiposContrato: existe
                    ? state.tiposContrato.map((tc) => (tc.id === tipoContrato.id ? tipoContrato : tc))
                    : [...state.tiposContrato, tipoContrato].sort((a, b) => a.nombre.localeCompare(b.nombre)),
            };
        }),
}));
