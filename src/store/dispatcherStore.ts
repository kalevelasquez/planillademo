import { create } from 'zustand';
import { dispatcherService, type Dispatcher, type CreateDispatcherDTO } from '../services/dispatcherService';

interface DispatcherState {
    dispatchers: Dispatcher[];
    isLoading: boolean;
    error: string | null;

    fetchDispatchers: (tenantId: string) => Promise<void>;
    addDispatcher: (dto: CreateDispatcherDTO) => Promise<void>;
    editDispatcher: (id: string, dto: Partial<CreateDispatcherDTO>) => Promise<void>;
    removeDispatcher: (id: string) => Promise<void>;
}

export const useDispatcherStore = create<DispatcherState>((set, get) => ({
    dispatchers: [],
    isLoading: false,
    error: null,

    fetchDispatchers: async (tenantId) => {
        set({ isLoading: true, error: null });
        try {
            const data = await dispatcherService.getDispatchers(tenantId);
            set({ dispatchers: data, isLoading: false });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    addDispatcher: async (dto) => {
        set({ isLoading: true, error: null });
        try {
            const newDispatcher = await dispatcherService.createDispatcher(dto);
            set({ dispatchers: [...get().dispatchers, newDispatcher], isLoading: false });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    editDispatcher: async (id, dto) => {
        set({ isLoading: true, error: null });
        try {
            const updated = await dispatcherService.updateDispatcher(id, dto);
            set({
                dispatchers: get().dispatchers.map(d => d.id === id ? updated : d),
                isLoading: false
            });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    },

    removeDispatcher: async (id) => {
        set({ isLoading: true, error: null });
        try {
            await dispatcherService.deleteDispatcher(id);
            set({
                dispatchers: get().dispatchers.filter(d => d.id !== id),
                isLoading: false
            });
        } catch (err: any) {
            set({ error: err.message, isLoading: false });
        }
    }
}));
