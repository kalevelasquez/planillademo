-- Migration: Reglas de edición por estado de la Quincena (IMPL-9 / US-QNA-02)
-- Author: @alexis
-- Description: US-QNA-02 CA2: "En Proceso" solo lo edita Preparador/Admin; "Enviada a
--              Aprobación" y "Aprobada y Cerrada" son de solo lectura para todos — nadie
--              puede editar vía UPDATE normal. CA3 aclara que el detalle de las
--              transiciones (enviar, aprobar, rechazar, re-abrir) es alcance de Lote 12
--              (Cierre y Aprobación / IMPL-102), NO de esta historia — acá solo se blinda
--              el modelo de estados a nivel de RLS.
--
--              Nota para IMPL-102: la re-apertura de una quincena "Aprobada y Cerrada"
--              tendrá que hacerse vía un RPC con SECURITY DEFINER (o rol elevado), porque
--              esta política bloquea cualquier UPDATE normal sobre filas que no estén en
--              estado 'en_proceso' — el RPC de re-apertura no puede ser una simple llamada
--              .update() del cliente.

BEGIN;

DROP POLICY IF EXISTS "quincenas_update_roles" ON public.quincenas;

CREATE POLICY "quincenas_update_roles"
    ON public.quincenas FOR UPDATE
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND estado = 'en_proceso'
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    )
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND ('admin' = ANY(public.get_auth_roles()) OR 'preparador_planilla' = ANY(public.get_auth_roles()))
    );

COMMIT;
