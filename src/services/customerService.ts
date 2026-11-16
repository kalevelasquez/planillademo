import { supabase } from '../config/supabaseClient';

export interface Customer {
    id: string;
    tenant_id: string;
    assigned_seller_id: string | null;
    business_name: string;
    contact_name: string | null;
    phone: string | null;
    address?: string | null;
    department?: string | null;
    municipality?: string | null;
    identification_number?: string | null;
    internal_code?: string | null;
    notes?: string | null;
    status: 'activo' | 'inactivo';
    price_type: 'empleado' | 'cliente' | 'mayoreo';
    created_at: string;
    deleted_at: string | null;
    seller?: {
        full_name: string;
    } | null;
}

export type CreateCustomerDTO = Omit<Customer, 'id' | 'created_at' | 'deleted_at' | 'seller' | 'status'> & { status?: string };
export type UpdateCustomerDTO = Partial<CreateCustomerDTO>;

export interface CustomerFilters {
    status?: string;
    price_type?: string;
    department?: string;
}

export interface GetCustomersResult {
    data: Customer[];
    total: number; // total de registros que coinciden con el filtro
}

export const PAGE_SIZE = 20;

export const customerService = {
    /**
     * Obtiene la lista de clientes con paginación y búsqueda.
     * Devuelve los datos de la página + el total de registros para el cálculo de páginas.
     * El filtro por tenant_id se aplica automáticamente por RLS.
     */
    async getCustomers(
        page: number = 1,
        searchQuery: string = '',
        filters?: CustomerFilters,
        limit: number = PAGE_SIZE
    ): Promise<GetCustomersResult> {
        let query = supabase
            .from('customers')
            .select('*, seller:user_profiles!customers_assigned_seller_id_fkey(full_name)', { count: 'exact' });

        if (searchQuery.trim()) {
            const term = `%${searchQuery.trim()}%`;
            query = query.or(`business_name.ilike.${term},contact_name.ilike.${term},department.ilike.${term},municipality.ilike.${term},identification_number.ilike.${term},internal_code.ilike.${term},phone.ilike.${term},address.ilike.${term}`);
        }

        if (filters?.status) {
            query = query.eq('status', filters.status);
        }
        if (filters?.price_type) {
            query = query.eq('price_type', filters.price_type);
        }
        if (filters?.department) {
            query = query.ilike('department', `%${filters.department}%`);
        }

        query = query.is('deleted_at', null).order('created_at', { ascending: false });

        const from = (page - 1) * limit;
        const to = from + limit - 1;

        const { data, error, count } = await query.range(from, to);

        if (error) throw error;
        return { data: data || [], total: count ?? 0 };
    },

    /**
     * Crea un nuevo cliente.
     */
    async createCustomer(customerData: CreateCustomerDTO): Promise<Customer> {
        const { data, error } = await supabase
            .from('customers')
            .insert([customerData])
            .select()
            .single();

        if (error) throw error;
        return data;
    },

    /**
     * Actualiza el vendedor asignado a un cliente.
     */
    async updateCustomerSeller(customerId: string, sellerId: string | null): Promise<void> {
        const { error } = await supabase
            .from('customers')
            .update({ assigned_seller_id: sellerId })
            .eq('id', customerId);

        if (error) throw error;
    },

    /**
     * Actualiza la información completa de un cliente.
     */
    async updateCustomer(customerId: string, customerData: UpdateCustomerDTO): Promise<Customer> {
        // Limpieza estricta de datos para evitar errores de tipo en DB (como objetos o arrays mal formados)
        const cleanData = {
            business_name: customerData.business_name,
            contact_name: customerData.contact_name,
            phone: customerData.phone,
            address: customerData.address,
            department: customerData.department,
            municipality: customerData.municipality,
            identification_number: customerData.identification_number,
            internal_code: customerData.internal_code,
            notes: customerData.notes,
            status: customerData.status,
            price_type: customerData.price_type,
            assigned_seller_id: customerData.assigned_seller_id,
        };

        // Eliminar undefined para que Supabase no intente actualizarlos a literal 'undefined'
        Object.keys(cleanData).forEach(key =>
            (cleanData as any)[key] === undefined && delete (cleanData as any)[key]
        );

        const { data, error } = await supabase
            .from('customers')
            .update(cleanData)
            .eq('id', customerId)
            .select()
            .single();

        if (error) throw error;
        return data;
    }
};
