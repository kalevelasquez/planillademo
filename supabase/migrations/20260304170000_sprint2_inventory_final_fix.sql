-- Migration: Sprint 2 Inventory Final Fix
-- Reparación de Trigger de Inventario y Políticas de Storage (Fase 0.4)

-- 1. Reparación de Trigger (Inmunidad a Sesión)
-- Modifica la función del trigger para que sea SECURITY DEFINER y maneje casos 
-- donde el usuario no existe en user_profiles (evitando fallos de Foreign Key).
CREATE OR REPLACE FUNCTION public.handle_product_stock_update()
RETURNS TRIGGER AS $$
BEGIN
  -- Solo insertar si el stock realmente cambió para evitar bucles
  IF (OLD.available_quantity IS DISTINCT FROM NEW.available_quantity) THEN
    INSERT INTO public.inventory_versions (product_id, previous_quantity, new_quantity, updated_by)
    VALUES (
      NEW.id, 
      OLD.available_quantity, 
      NEW.available_quantity, 
      (SELECT id FROM public.user_profiles WHERE id = auth.uid() LIMIT 1) -- Si no hay sesión, pone NULL pero no falla
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Políticas de Storage Simplificadas (Bucket inventory_documents)
-- El SDK de Supabase a veces falla con políticas complejas de EXISTS. 
-- Vamos a simplificar para asegurar la escritura para cualquier usuario autenticado:
DROP POLICY IF EXISTS "Users can insert inventory documents" ON storage.objects;
CREATE POLICY "Users can insert inventory documents"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'inventory_documents' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users can select inventory documents" ON storage.objects;
CREATE POLICY "Users can select inventory documents"
ON storage.objects FOR SELECT
USING (bucket_id = 'inventory_documents' AND auth.role() = 'authenticated');
