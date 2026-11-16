import { create } from 'zustand';
import type { Product, FilterState } from '../services/productService';
import { productService, INITIAL_FILTERS } from '../services/productService';

interface ProductState {
    products: Product[];
    isLoading: boolean;
    error: string | null;
    page: number;
    searchQuery: string;
    hasMore: boolean;
    filters: FilterState;
    // filterOptions se gestiona en CatalogView para congelarlas en la primera carga
    fetchProducts: (page?: number, searchQuery?: string, filters?: FilterState) => Promise<void>;
    setFilters: (filters: FilterState) => void;
    resetFilters: () => void;
}

export const useProductStore = create<ProductState>((set) => ({
    products: [],
    isLoading: false,
    error: null,
    page: 1,
    searchQuery: '',
    hasMore: true,
    filters: INITIAL_FILTERS,

    setFilters: (filters) => set({ filters }),

    resetFilters: () => set({ filters: INITIAL_FILTERS }),

    fetchProducts: async (page = 1, searchQuery = '', filters = INITIAL_FILTERS) => {
        set({ isLoading: true, error: null, page, searchQuery, filters });
        try {
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('El servidor tardó demasiado en responder.')), 15000)
            );

            const response = await Promise.race([
                productService.getProducts(page, searchQuery, 20, 'active', filters),
                timeout,
            ]) as { data: Product[], count: number };

            set((state) => {
                const existingProdIds = new Set(state.products.map(p => p.id));
                const uniqueNewItems = response.data.filter(p => !existingProdIds.has(p.id));

                return {
                    products: page === 1 ? response.data : [...state.products, ...uniqueNewItems],
                    hasMore: response.data.length === 20,
                    page
                };
            });
        } catch (error: unknown) {
            console.error('Error fetching products:', error);
            const msg = error instanceof Error ? error.message : 'Error al cargar productos';
            set({ error: msg });
        } finally {
            set({ isLoading: false });
        }
    },
}));
