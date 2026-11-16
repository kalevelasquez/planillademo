import { supabase } from './authService';
import { Logger } from '../utils/logger';

export interface DashboardKPIs {
    today: {
        orders_count: number;
        total_sales: number;
        pending_orders: number;
    };
    comparison: {
        previous_sales: number;
        sales_trend: number; // Porcentaje de cambio
        previous_orders: number;
        orders_trend: number;
    };
    top_products: Array<{
        name: string;
        quantity: number;
        total: number;
    }>;
    top_customers: Array<{
        name: string;
        total: number;
        orders_count: number;
    }>;
}

export interface SellerReportItem {
    seller_id: string;
    seller_name: string;
    orders_count: number;
    total_sales: number;
    avg_ticket: number;
}

export interface ProductReportItem {
    product_id: string;
    product_name: string;
    category: string;
    total_quantity: number;
    total_revenue: number;
    orders_count: number;
}

export interface CustomerReportItem {
    customer_id: string;
    business_name: string;
    total_orders: number;
    accumulated_amount: number;
    last_order_at: string | null;
    is_inactive: boolean;
    monthly_frequency: number;
}

export const reportService = {
    /**
     * Obtiene los KPIs del Dashboard basándose en el rol y el usuario.
     * CA1, CA2, CA4 implementados aquí.
     */
    async getDashboardStats(
        tenantId: string,
        userId: string,
        roles: string[]
    ): Promise<DashboardKPIs> {
        // Fechas para filtros
        const now = new Date();
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).toISOString();

        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const startOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate()).toISOString();
        const endOfYesterday = new Date(yesterday.getFullYear(), yesterday.getMonth(), yesterday.getDate(), 23, 59, 59, 999).toISOString();

        const { data, error } = await supabase.rpc('get_dashboard_metrics', {
            p_tenant_id: tenantId,
            p_user_id: userId,
            p_roles: roles,
            p_start_today: startOfToday,
            p_end_today: endOfToday,
            p_start_yesterday: startOfYesterday,
            p_end_yesterday: endOfYesterday
        });

        if (error) {
            Logger.error('Error en RPC get_dashboard_metrics', { tenantId, userId, roles }, error);
            throw error;
        }

        return data as DashboardKPIs;
    },

    /**
     * Obtiene la tendencia de ventas comparativa por período (US-REP-02).
     * CA1, CA2 implementados con alineación temporal.
     */
    async getSalesTrend(
        tenantId: string,
        userId: string,
        roles: string[],
        days: number
    ): Promise<SalesTrendPoint[]> {
        const { data, error } = await supabase.rpc('get_sales_trend', {
            p_tenant_id: tenantId,
            p_user_id: userId,
            p_roles: roles,
            p_days: days
        });

        if (error) {
            Logger.error('Error en RPC get_sales_trend', { tenantId, userId, roles, days }, error);
            throw error;
        }

        return (data || []) as SalesTrendPoint[];
    },

    /**
     * Reporte detallado de Vendedores (US-REP-03 CA1, CA4)
     */
    async getSellerReport(
        tenantId: string,
        startDate: string,
        endDate: string
    ): Promise<SellerReportItem[]> {
        const { data, error } = await supabase.rpc('get_report_sellers', {
            p_tenant_id: tenantId,
            p_start_date: startDate,
            p_end_date: endDate
        });

        if (error) throw error;
        return (data || []) as SellerReportItem[];
    },

    /**
     * Reporte detallado de Productos (US-REP-03 CA2, CA4)
     */
    async getProductReport(
        tenantId: string,
        startDate: string,
        endDate: string
    ): Promise<ProductReportItem[]> {
        const { data, error } = await supabase.rpc('get_report_products', {
            p_tenant_id: tenantId,
            p_start_date: startDate,
            p_end_date: endDate
        });

        if (error) throw error;
        return (data || []) as ProductReportItem[];
    },

    /**
     * Reporte detallado de Clientes (US-REP-03 CA3, CA4)
     */
    async getCustomerReport(
        tenantId: string,
        startDate: string,
        endDate: string
    ): Promise<CustomerReportItem[]> {
        const { data, error } = await supabase.rpc('get_report_customers', {
            p_tenant_id: tenantId,
            p_start_date: startDate,
            p_end_date: endDate
        });

        if (error) throw error;
        return (data || []) as CustomerReportItem[];
    }
};

export interface SalesTrendPoint {
    label: string;
    fullDate: string;
    current: number;
    previous: number;
}
