import type { TFunction } from 'i18next';
import { StoreError } from '../../../../services/storeService';

/**
 * Mensaje traducido para mostrar al cliente. Un error que no sea `StoreError` es generico (el texto
 * crudo de la base/red nunca llega a la UI). El stock insuficiente nombra el producto pero NUNCA
 * cantidades.
 */
export const storeErrorMessage = (t: TFunction, error: unknown): string => {
    if (!(error instanceof StoreError)) return t('store.errors.generic');
    if (error.i18nKey === 'store.errors.insufficient_availability' && !error.productName) {
        return t('store.errors.insufficient_availability_generic');
    }
    return t(error.i18nKey, { product: error.productName });
};
