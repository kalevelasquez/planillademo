-- Migration: Anticipos — validar fecha_vale al procesar cuotas (fix defecto UAT, 2026-09-02)
-- Author: @alexis
-- Description: `procesar_cuotas_anticipos_quincena` insertaba un pago contra CUALQUIER
--              quincena activa, sin chequear si esa quincena es "aplicable" al anticipo
--              (regla ya usada en el frontend: fecha_inicio de la quincena >= fecha_vale del
--              anticipo, ver AnticiposView.tsx `quincenasAplicables`). Si un vale se fechaba
--              dentro de la quincena que se estaba procesando (ej. quincena 01-15, vale del
--              05), el pago quedaba registrado contra una quincena "no aplicable" — y
--              `armarScheduleCuotas` (anticipoCuotasUtils.ts), que para anticipos saldados
--              solo cuenta eventos en quincenas aplicables, terminaba con totalPosiciones = 0.
--              Con una sola cuota eso deja la tabla de detalle completamente vacía; con varias
--              cuotas el defecto igual ocurre pero queda tapado por las cuotas siguientes.
--
--              El fix es en el origen: el RPC ahora solo procesa anticipos cuya fecha_vale ya
--              haya pasado el inicio de la quincena que se está procesando, igual que ya exige
--              el frontend para mostrar esa quincena como cuota válida.

BEGIN;

CREATE OR REPLACE FUNCTION public.procesar_cuotas_anticipos_quincena(
    p_quincena_id UUID,
    p_user_id UUID
) RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE
    v_tenant_id UUID := public.get_auth_tenant_id();
    v_quincena_fecha_inicio DATE;
    v_anticipo RECORD;
    v_monto NUMERIC;
    v_nuevo_monto_pagado NUMERIC;
    v_procesados INT := 0;
BEGIN
    SELECT fecha_inicio INTO v_quincena_fecha_inicio
    FROM public.quincenas
    WHERE id = p_quincena_id AND tenant_id = v_tenant_id;

    FOR v_anticipo IN
        SELECT a.* FROM public.planilla_anticipos a
        WHERE a.tenant_id = v_tenant_id
          AND a.estado = 'activo'
          AND a.fecha_vale <= v_quincena_fecha_inicio
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
