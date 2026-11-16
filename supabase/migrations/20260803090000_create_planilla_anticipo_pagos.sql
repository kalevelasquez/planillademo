-- Migration: Anticipos — ciclo de descuento por quincena (IMPL-48 / US-ANT-03, IMPL-52)
-- Author: @alexis
-- Description: `planilla_anticipo_pagos` es una tabla de EVENTOS PEREZOSOS, no de cuotas
--              pre-generadas: una fila se crea solo cuando una quincena REAL ya existente se
--              procesa para un anticipo (`tipo='pago'`) o se suspende puntualmente
--              (`tipo='suspension'`, US-ANT-04/IMPL-53) — nunca se proyectan filas hacia
--              quincenas futuras que todavía no existen como registro en `quincenas`. El
--              UNIQUE (anticipo_id, quincena_id) garantiza que cada anticipo tenga a lo sumo un
--              desenlace por quincena (pagó o se suspendió, nunca ambos).
--
--              `procesar_cuotas_anticipos_quincena` es la interpretación de "descuento
--              automático" (texto de US-ANT-03) sin que exista el motor real de Cálculo de
--              Planilla (IMPL-85): un solo RPC en bloque reemplaza "ir cuota por cuota", pero
--              solo persiste el monto descontado — no toca ISSS/AFP/Renta/tope 20% de
--              descuentos, ni genera ninguna línea de planilla real. IMPL-85 leerá
--              SUM(monto) FROM planilla_anticipo_pagos WHERE tipo='pago' agrupado por
--              empleado/quincena cuando exista.

BEGIN;

CREATE TABLE IF NOT EXISTS public.planilla_anticipo_pagos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    anticipo_id UUID NOT NULL REFERENCES public.planilla_anticipos(id) ON DELETE RESTRICT,
    quincena_id UUID NOT NULL REFERENCES public.quincenas(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('pago', 'suspension')),
    monto NUMERIC,
    motivo_suspension TEXT,
    registrado_por UUID REFERENCES public.user_profiles(id),
    registrado_at TIMESTAMPTZ DEFAULT now() NOT NULL,
    UNIQUE (anticipo_id, quincena_id),
    CHECK (
        (tipo = 'pago' AND monto IS NOT NULL AND monto > 0 AND motivo_suspension IS NULL)
        OR
        (tipo = 'suspension' AND monto IS NULL AND motivo_suspension IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_planilla_anticipo_pagos_anticipo ON public.planilla_anticipo_pagos(anticipo_id);
CREATE INDEX IF NOT EXISTS idx_planilla_anticipo_pagos_quincena ON public.planilla_anticipo_pagos(quincena_id);

ALTER TABLE public.planilla_anticipo_pagos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "planilla_anticipo_pagos_select_tenant"
    ON public.planilla_anticipo_pagos FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id());

-- Mismo gate que el resto de módulos: solo se puede registrar un evento (pago o suspensión)
-- mientras la quincena referenciada está en_proceso. Sin policy de UPDATE/DELETE — es un log
-- de hechos inmutable, igual criterio que planilla_empleado_indemnizaciones.
CREATE POLICY "planilla_anticipo_pagos_insert_quincena_en_proceso"
    ON public.planilla_anticipo_pagos FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
        AND EXISTS (SELECT 1 FROM public.quincenas q WHERE q.id = quincena_id AND q.estado = 'en_proceso')
    );

DROP TRIGGER IF EXISTS tr_audit_planilla_anticipo_pagos ON public.planilla_anticipo_pagos;
CREATE TRIGGER tr_audit_planilla_anticipo_pagos
    AFTER INSERT ON public.planilla_anticipo_pagos
    FOR EACH ROW EXECUTE FUNCTION public.fn_capture_audit();

-- Salvaguarda de integridad: ni un pago automático ni una suspensión manual (IMPL-53) deberían
-- poder registrarse sobre un anticipo que ya está saldado.
CREATE OR REPLACE FUNCTION public.fn_validar_evento_anticipo()
RETURNS TRIGGER AS $$
DECLARE
    v_estado TEXT;
BEGIN
    SELECT estado INTO v_estado FROM public.planilla_anticipos WHERE id = NEW.anticipo_id;
    IF v_estado = 'saldado' THEN
        RAISE EXCEPTION 'El anticipo % ya está saldado, no admite nuevos eventos', NEW.anticipo_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_validar_evento_anticipo ON public.planilla_anticipo_pagos;
CREATE TRIGGER tr_validar_evento_anticipo
    BEFORE INSERT ON public.planilla_anticipo_pagos
    FOR EACH ROW EXECUTE FUNCTION public.fn_validar_evento_anticipo();

-- Sin SECURITY DEFINER (mismo criterio que crear_anticipo/register_indemnizacion): las policies
-- de INSERT/UPDATE de arriba y de planilla_anticipos son las que autorizan cada operación
-- dentro del bloque. FOR UPDATE serializa contra un segundo Preparador procesando la misma
-- quincena casi al mismo tiempo.
CREATE OR REPLACE FUNCTION public.procesar_cuotas_anticipos_quincena(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_anticipo RECORD;
    v_monto NUMERIC;
    v_nuevo_monto_pagado NUMERIC;
    v_procesados INT := 0;
BEGIN
    FOR v_anticipo IN
        SELECT a.* FROM public.planilla_anticipos a
        WHERE a.tenant_id = v_tenant_id
          AND a.estado = 'activo'
          AND NOT EXISTS (
              SELECT 1 FROM public.planilla_anticipo_pagos p
              WHERE p.anticipo_id = a.id AND p.quincena_id = p_quincena_id
          )
        FOR UPDATE
    LOOP
        v_monto := LEAST(v_anticipo.monto_cuota, v_anticipo.monto_total - v_anticipo.monto_pagado);

        INSERT INTO public.planilla_anticipo_pagos (tenant_id, anticipo_id, quincena_id, tipo, monto, registrado_por)
        VALUES (v_tenant_id, v_anticipo.id, p_quincena_id, 'pago', v_monto, p_user_id);

        v_nuevo_monto_pagado := v_anticipo.monto_pagado + v_monto;

        UPDATE public.planilla_anticipos
        SET monto_pagado = v_nuevo_monto_pagado,
            estado = CASE WHEN v_nuevo_monto_pagado >= v_anticipo.monto_total THEN 'saldado' ELSE 'activo' END,
            updated_at = now()
        WHERE id = v_anticipo.id;

        v_procesados := v_procesados + 1;
    END LOOP;

    RETURN v_procesados;
END;
$$;

COMMIT;
