import { create } from 'zustand';
import type { InstitucionVivienda } from '../services/institucionesViviendaService';
import { institucionesViviendaService } from '../services/institucionesViviendaService';

interface InstitucionesViviendaState {
    instituciones: InstitucionVivienda[];
    isLoading: boolean;
    error: string | null;

    fetchInstituciones: () => Promise<void>;
}

// Consumido por DescuentosSection, como complemento del catálogo de Bancos cuando la categoría
// del descuento es "Vivienda" — un préstamo de vivienda puede ser con el FSV/Hábitat para la
// Humanidad directamente, o con un banco comercial (se muestran ambos catálogos juntos).
export const useInstitucionesViviendaStore = create<InstitucionesViviendaState>((set) => ({
    instituciones: [],
    isLoading: false,
    error: null,

    fetchInstituciones: async () => {
        set({ isLoading: true, error: null });
        try {
            const instituciones = await institucionesViviendaService.getInstituciones();
            set({ instituciones });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Error al cargar instituciones de vivienda';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },
}));
