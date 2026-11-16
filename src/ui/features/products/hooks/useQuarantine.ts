import { useState, useEffect } from 'react';
import type { Product } from '../../../../services/productService';
import { productSchema } from '../useInventoryImport';
import { productService } from '../../../../services/productService';

interface UseQuarantineProps {
    tenantId?: string;
    activeTab: string;
    showToast: (msg: string, type: 'success' | 'error' | 'warning' | 'info') => void;
    onPromoteSuccess: () => void;
}

export const useQuarantine = ({ tenantId, activeTab, showToast, onPromoteSuccess }: UseQuarantineProps) => {
    const [quarantineItems, setQuarantineItems] = useState<any[]>([]);
    const [quarantineEdits, setQuarantineEdits] = useState<Record<string, any>>({});
    const [quarantineFieldErrors, setQuarantineFieldErrors] = useState<Record<string, Record<string, string>>>({});
    const [isPromoting, setIsPromoting] = useState<string | null>(null);
    const [editingQuarantineId, setEditingQuarantineId] = useState<string | null>(null);
    const [isQuarantineLoading, setIsQuarantineLoading] = useState(false);
    const [quarantineDBCount, setQuarantineDBCount] = useState<number>(0);

    const loadQuarantineData = async () => {
        if (!tenantId) return;
        setIsQuarantineLoading(true);
        try {
            const data = await productService.getQuarantinedProducts(tenantId);
            setQuarantineItems(data);
            setQuarantineDBCount(data.length);

            // Initialize edits state with DB values
            const initialEdits: Record<string, any> = {};
            data.forEach((q: any) => {
                initialEdits[q.id] = {
                    name: q.name || '',
                    brand: q.brand || '',
                    caliber: q.caliber || '',
                    quality: q.quality || '',
                    category: q.category_name || 'OTROS',
                    shipment_number: q.shipment_number || '',
                    price: q.price || 0,
                    available_quantity: q.available_quantity || 0,
                    entry_date: q.entry_date ? new Date(q.entry_date).toISOString().split('T')[0] : ''
                };
            });
            setQuarantineEdits(initialEdits);
            setQuarantineFieldErrors({});
        } catch (err) {
            console.error("Error fetching quarantine list:", err);
            showToast('Error al cargar cuarentena', 'error');
        } finally {
            setIsQuarantineLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab === 'quarantine') {
            loadQuarantineData();
        }
    }, [activeTab, tenantId]);

    const handleQuarantineEdit = (id: string, field: string, value: any) => {
        setQuarantineEdits(prev => ({
            ...prev,
            [id]: {
                ...prev[id],
                [field]: value
            }
        }));
        // Limpiar el error de ese campo si el usuario lo modifica
        if (quarantineFieldErrors[id]?.[field]) {
            setQuarantineFieldErrors(prev => ({
                ...prev,
                [id]: { ...prev[id], [field]: undefined } as any
            }));
        }
    };

    const handlePromote = async (qId: string) => {
        if (!tenantId) return { success: false };

        setIsPromoting(qId);
        setQuarantineFieldErrors(prev => ({ ...prev, [qId]: {} }));

        try {
            const rawEdits = quarantineEdits[qId];
            const unvalidatedProduct = {
                ...rawEdits,
                price: Number(rawEdits.price) || 0,
                available_quantity: Number(rawEdits.available_quantity) || 0
            };

            const parsed = productSchema.parse(unvalidatedProduct);

            // Re-resolve category ID (same logic as import)
            const catsInDb = await productService.getCategories();
            let catId = catsInDb.find(c => c.name.toLowerCase() === parsed.category.toLowerCase())?.id;

            if (!catId) {
                // Si la categoria no existe, la creamos al vuelo sincrónicamente
                const newCats = await productService.syncCategories([parsed.category], tenantId);
                catId = newCats.find(c => c.name.toLowerCase() === parsed.category.toLowerCase())?.id;
            }

            const finalPayload: Partial<Product> = {
                ...parsed,
                category_id: catId,
                status: parsed.available_quantity <= 0 ? 'incomplete' : 'active',
                tenant_id: tenantId
            };
            delete (finalPayload as any).category;

            // Formatear igual que el importador
            if (finalPayload.brand) finalPayload.brand = finalPayload.brand.replace(/\s+/g, '_');
            if (finalPayload.caliber) finalPayload.caliber = finalPayload.caliber.replace(/\s+/g, '_');
            if (finalPayload.shipment_number) finalPayload.shipment_number = finalPayload.shipment_number.replace(/\s+/g, '');

            await productService.promoteQuarantinedProduct(qId, finalPayload);

            showToast('Fila promovida al inventario', 'success');

            // Retirar de la vista local
            const newItems = quarantineItems.filter(i => i.id !== qId);
            setQuarantineItems(newItems);
            setQuarantineDBCount(newItems.length);

            // Close modal if open
            if (editingQuarantineId === qId) {
                setEditingQuarantineId(null);
            }

            // Notificar éxito al contenedor principal
            onPromoteSuccess();

            return { success: true, remaining: newItems.length };
        } catch (err: any) {
            if (err.name === 'ZodError') {
                const fieldErrs: Record<string, string> = {};
                err.issues.forEach((issue: any) => {
                    fieldErrs[issue.path[0]] = issue.message;
                });
                setQuarantineFieldErrors(prev => ({ ...prev, [qId]: fieldErrs }));
                showToast('Errores de validación en la fila', 'error');
            } else {
                console.error("Error promocionando:", err);
                showToast('Error de sistema al promover fila', 'error');
            }
            return { success: false };
        } finally {
            setIsPromoting(null);
        }
    };

    // Permite inyectar items desde fuera, por ejemplo tras un import con errores
    const injectQuarantineItems = (items: any[]) => {
        setQuarantineItems(items);
        setQuarantineDBCount(items.length);

        const initialEdits: Record<string, any> = {};
        items.forEach((q: any) => {
            initialEdits[q.id] = {
                name: q.name || '',
                brand: q.brand || '',
                caliber: q.caliber || '',
                quality: q.quality || '',
                category: q.category_name || 'OTROS',
                shipment_number: q.shipment_number || '',
                price: q.price || 0,
                available_quantity: q.available_quantity || 0,
                entry_date: q.entry_date ? new Date(q.entry_date).toISOString().split('T')[0] : ''
            };
        });
        setQuarantineEdits(initialEdits);
    };

    return {
        quarantineItems,
        quarantineEdits,
        quarantineFieldErrors,
        isPromoting,
        editingQuarantineId,
        setEditingQuarantineId,
        isQuarantineLoading,
        quarantineDBCount,
        handleQuarantineEdit,
        handlePromote,
        injectQuarantineItems
    };
};
