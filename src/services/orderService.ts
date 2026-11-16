import { supabase } from './authService'; // Updated for synchronization check
import { ORDER_STATUS } from '../config/constants';
import { Logger } from '../utils/logger';
import { getFriendlyError } from '../utils/errorMapper';

interface ProcessedOrderItem {
    product_id: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    notes?: string;  // Nota por línea (US-ORD-05 CA2)
    discount_type?: 'fixed' | 'percentage';
    discount_amount?: number;
}

interface CreateOrderPayload {
    tenant_id: string;
    customer_id: string;
    seller_id: string;
    subtotal: number;
    discount_type?: 'percentage' | 'fixed' | null;
    discount_amount?: number;
    total_amount: number;
    notes?: string;  // Nota del pedido (US-ORD-05 CA1)
    items: ProcessedOrderItem[];
}

export interface DraftOrderPayload {
    draftId: string | null;
    tenant_id: string;
    customer_id: string;
    seller_id: string;
    subtotal: number;
    discount_type?: 'percentage' | 'fixed' | null;
    discount_amount?: number;
    total_amount: number;
    notes?: string;  // Nota del pedido (US-ORD-05 CA1)
    items: ProcessedOrderItem[];
}

export interface OrderDTO {
    id: string;
    order_number: string;
    created_at: string;
    status: string;
    subtotal: number;
    discount_type: 'percentage' | 'fixed' | null;
    discount_amount: number;
    total_amount: number;
    notes?: string;  // Nota del pedido (US-ORD-05 CA1)
    customer_id: string | null;
    seller_id: string | null;
    handled_by: string | null;
    tenant_id?: string;
    customers: {
        id: string;
        business_name: string;
        contact_name?: string | null;
        phone?: string | null;
        address?: string | null;
        department?: string | null;
        municipality?: string | null;
        identification_number?: string | null;
        internal_code?: string | null;
        price_type?: string;
        tenant_id?: string;
    } | null;
    user_profiles: { full_name: string } | null;
    creator?: { full_name: string } | null;
    dispatcher?: { full_name: string } | null;
    order_items?: OrderItemDetail[];
}

export interface OrderItemDetail {
    id: string;
    order_id: string;
    product_id: string; // Añadido para robustez
    quantity: number;
    unit_price: number;
    total_price: number;
    notes?: string;  // Nota por línea (US-ORD-05 CA2)
    discount_type?: string | null;
    discount_amount?: number | null;
    products: {
        id: string;
        name: string;
        brand: string | null;
        caliber: string | null;
        quality: string | null;
        shipment_number?: string | null;
    } | null;
}

/** Filtros opcionales para la consulta de la lista de pedidos (US-HIS-01) */
export interface OrderFilters {
    status?: string;    // Valor exacto del enum: 'Draft' | 'Approved' | etc.
    dateFrom?: string;  // ISO date 'YYYY-MM-DD' — filtro gte en created_at
    dateTo?: string;    // ISO date 'YYYY-MM-DD' — filtro lte en created_at (se agrega T23:59:59)
    customerId?: string; // US-CLI-03: Filtrar pedidos de un cliente específico
}

export const orderService = {
    async getOrderById(orderId: string): Promise<OrderDTO | null> {
        const { data, error } = await supabase
            .from('orders')
            .select(
                'id, order_number, created_at, status, customer_id, seller_id, handled_by, notes, tenant_id, ' +
                'subtotal, discount_type, discount_amount, total_amount, ' +
                'customers(id, business_name, contact_name, phone, address, department, municipality, identification_number, internal_code), ' +
                'creator:user_profiles!orders_seller_id_fkey(full_name), ' +
                'dispatcher:user_profiles!orders_handled_by_fkey(full_name)'
            )
            .eq('id', orderId)
            .maybeSingle();

        if (error) throw error;
        return data as unknown as OrderDTO;
    },

    async getOrders(
        tenantId: string,
        page: number = 1,
        searchQuery: string = '',
        filters?: OrderFilters,
        limit: number = 20
    ): Promise<{ data: OrderDTO[], count: number }> {
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        // Revertimos a left join normal (sin !inner) para evitar problemas si un pedido no tiene cliente.
        let query = supabase
            .from('orders')
            .select(
                'id, order_number, created_at, status, customer_id, seller_id, notes, tenant_id, ' +
                'subtotal, discount_type, discount_amount, total_amount, ' +
                'customers(id, business_name, contact_name, phone, price_type, tenant_id), ' +
                'creator:user_profiles!orders_seller_id_fkey(full_name)',
                { count: 'exact' }
            )
            .eq('tenant_id', tenantId);

        if (searchQuery) {
            const { data: matchedCustomers } = await supabase
                .from('customers')
                .select('id')
                .eq('tenant_id', tenantId)
                .ilike('business_name', `%${searchQuery}%`)
                .limit(50);

            const customerIds = matchedCustomers?.map(c => c.id) || [];

            if (customerIds.length > 0) {
                const idsString = `(${customerIds.join(',')})`;
                query = query.or(`order_number.ilike.%${searchQuery}%,customer_id.in.${idsString}`);
            } else {
                query = query.ilike('order_number', `%${searchQuery}%`);
            }
        }

        // Aplicar filtros opcionales (US-HIS-01 CA2)
        if (filters?.status) {
            query = query.eq('status', filters.status);
        }
        if (filters?.dateFrom) {
            query = query.gte('created_at', `${filters.dateFrom}T00:00:00`);
        }
        if (filters?.dateTo) {
            // Sufijo Z = UTC explícito — evita ambigüedad con timestamps UTC de Supabase
            query = query.lte('created_at', `${filters.dateTo}T23:59:59Z`);
        }
        if (filters?.customerId) {
            query = query.eq('customer_id', filters.customerId);
        }

        const { data, error, count } = await query
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) throw error;

        return {
            data: data as unknown as OrderDTO[],
            count: count || 0
        };
    },

    /** Obtiene TODOS los pedidos filtrados (sin paginación) para exportar a Excel */
    async getAllOrders(
        tenantId: string,
        searchQuery: string = '',
        filters?: OrderFilters
    ): Promise<OrderDTO[]> {
        let query = supabase
            .from('orders')
            .select(
                'id, order_number, created_at, status, customer_id, seller_id, notes, tenant_id, ' +
                'subtotal, discount_type, discount_amount, total_amount, ' +
                'customers(id, business_name, contact_name, phone, price_type, tenant_id), ' +
                'creator:user_profiles!orders_seller_id_fkey(full_name)'
            )
            .eq('tenant_id', tenantId);

        if (searchQuery) {
            const { data: matchedCustomers } = await supabase
                .from('customers')
                .select('id')
                .eq('tenant_id', tenantId)
                .ilike('business_name', `%${searchQuery}%`)
                .limit(100);

            const customerIds = matchedCustomers?.map(c => c.id) || [];
            if (customerIds.length > 0) {
                const idsString = `(${customerIds.join(',')})`;
                query = query.or(`order_number.ilike.%${searchQuery}%,customer_id.in.${idsString}`);
            } else {
                query = query.ilike('order_number', `%${searchQuery}%`);
            }
        }

        if (filters?.status) query = query.eq('status', filters.status);
        if (filters?.dateFrom) query = query.gte('created_at', `${filters.dateFrom}T00:00:00`);
        if (filters?.dateTo) query = query.lte('created_at', `${filters.dateTo}T23:59:59Z`);
        if (filters?.customerId) query = query.eq('customer_id', filters.customerId);

        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;
        return (data as unknown as OrderDTO[]) || [];
    },

    /**
     * Obtiene el último pedido confirmado de un cliente (US-ORD-08)
     */
    async getLastOrderForCustomer(customerId: string): Promise<OrderDTO | null> {
        const { data, error } = await supabase
            .from('orders')
            .select(
                'id, order_number, created_at, status, customer_id, notes, ' +
                'subtotal, discount_type, discount_amount, total_amount, ' +
                'customers(id, business_name, contact_name, phone), ' +
                'creator:user_profiles!orders_seller_id_fkey(full_name), ' +
                'order_items(id)'
            )
            .eq('customer_id', customerId)
            .neq('status', 'Draft')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;
        return data as unknown as OrderDTO;
    },

    /**
     * Obtiene estadísticas históricas de un cliente (US-CLI-03 CA1)
     */
    async getCustomerStats(customerId: string): Promise<{ total_orders: number; total_amount: number; avg_ticket: number }> {
        const { data, error } = await supabase
            .from('orders')
            .select('total_amount')
            .eq('customer_id', customerId)
            .not('status', 'in', '("Draft","Cancelled")');

        if (error) throw error;

        const totalOrders = data?.length || 0;
        const totalAmount = (data || []).reduce((sum, order) => sum + (order.total_amount || 0), 0);
        const avgTicket = totalOrders > 0 ? totalAmount / totalOrders : 0;

        return {
            total_orders: totalOrders,
            total_amount: totalAmount,
            avg_ticket: avgTicket
        };
    },

    async createOrder(payload: CreateOrderPayload): Promise<{ order_id: string, order_number: string }> {
        const { data, error } = await supabase.rpc('create_direct_order_atomic', {
            p_tenant_id:       payload.tenant_id,
            p_customer_id:     payload.customer_id,
            p_seller_id:       payload.seller_id,
            p_subtotal:        payload.subtotal,
            p_discount_type:   payload.discount_type ?? null,
            p_discount_amount: payload.discount_amount ?? 0,
            p_total_amount:    payload.total_amount,
            p_notes:           payload.notes ?? null,
            p_items:           payload.items,
        });

        if (error) throw error;

        const result = (data as { order_id: string; order_number: string }[])?.[0];
        if (!result) throw new Error('No se retornó ID al crear el pedido');

        return { order_id: result.order_id, order_number: result.order_number };
    },

    /**
     * Busca un Draft activo para un vendedor+cliente. Retorna el ID o null.
     * Lo usa OrderSummaryView al montar para recuperar el borrador en progreso.
     */
    async findExistingDraft(sellerId: string, customerId: string): Promise<{
        id: string;
        order_number: string;
        notes?: string | null;
        discount_type?: 'percentage' | 'fixed' | null;
        discount_amount?: number | null;
    } | null> {
        // Obtenemos el rol del usuario actual para decidir el filtro
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('role')
            .eq('id', sellerId)
            .single();

        let query = supabase
            .from('orders')
            .select('id, order_number, notes, discount_type, discount_amount')
            .eq('customer_id', customerId)
            .eq('status', 'Draft');

        // Si NO es admin ni supervisor, solo puede ver sus propios borradores
        if (profile && profile.role !== 'admin' && profile.role !== 'supervisor') {
            query = query.eq('seller_id', sellerId);
        }

        const { data, error } = await query
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error || !data) return null;
        return data;
    },

    /**
     * Crea o actualiza un pedido en estado Draft.
     * SMART: si draftId es null, verifica si ya existe un borrador en DB
     * para evitar violar el índice único (seller_id, customer_id) WHERE status = 'Draft'.
     * Silent fail: retorna null en error para no interrumpir al usuario.
     */
    async upsertDraft(payload: DraftOrderPayload): Promise<string | null> {
        const DRAFT_STATUS = 'Draft';

        try {
            let orderId = payload.draftId;

            if (!orderId) {
                // Verificar si ya existe un Draft en DB antes de intentar INSERT
                const existing = await orderService.findExistingDraft(
                    payload.seller_id,
                    payload.customer_id
                );
                if (existing) {
                    orderId = existing.id; // Reutilizar el Draft existente
                }
            }

            if (!orderId) {
                // No hay Draft previo: obtener número correlativo del backend y crear cabecera
                const { data: seqData, error: seqError } = await supabase.rpc('next_order_number');
                if (seqError || !seqData) {
                    Logger.error('Error al obtener número correlativo para borrador', { action: 'upsertDraft_seq' }, seqError);
                    return null;
                }
                // next_order_number() devuelve "PED-YYYYMMDD-NNNN"; el draft usa "DRAFT-" como prefijo
                // para que el número correlativo sea el mismo al confirmar (solo cambia el prefijo)
                const orderNumber = (seqData as string).replace('PED-', 'DRAFT-');

                const { data, error } = await supabase
                    .from('orders')
                    .insert({
                        tenant_id: payload.tenant_id,
                        order_number: orderNumber,
                        customer_id: payload.customer_id,
                        seller_id: payload.seller_id,
                        status: DRAFT_STATUS,
                        subtotal: payload.subtotal,
                        discount_type: payload.discount_type ?? null,
                        discount_amount: payload.discount_amount ?? 0,
                        total_amount: payload.total_amount,
                        notes: payload.notes ?? null,   // US-ORD-05 — incluir desde el primer INSERT
                    })
                    .select('id')
                    .single();

                if (error || !data) return null;
                orderId = data.id;
            } else {
                // Actualizar cabecera existente
                const { error } = await supabase
                    .from('orders')
                    .update({
                        customer_id: payload.customer_id,
                        subtotal: payload.subtotal,
                        discount_type: payload.discount_type ?? null,
                        discount_amount: payload.discount_amount ?? 0,
                        total_amount: payload.total_amount,
                        notes: payload.notes ?? null,
                    })
                    .eq('id', orderId);

                if (error) {
                    Logger.error('Error al actualizar cabecera del borrador', { orderId, action: 'upsertDraft_update' }, error);
                    return null;
                }
            }

            // Reemplazar items: borrar los anteriores e insertar los nuevos
            await supabase.from('order_items').delete().eq('order_id', orderId);

            if (payload.items.length > 0) {
                const itemsToInsert = payload.items.map(item => ({
                    order_id: orderId,
                    product_id: item.product_id,
                    quantity: item.quantity,
                    unit_price: item.unit_price,
                    total_price: item.total_price,
                    notes: item.notes ?? null,
                    discount_type: item.discount_type ?? null,
                    discount_amount: item.discount_amount ?? 0,
                }));

                const { error: itemsError } = await supabase
                    .from('order_items')
                    .insert(itemsToInsert);

                if (itemsError) {
                    Logger.error('Error al insertar items en el borrador', { orderId, action: 'upsertDraft_items' }, itemsError);
                    throw itemsError;
                }
            }

            console.log('[DEBUG] upsertDraft: Success for order', orderId);
            return orderId;
        } catch (err) {
            Logger.error('Error crítico en persistencia de borrador', { action: 'upsertDraft_critical' }, err);
            throw err;
        }
    },

    /**
     * Actualiza un pedido existente (Cabecera e Ítems).
     * Útil para editar pedidos ya confirmados desde la vista de detalle.
     */
    async updateOrder(orderId: string, payload: {
        subtotal: number;
        discount_type: 'percentage' | 'fixed' | null;
        discount_amount: number;
        total_amount: number;
        notes?: string;
        items: ProcessedOrderItem[];
    }): Promise<void> {
        // 1. Actualizar cabecera
        const { error: orderError } = await supabase
            .from('orders')
            .update({
                subtotal: payload.subtotal,
                discount_type: payload.discount_type ?? null,
                discount_amount: payload.discount_amount ?? 0,
                total_amount: payload.total_amount,
                notes: payload.notes ?? null,
            })
            .eq('id', orderId);

        if (orderError) throw orderError;

        // 2. Reemplazar items
        // Gracias al trigger de DELETE, el stock se recuperará antes de borrar
        const { error: deleteError } = await supabase
            .from('order_items')
            .delete()
            .eq('order_id', orderId);

        if (deleteError) throw deleteError;

        if (payload.items.length > 0) {
            const itemsToInsert = payload.items.map(item => ({
                order_id: orderId,
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price,
                total_price: item.total_price,
                notes: item.notes ?? null,
                discount_type: item.discount_type ?? null,
                discount_amount: item.discount_amount ?? 0,
            }));

            const { error: itemsError } = await supabase
                .from('order_items')
                .insert(itemsToInsert);

            if (itemsError) throw itemsError;
        }
    },

    /**
     * Promueve un Draft a Confirmed vía RPC atómica.
     * El número correlativo PED-YYYYMMDD-NNNN es generado por la DB (sequence global).
     * Lanza excepciones (incluyendo errores de stock de la DB) para que la vista los capture.
     */
    async promoteDraftToConfirmed(draftId: string, payload: {
        subtotal: number;
        discount_type: 'percentage' | 'fixed' | null;
        discount_amount: number;
        total_amount: number;
        notes?: string;
        items: ProcessedOrderItem[];
    }): Promise<{ order_number: string }> {
        // El número correlativo es generado internamente por la DB (confirm_order_atomic)
        const { data: orderNumber, error: rpcError } = await supabase.rpc('confirm_order_atomic', {
            p_order_id:        draftId,
            p_subtotal:        payload.subtotal,
            p_discount_type:   payload.discount_type,
            p_discount_amount: payload.discount_amount,
            p_total_amount:    payload.total_amount,
            p_notes:           payload.notes ?? null,
            p_items:           payload.items,
        });

        if (rpcError) {
            Logger.error('Error atómico al confirmar pedido', {
                draftId,
                action: 'confirm_order_atomic'
            }, rpcError);

            const { friendlyMessage } = getFriendlyError(rpcError);
            throw new Error(friendlyMessage);
        }

        Logger.info(`Pedido confirmado exitosamente: ${orderNumber}`, { action: 'confirm_order_active', draftId });
        return { order_number: orderNumber as string };
    },

    async getOrderItems(orderId: string): Promise<OrderItemDetail[]> {
        console.log('[DEBUG] getOrderItems (via Hierarchical Fetch): Fetching for order', orderId);

        // Estrategia: Consultamos desde 'orders' para aprovechar la visibilidad garantizada del padre
        const { data, error } = await supabase
            .from('orders')
            .select(`
                order_items (
                    id,
                    order_id,
                    product_id,
                    quantity,
                    unit_price,
                    total_price,
                    notes,
                    discount_type,
                    discount_amount,
                    products (
                        id,
                        name,
                        brand,
                        caliber,
                        quality,
                        shipment_number,
                        price,
                        status
                    )
                )
            `)
            .eq('id', orderId)
            .single();

        if (error) {
            Logger.error('Error al obtener items de pedido (Jerárquico)', { orderId, action: 'getOrderItems' }, error);
            throw error;
        }

        const items = (data as any)?.order_items || [];

        // Mapeo redundante: asegurar que el product_id sea accesible si la relación falla
        const formattedData = items.map((item: any) => ({
            ...item,
            product_id: item.product_id || item.products?.id
        }));

        console.log(`[DEBUG] getOrderItems Hierarchical RESULT: Found ${formattedData.length} items`);
        return formattedData as unknown as OrderItemDetail[];
    },

    /**
     * DISPATCHER METHODS
     */
    async fetchOrdersForDispatch(
        tenantId: string,
        page: number = 1,
        searchQuery: string = '',
        limit: number = 20,
        filters?: OrderFilters,
        sortBy: string = 'created_at',
        ascending: boolean = false
    ): Promise<{ data: OrderDTO[], count: number }> {
        const from = (page - 1) * limit;
        const to = from + limit - 1;

        // Ayer para incluir cancelaciones recientes si se desea
        const yesterday = new Date();
        yesterday.setHours(yesterday.getHours() - 24);

        // Base query con joins necesarios para despacho
        let query = supabase
            .from('orders')
            .select(
                'id, order_number, created_at, status, customer_id, notes, ' +
                'subtotal, discount_type, discount_amount, total_amount, ' +
                'customers(id, business_name, contact_name, phone, address, department, municipality, identification_number, internal_code), ' +
                'creator:user_profiles!orders_seller_id_fkey(full_name), ' +
                'dispatcher:user_profiles!orders_handled_by_fkey(full_name), ' +
                'order_items(id, quantity, notes, ' +
                'products(id, name, brand, caliber, quality, shipment_number))',
                { count: 'exact' }
            )
            .eq('tenant_id', tenantId);

        // Filtro de búsqueda extensible: por número de pedido o nombre de cliente
        if (searchQuery) {
            // Buscamos clientes que coincidan con el nombre
            const { data: matchedCustomers } = await supabase
                .from('customers')
                .select('id')
                .eq('tenant_id', tenantId)
                .ilike('business_name', `%${searchQuery}%`);

            const customerIds = (matchedCustomers ?? []).map(c => c.id);

            if (customerIds.length > 0) {
                // Buscamos por folio O por IDs de clientes encontrados
                query = query.or(`order_number.ilike.%${searchQuery}%,customer_id.in.(${customerIds.map(id => `"${id}"`).join(',')})`);
            } else {
                // Solo por folio
                query = query.ilike('order_number', `%${searchQuery}%`);
            }
        }

        // Filtros de Estado (Si no hay filtro específico, usamos el set de despacho: Approved + In Preparation + Delivered)
        if (filters?.status) {
            query = query.eq('status', filters.status);
        } else {
            // Default Dispatch View: Pendientes de entrega, en proceso o entregados recientemente
            query = query.or(`status.in.("${ORDER_STATUS.APPROVED}","${ORDER_STATUS.IN_PREPARATION}","${ORDER_STATUS.DELIVERED}"),and(status.eq.${ORDER_STATUS.CANCELLED},created_at.gte.${yesterday.toISOString()})`);
        }

        // Filtros de Fecha (US-HIS-01 / US-ORD-07)
        if (filters?.dateFrom) {
            query = query.gte('created_at', `${filters.dateFrom}T00:00:00`);
        }
        if (filters?.dateTo) {
            query = query.lte('created_at', `${filters.dateTo}T23:59:59`);
        }

        const { data, error, count } = await query
            .order(sortBy, { ascending })
            .range(from, to);

        if (error) throw error;

        return {
            data: data as unknown as OrderDTO[],
            count: count || 0
        };
    },

    async startPreparation(orderId: string, userId: string): Promise<void> {
        const { error } = await supabase
            .from('orders')
            .update({
                status: ORDER_STATUS.IN_PREPARATION,
                handled_by: userId,
                shipped_at: new Date().toISOString()
            })
            .eq('id', orderId)
            .eq('status', ORDER_STATUS.APPROVED);

        if (error) throw error;
    },

    async completeDelivery(orderId: string): Promise<void> {
        const { error } = await supabase
            .from('orders')
            .update({
                status: ORDER_STATUS.DELIVERED,
                delivered_at: new Date().toISOString()
            })
            .eq('id', orderId)
            .eq('status', ORDER_STATUS.IN_PREPARATION);

        if (error) throw error;
    },

    async cancelOrder(orderId: string): Promise<void> {
        const { error } = await supabase
            .from('orders')
            .update({
                status: ORDER_STATUS.CANCELLED,
            })
            .eq('id', orderId);

        if (error) throw error;
    },

    async deleteOrder(orderId: string): Promise<void> {
        const { error } = await supabase
            .from('orders')
            .delete()
            .eq('id', orderId);

        if (error) throw error;
    }
};

