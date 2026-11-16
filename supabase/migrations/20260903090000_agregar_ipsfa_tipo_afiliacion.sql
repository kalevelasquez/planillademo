-- Migration: Agregar 'ipsfa' como valor válido de tipo_afiliacion (IMPL-3, revisión épica)
-- Author: @alexis
-- Description: El levantamiento de requerimientos confirmó que "IPSFA" es una opción real de
--              afiliación previsional (junto a AFP Crecer/Confía) que no estaba contemplada en
--              la migración original. Sin efecto especial en el cálculo por decisión explícita
--              del negocio (se comporta como afp_crecer/afp_confia — contribución normal) hasta
--              que exista una regla de exclusión propia, a diferencia de 'jubilado' (ver
--              20260901090000_fix_calcular_planilla_empleado_afp_jubilado.sql).
--              El CHECK original es inline/sin nombre — se busca el nombre real vía pg_constraint
--              en vez de adivinarlo, mismo criterio que las migraciones previas de este proyecto.

BEGIN;

DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'planilla_empleados'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%tipo_afiliacion%';

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.planilla_empleados DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE public.planilla_empleados
        ADD CONSTRAINT planilla_empleados_tipo_afiliacion_check
        CHECK (tipo_afiliacion IN ('afp_crecer', 'afp_confia', 'upiss', 'jubilado', 'ipsfa'));
END $$;

COMMIT;
