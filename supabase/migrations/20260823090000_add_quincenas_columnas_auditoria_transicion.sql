-- Migration: Columnas de auditoría de transición de estado (IMPL-102 / US-CIE-00)
-- Author: @alexis
-- Description: US-CIE-00 CA5 necesita comparar "quién envió" vs. "quién aprueba" — no
--              existía ninguna columna de autoría de transición en quincenas (el propio
--              comentario de IMPL-18/AprobadorDashboardView.tsx documenta este gap
--              explícitamente, diferido a esta épica). También cubre CA3/CA4 (motivo
--              obligatorio de Rechazo/Re-apertura).
--
--              Decisión de diseño (ver docs/product/planilla-contexto.md): la Re-apertura
--              NO escribe el valor 'reabierta' del enum de `estado` — sigue escribiendo
--              'en_proceso', igual que el Rechazo. Usar 'reabierta' real obligaría a
--              reescribir las ~7 políticas RLS ya construidas que gatean con
--              `estado = 'en_proceso'` exacto (viáticos, incapacidades, vacaciones,
--              cálculo, checklist de módulos), sin ningún beneficio funcional — Jira solo
--              pide el valor como etiqueta visual. El "estado visual" (Re-abierta vs.
--              Rechazada vs. En Proceso nunca enviada) se deriva en el cliente comparando
--              estas columnas (ver quincenasService.getEstadoVisual).
--
--              Todas nullable, sin default: el historial completo de ciclos repetidos
--              (enviar→rechazar→reenviar→aprobar→reabrir...) ya lo captura el trigger
--              genérico tr_audit_quincenas/fn_capture_audit() que corre desde la creación
--              de la tabla — estas columnas solo guardan el "último valor" de cada
--              transición para que los RPCs y la UI lo consulten sin tener que leer
--              audit_log.

BEGIN;

ALTER TABLE public.quincenas
    ADD COLUMN IF NOT EXISTS enviada_por UUID REFERENCES public.user_profiles(id),
    ADD COLUMN IF NOT EXISTS enviada_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS aprobada_por UUID REFERENCES public.user_profiles(id),
    ADD COLUMN IF NOT EXISTS aprobada_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS aprobada_comentario TEXT,
    ADD COLUMN IF NOT EXISTS rechazada_por UUID REFERENCES public.user_profiles(id),
    ADD COLUMN IF NOT EXISTS rechazada_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS rechazo_motivo TEXT,
    ADD COLUMN IF NOT EXISTS reabierta_por UUID REFERENCES public.user_profiles(id),
    ADD COLUMN IF NOT EXISTS reabierta_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS reapertura_motivo TEXT;

COMMIT;
