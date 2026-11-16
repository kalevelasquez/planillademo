import { create } from 'zustand';
import type { Destino } from '../services/destinosService';
import { destinosService } from '../services/destinosService';

interface DestinosState {
    destinos: Destino[];
    isLoading: boolean;
    error: string | null;

    fetchDestinos: () => Promise<void>;
    upsertDestino: (destino: Destino) => void;
}

// Compartido entre DestinosConfigView (CRUD) e ImportarViaticosLoteModal (precarga de monto por
// Destino, IMPL-170 CA4) — misma lista, sin duplicar el fetch. Mismo patrón que useBancosStore.
export const useDestinosStore = create<DestinosState>((set) => ({
    destinos: [],
    isLoading: false,
    error: null,

    fetchDestinos: async () => {
        set({ isLoading: true, error: null });
        try {
            const destinos = await destinosService.getDestinos();
            set({ destinos });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Error al cargar destinos';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },

    upsertDestino: (destino) =>
        set((state) => {
            const existe = state.destinos.some((d) => d.id === destino.id);
            return {
                destinos: existe
                    ? state.destinos.map((d) => (d.id === destino.id ? destino : d))
                    : [...state.destinos, destino].sort((a, b) => a.nombre.localeCompare(b.nombre)),
            };
        }),
}));
