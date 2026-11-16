-- ============================================================
-- Migración: Sincronización de estados de pedido con constantes del FrontEnd
-- Autor: Antigravity — ImporFrut
-- Fecha: 2026-03-11
-- ============================================================

-- 1. Eliminar el check constraint anterior
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- 2. Actualizar datos existentes de español (minúsculas) a los valores PascalCase usados en constants.ts
UPDATE orders SET status = 'Draft' WHERE status = 'borrador';
UPDATE orders SET status = 'Pending' WHERE status = 'pendiente';
UPDATE orders SET status = 'Approved' WHERE status = 'aprobado';
UPDATE orders SET status = 'Delivered' WHERE status = 'entregado';
UPDATE orders SET status = 'Cancelled' WHERE status = 'cancelado';

-- 3. Agregar el nuevo check constraint con los valores sincronizados
-- Incluye 'In Preparation' que es requerido por el dashboard de despacho
ALTER TABLE orders ADD CONSTRAINT orders_status_check 
CHECK (status IN ('Draft', 'Pending', 'Approved', 'In Preparation', 'Delivered', 'Cancelled'));
