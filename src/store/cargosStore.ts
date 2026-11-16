import { create } from 'zustand';
import type { Cargo } from '../services/cargosService';
import { cargosService } from '../services/cargosService';

interface CargosState {
    cargos: Cargo[];
    isLoading: boolean;
    error: string | null;

    fetchCargos: () => Promise<void>;
    upsertCargo: (cargo: Cargo) => void;
}

// Compartido entre CargosConfigView (CRUD), EmpleadoDetailView (select del perfil),
// TarifasKmConfigView y JornadasConfigView (selects de sus modales de alta) — misma lista,
// sin duplicar el fetch (mismo patrón que useDepartamentosStore).
export const useCargosStore = create<CargosState>((set) => ({
    cargos: [],
    isLoading: false,
    error: null,

    fetchCargos: async () => {
        set({ isLoading: true, error: null });
        try {
            const cargos = await cargosService.getCargos();
            set({ cargos });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Error al cargar cargos';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },

    upsertCargo: (cargo) =>
        set((state) => {
            const existe = state.cargos.some((c) => c.id === cargo.id);
            return {
                cargos: existe
                    ? state.cargos.map((c) => (c.id === cargo.id ? cargo : c))
                    : [...state.cargos, cargo].sort((a, b) => a.nombre.localeCompare(b.nombre)),
            };
        }),
}));
