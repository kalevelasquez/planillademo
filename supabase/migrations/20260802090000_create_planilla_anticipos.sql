-- Migration: Anticipos — cabecera del vale (IMPL-48 / US-ANT-02, IMPL-51)
-- Author: @alexis
-- Description: A diferencia de los módulos anteriores (Horas Extras, Viáticos, Incapacidades),
--              un anticipo NO está escopeado a una sola quincena: nace en una y su saldo se
--              descuenta en cuotas a lo largo de varias quincenas futuras hasta saldarse. Por
--              eso esta tabla NO tiene columna quincena_id — el historial de qué pasó en cada
--              quincena real vive en `planilla_anticipo_pagos` (IMPL-52, migración separada).
--
--              `estado` SOLO admite 'activo'/'saldado' — deliberadamente NO incluye
--              'suspendido' pese a que IMPL-49 CA2 lo menciona en el listado: "suspender" es
--              una acción escopeada a una quincena puntual (IMPL-53), nunca un estado
--              permanente del anticipo. El tercer valor visual ("Suspendido") se calcula en el
--              servicio de cliente combinando `estado` con la existencia de un evento de
--              suspensión para la quincena activa — ver anticiposService.ts.
--
--              `monto_cuota` es la cuota VIGENTE (recalculable vía US-ANT-06/IMPL-55), no un
--              valor fijo de por vida. `saldo_pendiente` no se persiste, se deriva
--              (monto_total - monto_pagado) en el cliente — mismo criterio que Viáticos.
--
--              CHECK (tipo = 'salario' OR autorizado_gg = true): refuerzo server-side de
--              US-ANT-02 CA3 (Vacaciones/Aguinaldo exigen autorización de Gerencia General),
--              no solo una validación de UI.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_anticipos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    empleado_id UUID NOT NULL REFERENCES public.planilla_empleados(id),
    numero_vale TEXT NOT NULL,
    fecha_vale DATE NOT NULL,
    tipo TEXT NOT NULL CHECK (tipo IN ('salario', 'vacaciones', 'aguinaldo')),
    monto_total NUMERIC NOT NULL CHECK (monto_total > 0),
    numero_cuotas INT NOT NULL DEFAULT 1 CHECK (numero_cuotas > 0),
    monto_cuota NUMERIC NOT NULL CHECK (monto_cuota > 0),
    monto_pagado NUMERIC NOT NULL DEFAULT 0 CHECK (monto_pagado >= 0),
    estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'saldado')),
    autorizado_gg BOOLEAN NOT NULL DEFAULT false,
    autorizado_gg_por TEXT,
    origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('manual', 'ia')),
    ia_confianza NUMERIC,
    created_by UUID REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    CHECK (monto_pagado <= monto_total),
    CHECK (tipo = 'salario' OR autorizado_gg = true)
);

CREATE INDEX IF NOT EXISTS idx_planilla_anticipos_empleado ON public.planilla_anticipos(empleado_id);
CREATE INDEX IF NOT EXISTS idx_planilla_anticipos_estado ON public.planilla_anticipos(estado);

ALTER TABLE public.planilla_anticipos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_anticipos_select_tenant"
    ON public.planilla_anticipos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY "planilla_anticipos_insert_rol"
    ON public.planilla_anticipos FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

-- Sin gate de "quincena en_proceso": a diferencia de Horas Extras/Viáticos/Incapacidades, un
-- anticipo vive across-quincenas (se recalcula, se procesa su cuota, se salda) mucho después de
-- la quincena en la que se creó — no tiene sentido bloquear su UPDATE a la quincena de origen.
CREATE POLICY "planilla_anticipos_update_rol"
    ON public.planilla_anticipos FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

-- US-ANT-05 (IMPL-54) CA1/CA2: solo se puede eliminar si no se ha descontado ninguna cuota.
CREATE POLICY "planilla_anticipos_delete_sin_pagos"
    ON public.planilla_anticipos FOR DELETE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND monto_pagado = 0
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_anticipos ON public.planilla_anticipos;
CREATE TRIGGER tr_audit_planilla_anticipos
    AFTER INSERT OR UPDATE OR DELETE ON public.planilla_anticipos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Sin SECURITY DEFINER a propósito (mismo criterio que register_indemnizacion/
-- completar_ubicacion_modulo): corre como INVOKER, la policy de INSERT de arriba es la que
-- efectivamente autoriza. El cálculo de monto_cuota se hace server-side para que el redondeo
-- sea consistente sin importar el cliente que llame al RPC.
CREATE OR REPLACE FUNCTION public.crear_anticipo(
    p_empleado_id UUID,
    p_numero_vale TEXT,
    p_fecha_vale DATE,
    p_tipo TEXT,
    p_monto_total NUMERIC,
    p_numero_cuotas INT,
    p_autorizado_gg BOOLEAN,
    p_autorizado_gg_por TEXT,
    p_origen TEXT,
    p_ia_confianza NUMERIC,
    p_user_id UUID
) RETURNS public.planilla_anticipos
LANGUAGE plpgsql
AS $$
DECLARE
    v_result public.planilla_anticipos;
BEGIN
    INSERT INTO public.planilla_anticipos (
        tenant_id, empleado_id, numero_vale, fecha_vale, tipo, monto_total,
        numero_cuotas, monto_cuota, autorizado_gg, autorizado_gg_por, origen, ia_confianza, created_by
    ) VALUES (
        public.get_auth_tenant_id(), p_empleado_id, p_numero_vale, p_fecha_vale, p_tipo, p_monto_total,
        p_numero_cuotas, ROUND(p_monto_total / p_numero_cuotas, 2),
        p_autorizado_gg, p_autorizado_gg_por, p_origen, p_ia_confianza, p_user_id
    )
    RETURNING * INTO v_result;

    RETURN v_result;
END;
$$;

COMMIT;
