import { useEffect, useRef, useState } from 'react';
import { useOrderStore } from '../store/orderStore';
import { useAuthStore } from '../store/authStore';
import { orderService } from '../services/orderService';
import { useOrderCalculations } from '../ui/features/orders/hooks/useOrderCalculations';

/**
 * useDraftAutosave
 * Centraliza la lógica de persistencia de borradores en Supabase.
 * Se asegura de que el borrador se guarde desde que hay el primer ítem en el carrito.
 */
export function useDraftAutosave(isSubmitting: boolean = false) {
    const {
        selectedCustomer,
        activeDraftId,
        isRehydrating,
        draftNotes,
        items
    } = useOrderStore();
    const { profile } = useAuthStore();
    const { orderItemsDetails, subtotal, totalDiscount, totalFinal, totalItemsCount } = useOrderCalculations();

    const [isSaving, setIsSaving] = useState(false);
    const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Ref para el guard de concurrencia: no va en el array de dependencias del efecto
    // (evita re-disparar el efecto cuando isSaving cambia y causaría un loop infinito).
    const isSavingRef = useRef(false);

    useEffect(() => {
        // Primero: siempre limpiar el timer previo para evitar duplicidad o sobrescritura obsoleta
        if (autosaveTimerRef.current) {
            clearTimeout(autosaveTimerRef.current);
        }

        // Condición crítica: No hay nada que guardar si no hay cliente, no hay items,
        // o si estamos en medio de un envío oficial, rehidratación, o un save previo aún en vuelo.
        // isSavingRef previene que dos saves concurrentes ejecuten DELETE+INSERT en paralelo,
        // lo que causaría duplicación de items si el segundo DELETE corre antes del primer INSERT.
        if (isRehydrating || isSubmitting || isSavingRef.current || totalItemsCount === 0 || !selectedCustomer || !profile?.tenant_id) {
            return;
        }

        // "Immediately" check: Si es el primer ítem y no hay Draft en la DB, reducimos el delay
        // para dar feedback instantáneo y asegurar persistencia ante refresh.
        const delay = (!activeDraftId && totalItemsCount === 1) ? 200 : 1500;

        autosaveTimerRef.current = setTimeout(async () => {
            isSavingRef.current = true;
            setIsSaving(true);
            try {
                // Preparamos los ítems mapeados para la DB
                const processedItems = orderItemsDetails.map(item => ({
                    product_id: item.product.id,
                    quantity: item.quantity,
                    unit_price: item.unitPrice,
                    total_price: item.total,
                    notes: item.note || undefined,
                    discount_type: item.discountType || 'fixed',
                    discount_amount: item.discount_amount || 0,
                }));

                const savedId = await orderService.upsertDraft({
                    draftId: activeDraftId,
                    tenant_id: profile.tenant_id,
                    customer_id: selectedCustomer.id,
                    seller_id: profile.id,
                    subtotal,
                    discount_type: 'fixed',
                    discount_amount: totalDiscount,
                    total_amount: totalFinal,
                    notes: draftNotes || undefined,
                    items: processedItems,
                });

                // Si la DB nos devolvió un ID nuevo (porque era el primer save), lo actualizamos en el store
                if (savedId && savedId !== activeDraftId) {
                    useOrderStore.setState({ activeDraftId: savedId });
                }
            } catch (err) {
                console.warn('[Autosave] Error persistiendo borrador:', err);
            } finally {
                isSavingRef.current = false;
                setIsSaving(false);
            }
        }, delay);

        return () => {
            if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        items,
        draftNotes,
        selectedCustomer?.id,
        profile?.id,
        profile?.tenant_id,
        activeDraftId,
        isSubmitting,
        isRehydrating,
        totalItemsCount,
        orderItemsDetails,
        subtotal,
        totalDiscount,
        totalFinal
    ]);

    return { isSaving };
}
