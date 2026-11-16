-- Migration: Persistencia del historial del Asistente de IA (IMPL-115 / US-IA-02)
-- Author: @alexis
-- Description: Gap documentado (planilla-contexto.md, Asistente de IA #4): el historial del
--              chat vivía solo en el estado de React del navegador — se perdía al recargar la
--              página. Modelo mínimo: una sesión CONTINUA por usuario (UNIQUE tenant_id+user_id,
--              sin concepto de "conversaciones" múltiples — ningún CA lo pide) + sus mensajes
--              ordenados por created_at. Es dato privado del usuario (chat personal), no
--              compartido a nivel tenant como el resto de las tablas del proyecto — por eso la
--              RLS filtra también por user_id = auth.uid(), no solo por tenant_id.
--
--              Ambas tablas se leen/escriben con el JWT real del caller (supabaseUser en la
--              Edge Function, mismo criterio que las 8 RPCs ia_* — nunca con el service role),
--              para que la RLS de "solo mis propios mensajes" aplique siempre.

BEGIN;

CREATE TABLE IF NOT EXISTS public.asistente_ia_sesiones (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.user_profiles(id),
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL,

    UNIQUE (tenant_id, user_id)
);

ALTER TABLE public.asistente_ia_sesiones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asistente_ia_sesiones_select_own"
    ON public.asistente_ia_sesiones FOR SELECT
    USING (tenant_id = public.get_auth_tenant_id() AND user_id = auth.uid());

CREATE POLICY "asistente_ia_sesiones_insert_own"
    ON public.asistente_ia_sesiones FOR INSERT
    WITH CHECK (tenant_id = public.get_auth_tenant_id() AND user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.asistente_ia_mensajes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    sesion_id UUID NOT NULL REFERENCES public.asistente_ia_sesiones(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    -- Solo poblado en mensajes 'assistant' — mismo detalle que ya se audita en audit_log vía
    -- CONSULTA_IA (US-IA-03 CA1), acá queda también junto al mensaje para poder mostrarlo en
    -- la UI en el futuro si se pide, sin tener que cruzar contra audit_log.
    herramientas_usadas JSONB,
    created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_asistente_ia_mensajes_sesion_fecha
    ON public.asistente_ia_mensajes(sesion_id, created_at);

ALTER TABLE public.asistente_ia_mensajes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "asistente_ia_mensajes_select_own"
    ON public.asistente_ia_mensajes FOR SELECT
    USING (
        tenant_id = public.get_auth_tenant_id()
        AND EXISTS (
            SELECT 1 FROM public.asistente_ia_sesiones s
            WHERE s.id = sesion_id AND s.user_id = auth.uid()
        )
    );

CREATE POLICY "asistente_ia_mensajes_insert_own"
    ON public.asistente_ia_mensajes FOR INSERT
    WITH CHECK (
        tenant_id = public.get_auth_tenant_id()
        AND EXISTS (
            SELECT 1 FROM public.asistente_ia_sesiones s
            WHERE s.id = sesion_id AND s.user_id = auth.uid()
        )
    );

COMMIT;
