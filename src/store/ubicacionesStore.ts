import { create } from 'zustand';
import type { Ubicacion } from '../services/ubicacionesService';
import { ubicacionesService } from '../services/ubicacionesService';

interface UbicacionesState {
    ubicaciones: Ubicacion[];
    isLoading: boolean;
    error: string | null;

    fetchUbicaciones: () => Promise<void>;
    upsertUbicacion: (ubicacion: Ubicacion) => void;
}

// Compartido entre UbicacionesConfigView (CRUD) y HorasExtrasView (tabs, US-HEX-00 CA3) —
// ambas necesitan la misma lista, sin duplicar el fetch.
export const useUbicacionesStore = create<UbicacionesState>((set) => ({
    ubicaciones: [],
    isLoading: false,
    error: null,

    fetchUbicaciones: async () => {
        set({ isLoading: true, error: null });
        try {
            const ubicaciones = await ubicacionesService.getUbicaciones();
            set({ ubicaciones });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Error al cargar ubicaciones';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },

    upsertUbicacion: (ubicacion) =>
        set((state) => {
            const existe = state.ubicaciones.some((u) => u.id === ubicacion.id);
            return {
                ubicaciones: existe
                    ? state.ubicaciones.map((u) => (u.id === ubicacion.id ? ubicacion : u))
                    : [...state.ubicaciones, ubicacion].sort((a, b) => a.nombre.localeCompare(b.nombre)),
            };
        }),
}));
