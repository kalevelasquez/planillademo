import { create } from 'zustand';
import type { Banco } from '../services/bancosService';
import { bancosService } from '../services/bancosService';

interface BancosState {
    bancos: Banco[];
    isLoading: boolean;
    error: string | null;

    fetchBancos: () => Promise<void>;
    upsertBanco: (banco: Banco) => void;
}

// Compartido entre BancosConfigView (CRUD) y EmpleadoDetailView (select del formulario) — misma
// lista, sin duplicar el fetch. Mismo patrón que useDepartamentosStore.
export const useBancosStore = create<BancosState>((set) => ({
    bancos: [],
    isLoading: false,
    error: null,

    fetchBancos: async () => {
        set({ isLoading: true, error: null });
        try {
            const bancos = await bancosService.getBancos();
            set({ bancos });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Error al cargar bancos';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },

    upsertBanco: (banco) =>
        set((state) => {
            const existe = state.bancos.some((b) => b.id === banco.id);
            return {
                bancos: existe
                    ? state.bancos.map((b) => (b.id === banco.id ? banco : b))
                    : [...state.bancos, banco].sort((a, b) => a.nombre.localeCompare(b.nombre)),
            };
        }),
}));
