-- ============================================================
-- Migración: Notas en líneas de producto (order_items.notes)
-- Autor: @programador — ImporFrut / Teknergy Inc.
-- Fecha: 2026-03-10
-- US: US-ORD-05 — Notas en el Pedido (CA2)
-- ============================================================
-- La tabla orders YA tiene columna notes TEXT.
-- Solo falta agregar notes a order_items para notas por línea.
-- ============================================================

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS notes TEXT;
