-- Migration: Marca de Corrección Manual en Marcaciones (IMPL-20 / US-HEX-05)
-- Author: @alexis
-- Description: CA2 pide que un registro corregido a mano muestre la etiqueta "Editado
--              manualmente" junto a su estado — esa marca debe sobrevivir más allá de la
--              validación en memoria (IMPL-23), hasta el registro persistido, para que quien
--              revise la quincena después (ej. Aprobador) siga viendo qué filas se tocaron a
--              mano. La auditoría del valor anterior/nuevo (CA3) se resuelve vía
--              `auditService.logAction` en el momento de la edición (mismo patrón que el
--              "revelado" de campo sensible en IMPL-3) — no requiere columnas nuevas.

BEGIN;

ALTER TABLE public.planilla_marcaciones ADD COLUMN IF NOT EXISTS editado_manualmente BOOLEAN NOT NULL DEFAULT false;

COMMIT;
