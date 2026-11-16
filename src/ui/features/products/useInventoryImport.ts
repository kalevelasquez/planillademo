import { useState } from 'react';
import { z } from 'zod';
import { productService } from '../../../services/productService';
import type { Product } from '../../../services/productService';
import { useAuthStore } from '../../../store/authStore';
import { MESSAGES } from '../../../config/constants';
import { supabase } from '../../../services/authService';
import { mapExcelRowToProduct, validateExcelHeaders } from '../../../utils/excelUtils';
import { useTimeoutGuard } from '../../../hooks/useTimeoutGuard';

/**
 * CA1: Lógica de validación de pedidos (Zod Schema) (US-NFR-02)
 */
export const productSchema = z.object({
    name: z.string().min(1, 'El producto es requerido'),
    quality: z.string().min(1, 'La calidad es requerida'),
    caliber: z.string().min(1, 'El calibre es requerido'),
    brand: z.string().min(1, 'La marca es requerida'),
    shipment_number: z.string().min(1, 'El embarque es requerido'),
    category: z.string().optional().default('OTROS'),
    entry_date: z.any().optional().nullable(),
    price: z.number().min(0, 'El precio debe ser mayor o igual a 0').default(0),
    available_quantity: z.number().min(0, 'El inventario debe ser mayor o igual a 0').default(0)
});

export type ExcelRow = Record<string, any>;

interface ImportResult {
    success: boolean;
    message: string;
    errors?: string[];
    totalRows?: number;
    successCount?: number;
    errorCount?: number;
    newCount?: number;
    updatedCount?: number;
    versionId?: string;
}

export const useInventoryImport = () => {
    const { profile } = useAuthStore();
    const [isImporting, setIsImporting] = useState(false);
    const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
    const { trackAction } = useTimeoutGuard();

    const processImport = async (file: File): Promise<ImportResult> => {
        if (!profile?.tenant_id) {
            return { success: false, message: MESSAGES.ERROR.SESSION_INVALID };
        }

        setIsImporting(true);
        setImportProgress({ current: 0, total: 0 });

        return trackAction("Importación de Inventario", (async () => {
            try {
            // Upload to storage for audit
            const timestamp = new Date().getTime();
            const filePath = `${profile.tenant_id}/${timestamp}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

            const { error: uploadError } = await supabase.storage
                .from('inventory_documents')
                .upload(filePath, file, { upsert: true });

            if (uploadError) {
                console.error("Storage upload failed:", uploadError);
                throw new Error("No se pudo subir el archivo de Excel al bucket de almacenamiento.");
            }

            const { read, utils } = await import('xlsx');
            const dataBuffer = await file.arrayBuffer();
            const workbook = read(dataBuffer, { type: 'array', cellDates: true });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            const rawMatrix = utils.sheet_to_json(worksheet, { header: 1 }) as any[][];
            const headersRow = rawMatrix.length > 0 ? (rawMatrix[0] || []).map(String) : [];

            if (headersRow.length === 0) {
                throw new Error(MESSAGES.ERROR.EXCEL_EMPTY);
            }

            const { isValid, missingHeaders } = validateExcelHeaders(headersRow);
            if (!isValid) {
                throw new Error(MESSAGES.ERROR.EXCEL_MISSING_HEADERS(missingHeaders.join(', ')));
            }

            const rawData = utils.sheet_to_json(worksheet, { defval: '' }) as ExcelRow[];
            if (rawData.length === 0) {
                throw new Error(MESSAGES.ERROR.EXCEL_EMPTY);
            }

            setImportProgress({ current: 0, total: rawData.length });

            const validPayloads: Partial<Product>[] = [];
            const quarantineData: { row_number: number; data: any; errors: string[] }[] = [];
            const validationErrors: string[] = [];

            let successCount = 0;
            let errorCount = 0;
            let newCount = 0;
            let updatedCount = 0;
            const uniqueCategories = new Set<string>();

            // Obtener catálogo actual para distinguir nuevos vs actualizados
            const { data: currentProducts } = await productService.getProducts(1, '', 2000, 'active');
            const productKeys = new Set(currentProducts.map(p =>
                `${p.name}|${p.caliber}|${p.brand}|${p.quality}|${p.shipment_number}`.toLowerCase().replace(/[\s_]+/g, '')
            ));

            // Procesar fila por fila
            for (let i = 0; i < rawData.length; i++) {
                const row = rawData[i];
                const rowIndex = i + 2;

                const mappedData = mapExcelRowToProduct(row);
                const result = productSchema.safeParse(mappedData);

                if (!result.success) {
                    const rowErrors = result.error.issues.map(e => e.message);
                    quarantineData.push({
                        row_number: rowIndex,
                        data: mappedData,
                        errors: rowErrors
                    });
                    validationErrors.push(`Fila ${rowIndex}: ${rowErrors.join(', ')}`);
                    errorCount++;
                } else {
                    const parsed = result.data;
                    uniqueCategories.add(parsed.category || 'OTROS');

                    const key = `${parsed.name}|${parsed.caliber}|${parsed.brand}|${parsed.quality}|${parsed.shipment_number}`
                        .toLowerCase().replace(/[\s_]+/g, '');

                    if (productKeys.has(key)) {
                        updatedCount++;
                    } else {
                        newCount++;
                    }

                    validPayloads.push({
                        ...parsed,
                        status: 'active',
                        tenant_id: profile.tenant_id
                    } as Partial<Product>);
                    successCount++;
                }

                // Actualizar progreso cada 10 filas para suavidad visual
                if (i % 10 === 0 || i === rawData.length - 1) {
                    setImportProgress({ current: i + 1, total: Math.round(rawData.length * 1.25) }); // Dejamos 20% para sync DB
                }
            }

            // Sync batches
            let importId = null;
            if (successCount > 0 || errorCount > 0) {
                const importRecord = await productService.createImportRecord({
                    tenant_id: profile.tenant_id,
                    file_name: file.name,
                    row_count: rawData.length,
                    success_count: successCount,
                    error_count: errorCount,
                    created_by: profile.id,
                    metadata: { new_count: newCount, updated_count: updatedCount }
                }).catch(() => productService.createImportRecord({
                    tenant_id: profile.tenant_id,
                    file_name: file.name,
                    row_count: rawData.length,
                    success_count: successCount,
                    error_count: errorCount,
                    created_by: profile.id
                }));

                importId = importRecord?.id;
            }

            // 1. Sincronizar Categorías primero (US-PERF-01/RES)
            const categories = await productService.syncCategories(Array.from(uniqueCategories), profile.tenant_id);
            const categoryMap = new Map<string, string>();
            categories.forEach((c: any) => categoryMap.set(c.name.toLowerCase().trim(), c.id));

            // 2. Mapear category_id y limpiar el payload para la BD
            const finalPayloads = validPayloads.map(p => {
                const catName = (p.category || 'OTROS').toLowerCase().trim();
                const category_id = categoryMap.get(catName);

                if (!category_id) {
                    console.warn(`Categoría no encontrada para el mapeo: ${p.category}`);
                }

                const clean = { ...p };
                delete clean.category; // Evitar error 400: Could not find 'category' column
                return {
                    ...clean,
                    category_id: category_id
                } as Product;
            });

            if (finalPayloads.length > 0) {
                setImportProgress(prev => ({ ...prev, current: Math.round(rawData.length * 1.1) }));
                await productService.syncProducts(finalPayloads, importId);
                
                // 3. Limpieza de catálogo (Replace Logic)
                if (importId) {
                    await productService.cleanupMissingProducts(profile.tenant_id, importId)
                        .catch(e => console.error("Error en la limpieza de catálogo post-importación:", e));
                }

                setImportProgress(prev => ({ ...prev, current: Math.round(rawData.length * 1.25) })); // 100%
            }

            if (quarantineData.length > 0 && importId) {
                const quarantinePayloads = quarantineData.map(q => ({
                    tenant_id: profile.tenant_id,
                    import_id: importId,
                    name: q.data.name,
                    category_name: q.data.category,
                    brand: q.data.brand,
                    caliber: q.data.caliber,
                    quality: q.data.quality,
                    shipment_number: q.data.shipment_number,
                    entry_date: q.data.entry_date ? new Date(q.data.entry_date).toISOString() : null,
                    available_quantity: q.data.available_quantity,
                    price: q.data.price,
                    excel_row_number: q.row_number,
                    validation_errors: q.errors,
                    raw_data: q.data
                }));
                await productService.createQuarantineRecords(quarantinePayloads).catch(e => console.error("Quarantine error:", e));
            }

            return {
                success: true,
                message: MESSAGES.SUCCESS.CATALOG_SYNC(successCount),
                totalRows: rawData.length,
                successCount,
                errorCount,
                newCount,
                updatedCount,
                versionId: importId?.substring(0, 8).toUpperCase()
            };

        } catch (err: any) {
            console.error("Import error:", err);
            return {
                success: false,
                message: err.message || MESSAGES.ERROR.EXCEL_READ_CRITICAL
            };
        } finally {
            setIsImporting(false);
        }
        })());
    };

    return { processImport, isImporting, importProgress };
};
