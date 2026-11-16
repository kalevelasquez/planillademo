import { create } from 'zustand';
import type { Departamento } from '../services/departamentosService';
import { departamentosService } from '../services/departamentosService';

interface DepartamentosState {
    departamentos: Departamento[];
    isLoading: boolean;
    error: string | null;

    fetchDepartamentos: () => Promise<void>;
    upsertDepartamento: (departamento: Departamento) => void;
}

// Compartido entre DepartamentosConfigView (CRUD), EmpleadosListView (color del badge) y
// EmpleadoDetailView (select del formulario) — misma lista, sin duplicar el fetch.
export const useDepartamentosStore = create<DepartamentosState>((set) => ({
    departamentos: [],
    isLoading: false,
    error: null,

    fetchDepartamentos: async () => {
        set({ isLoading: true, error: null });
        try {
            const departamentos = await departamentosService.getDepartamentos();
            set({ departamentos });
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : 'Error al cargar departamentos';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },

    upsertDepartamento: (departamento) =>
        set((state) => {
            const existe = state.departamentos.some((d) => d.id === departamento.id);
            return {
                departamentos: existe
                    ? state.departamentos.map((d) => (d.id === departamento.id ? departamento : d))
                    : [...state.departamentos, departamento].sort((a, b) => a.nombre.localeCompare(b.nombre)),
            };
        }),
}));
