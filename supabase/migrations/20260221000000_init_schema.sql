-- Migración Inicial ImporFrut: Esquema Multi-Tenant
-- Autor: @arquitecto
-- Fecha: 2026-02-21
-- Versión: 1.1 (RLS Sólido - Previene Tenant Hijacking)

-- 1. Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabla de Tenants (Base administrativa)
CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- Habilitar RLS en tenants
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;

-- 3. Tabla de Perfiles de Usuario (Extensión de auth.users)
CREATE TABLE IF NOT EXISTS user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    role TEXT NOT NULL CHECK (role IN ('admin', 'supervisor', 'vendedor', 'despachador')),
    full_name TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- 4. Tabla de Clientes
CREATE TABLE IF NOT EXISTS customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    assigned_seller_id UUID REFERENCES user_profiles(id),
    business_name TEXT NOT NULL,
    contact_name TEXT,
    phone TEXT,
    price_list TEXT NOT NULL CHECK (price_list IN ('empleado', 'cliente', 'mayoreo')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    deleted_at TIMESTAMPTZ -- Soft delete
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

-- 5. Tabla de Productos
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    category TEXT,
    brand TEXT,
    caliber TEXT,
    quality TEXT,
    available_quantity INTEGER DEFAULT 0 CHECK (available_quantity >= 0),
    price_empleado DECIMAL(12,2) DEFAULT 0,
    price_cliente DECIMAL(12,2) DEFAULT 0,
    price_mayoreo DECIMAL(12,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;

-- 6. Tabla de Pedidos (Orders)
CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    order_number TEXT NOT NULL,
    customer_id UUID NOT NULL REFERENCES customers(id),
    seller_id UUID NOT NULL REFERENCES user_profiles(id),
    status TEXT NOT NULL CHECK (status IN ('borrador', 'pendiente', 'aprobado', 'entregado', 'cancelado')),
    total_amount DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(tenant_id, order_number)
);

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- 7. Tabla de Detalle de Pedidos (Order Items)
CREATE TABLE IF NOT EXISTS order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(12,2) NOT NULL,
    total_price DECIMAL(12,2) NOT NULL
);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;

-- 8. TRIGGER: Creación automática de Perfil
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, full_name, role, tenant_id)
  VALUES (
    NEW.id, 
    NEW.raw_user_meta_data->>'full_name', 
    COALESCE(NEW.raw_user_meta_data->>'role', 'vendedor'),
    (NEW.raw_user_meta_data->>'tenant_id')::UUID
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 9. POLÍTICAS RLS (Aislamiento Multi-Tenant BASADO EN BASE DE DATOS)
-- Estas políticas son inmutables desde el cliente ya que consultan la tabla user_profiles directamente.

-- 9.1 Perfiles: Ver propio perfil o perfiles de su mismo tenant
CREATE POLICY "user_profiles_tenant_isolation" ON user_profiles
    FOR ALL USING (
        id = auth.uid() 
        OR tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    )
    WITH CHECK (
        id = auth.uid() 
        OR tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    );

-- 9.2 Clientes: Solo registros del mismo tenant
CREATE POLICY "customers_tenant_isolation" ON customers
    FOR ALL USING (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    )
    WITH CHECK (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    );

-- 9.3 Productos: Solo registros del mismo tenant
CREATE POLICY "products_tenant_isolation" ON products
    FOR ALL USING (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    )
    WITH CHECK (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    );

-- 9.4 Pedidos: Solo registros del mismo tenant
CREATE POLICY "orders_tenant_isolation" ON orders
    FOR ALL USING (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    )
    WITH CHECK (
        tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
    );

-- 9.5 Detalle de Pedidos: Parent-Order tenant validation
CREATE POLICY "order_items_tenant_isolation" ON order_items
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_items.order_id 
            AND orders.tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM orders 
            WHERE orders.id = order_items.order_id 
            AND orders.tenant_id = (SELECT tenant_id FROM public.user_profiles WHERE id = auth.uid())
        )
    );
