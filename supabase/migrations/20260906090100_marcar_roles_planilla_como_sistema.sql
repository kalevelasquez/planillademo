-- Migration: Marcar preparador_planilla/aprobador_planilla como roles de sistema
-- Author: @alexis
-- Description: Revisión historia por historia (IMPL-2 gap #3) — estos 2 roles se sembraron
--              originalmente con is_system=false (20260716120100_planilla_roles_and_permissions.sql),
--              lo que permite a un Admin desactivarlos/editarlos/borrarlos desde la UI de
--              Gestión de Roles. Ahora que Cierre y Aprobación (IMPL-102) depende críticamente
--              de que exista un Aprobador real para la segregación de funciones (CA5: quien
--              envía no puede aprobar su propia quincena), el cliente decidió elevarlos a
--              is_system=true, igual que admin/supervisor/vendedor/despachador — un Admin ya no
--              puede editar su nombre ni borrarlos por accidente desde `RoleManagementView.tsx`
--              (bloqueo ya existe en esa UI condicionado sobre `is_system`, sin cambios de código
--              necesarios, solo el flag).
--
--              Se actualizan las filas ya sembradas (backfill) Y `fn_on_tenant_created()` (para
--              que tenants nuevos los sigan sembrando como sistema desde el alta).

BEGIN;

-- Backfill de tenants existentes
UPDATE public.roles_definition
SET is_system = true
WHERE name IN ('preparador_planilla', 'aprobador_planilla')
  AND is_system = false;

-- Mismo cuerpo que la función original, solo con is_system=true para los 2 roles de Planilla
CREATE OR REPLACE FUNCTION public.fn_on_tenant_created()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.roles_definition (tenant_id, name, description, is_system)
    VALUES
        (NEW.id, 'admin', 'Administrador total del sistema', true),
        (NEW.id, 'supervisor', 'Supervisor de operaciones y personal', true),
        (NEW.id, 'vendedor', 'Gestión de clientes y pedidos', true),
        (NEW.id, 'despachador', 'Gestión de logística y entregas', true),
        (NEW.id, 'preparador_planilla', 'Registra y edita los datos de planilla, calcula y envía a aprobación', true),
        (NEW.id, 'aprobador_planilla', 'Revisa y aprueba/rechaza quincenas de planilla; no edita datos', true)
    ON CONFLICT DO NOTHING;

    PERFORM public.seed_default_permissions(NEW.id);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
