import { supabase } from './authService';

export interface Dispatcher {
    id: string;
    tenant_id: string;
    name: string;
    phone: string;
    created_at: string;
    deleted_at: string | null;
}

export interface CreateDispatcherDTO {
    tenant_id: string;
    name: string;
    phone: string;
}

export const dispatcherService = {
    async getDispatchers(tenantId: string): Promise<Dispatcher[]> {
        const { data, error } = await supabase
            .from('dispatchers')
            .select('*')
            .eq('tenant_id', tenantId)
            .is('deleted_at', null)
            .order('name', { ascending: true });

        if (error) throw error;
        return data || [];
    },

    async createDispatcher(dto: CreateDispatcherDTO): Promise<Dispatcher> {
        const { data, error } = await supabase
            .from('dispatchers')
            .insert(dto)
            .select('*')
            .single();

        if (error) throw error;
        return data;
    },

    async updateDispatcher(id: string, dto: Partial<CreateDispatcherDTO>): Promise<Dispatcher> {
        const { data, error } = await supabase
            .from('dispatchers')
            .update(dto)
            .eq('id', id)
            .select('*')
            .single();

        if (error) throw error;
        return data;
    },

    async deleteDispatcher(id: string): Promise<void> {
        // Realizamos un soft-delete
        const { error } = await supabase
            .from('dispatchers')
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', id);

        if (error) throw error;
    }
};
