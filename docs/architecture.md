# Arquitectura Técnica - ImporFrut B2B

## Propósito del Proyecto
Sistema de gestión de pedidos B2B diseñado para fuerza de ventas en terreno (vendedores) y equipos de despacho (bodega). El objetivo es digitalizar la toma de pedidos, control de inventario y seguimiento de transacciones en tiempo real.

## Stack Tecnológico
- **Frontend Core**: [React 19](https://react.dev) con TypeScript.
- **Backend / DB / Auth**: [Supabase](https://supabase.com) (PostgreSQL + RLS + Storage).
- **Gestión de Estado Global**: [Zustand](https://zustand-demo.pmnd.rs/) (Minimalista y reactivo).
- **Diseño y Estilos**: Vanilla CSS con variables de diseño + Tailwind CSS v4 para utilidades y componentes.
- **Documentación Dinámica**: i18next para internacionalización (i18n).

## Modelo Multi-Tenant (Seguridad RLS)
El sistema utiliza un aislamiento estricto por `tenant_id`. 
- Todas las tablas (`products`, `customers`, `orders`) contienen una columna de tipo UUID llamada `tenant_id`.
- Se implementan políticas de **Row Level Security (RLS)** en PostgreSQL para garantizar que un usuario autenticado solo pueda ver o modificar datos asociados a su propio Tenant.
- El perfil del usuario (`user_profiles`) vincula el `auth.uid()` con un `tenant_id`.

## Flujo de Datos
1. **Catálogo**: Los productos se cargan y sincronizan (vía Excel a través de `inventoryService`).
2. **Pedidos**: 
   - Se inician como `Draft` (Borradores persistentes para evitar pérdida por mala conexión).
   - Se promueven a `Approved` mediante una transacción atómica generada en Supabase (RPC `confirm_order_atomic`).
3. **Notificaciones**: Generación automática de PDFs en el cliente y envío via Deep-Links a WhatsApp.

## Auditoría y Trazabilidad
Todas las acciones críticas (Login, Compartir PDF, Exportar Reportes) se registran en una tabla centralizada de `audit_logs` para control administrativo.
