-- Migration: Generación atómica del código EMP-YYYY-NNN (IMPL-3, revisión épica)
-- Author: @alexis
-- Description: El código de empleado se generaba en el cliente contando filas existentes
--              con el prefijo del año (SELECT count + INSERT en llamadas separadas, sin
--              transacción ni lock entre ambas) — dos altas simultáneas del mismo año podían
--              leer el mismo count y chocar contra el UNIQUE(tenant_id, codigo) sin reintento.
--              Se resuelve con el mismo patrón ya usado en este proyecto para códigos
--              secuenciales (order_number_seq, planilla_descuentos_codigo_seq), adaptado:
--              una SEQUENCE simple de Postgres no reinicia por año/tenant, así que se usa una
--              tabla contador (tenant_id, anio) + INSERT ... ON CONFLICT ... RETURNING, que
--              toma un row lock atómico en el UPSERT — dos llamadas concurrentes nunca pueden
--              obtener el mismo número.
--              RPC en modo INVOKER (no SECURITY DEFINER): los mismos roles que pueden crear un
--              empleado (admin/preparador_planilla) son los únicos que necesitan escribir en el
--              contador de su propio tenant — no hay ningún cruce de privilegios que justifique
--              DEFINER.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_empleados_codigo_contador (
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    anio INT NOT NULL,
    ultimo_numero INT NOT NULL DEFAULT 0,
    PRIMARY KEY (tenant_id, anio)
);

ALTER TABLE public.planilla_empleados_codigo_contador ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_empleados_codigo_contador_roles"
    ON public.planilla_empleados_codigo_contador FOR ALL
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND (
            'admin' = ANY(public.get_auth_roles())
            OR 'preparador_planilla' = ANY(public.get_auth_roles())
        )
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND (
            'admin' = ANY(public.get_auth_roles())
            OR 'preparador_planilla' = ANY(public.get_auth_roles())
        )
    );

CREATE OR REPLACE FUNCTION public.generar_codigo_empleado(p_anio INT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_numero INT;
BEGIN
    INSERT INTO public.planilla_empleados_codigo_contador (tenant_id, anio, ultimo_numero)
    VALUES (v_tenant_id, p_anio, 1)
    ON CONFLICT (tenant_id, anio)
    DO UPDATE SET ultimo_numero = public.planilla_empleados_codigo_contador.ultimo_numero + 1
    RETURNING ultimo_numero INTO v_numero;

    RETURN 'EMP-' || p_anio::TEXT || '-' || LPAD(v_numero::TEXT, 3, '0');
END;
$$;

COMMIT;
