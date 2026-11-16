-- Migration: Fix Multi-Role Compatibility (Error 22P02)
-- Author: @arquitecto / Antigravity
-- Description: Actualiza triggers y funciones de BI, y limpia políticas obsoletas.

BEGIN;

-- ============================================================
-- 0. LIMPIEZA DE POLÍTICAS OBSOLETAS (Evitar Colisiones de Tipo)
-- ============================================================

-- Estas políticas usaban "role = 'admin'" y causan 22P02 al convivir con el nuevo esquema
DROP POLICY IF EXISTS "Admins can update colleagues" ON public.user_profiles;
DROP POLICY IF EXISTS "customer_select_policy" ON public.customers;
DROP POLICY IF EXISTS "customer_insert_policy" ON public.customers;
DROP POLICY IF EXISTS "customer_update_policy" ON public.customers;

-- ============================================================
-- 1. ACTUALIZAR TRIGGERS DE CLIENTES (CUSTOMERS)
-- ============================================================

-- auto_assign_seller: Asignación automática al crear
CREATE OR REPLACE FUNCTION public.auto_assign_seller()
RETURNS TRIGGER AS $$
BEGIN
  -- Usamos get_auth_roles() para consistencia con el sistema multi-rol
  IF 'vendedor' = ANY(public.get_auth_roles()) THEN
    NEW.assigned_seller_id = auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- protect_customer_reassignment: Protección contra reasignación en updates
CREATE OR REPLACE FUNCTION public.protect_customer_reassignment()
RETURNS TRIGGER AS $$
BEGIN
  -- Si el usuario es vendedor, no puede cambiar el vendedor asignado
  IF 'vendedor' = ANY(public.get_auth_roles()) THEN
    -- OLD solo existe en UPDATE, esta función es para el trigger de UPDATE
    IF OLD.assigned_seller_id IS DISTINCT FROM NEW.assigned_seller_id THEN
       NEW.assigned_seller_id = OLD.assigned_seller_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================
-- 2. ACTUALIZAR RPC DE REPORTES BI
-- ============================================================

-- get_report_sellers: Corregir filtrado de perfiles con rol array
CREATE OR REPLACE FUNCTION public.get_report_sellers(
    p_tenant_id UUID,
    p_start_date TIMESTAMPTZ,
    p_end_date TIMESTAMPTZ
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_result JSONB;
BEGIN
    SELECT jsonb_agg(t) INTO v_result
    FROM (
        SELECT 
            up.id as seller_id,
            up.full_name as seller_name,
            COUNT(o.id) as orders_count,
            COALESCE(SUM(o.total_amount), 0) as total_sales,
            CASE 
                WHEN COUNT(o.id) > 0 THEN ROUND(SUM(o.total_amount) / COUNT(o.id), 2)
                ELSE 0 
            END as avg_ticket
        FROM public.user_profiles up
        LEFT JOIN public.orders o ON up.id = o.seller_id 
              AND o.created_at >= p_start_date 
              AND o.created_at <= p_end_date
              AND o.status NOT IN ('borrador', 'cancelado', 'Draft', 'Cancelled')
        WHERE up.tenant_id = p_tenant_id 
          -- Corrección Crítica: Comparación de Array (Overlaps)
          AND up.role && ARRAY['admin', 'supervisor', 'vendedor']::TEXT[]
        GROUP BY up.id, up.full_name
        ORDER BY total_sales DESC
    ) t;
    RETURN COALESCE(v_result, '[]'::jsonb);
END;
$$;

COMMIT;
