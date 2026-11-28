import { describe, it, expect } from 'vitest';
import i18n from '../../../../config/i18n';
import { StoreError } from '../../../../services/storeService';
import { storeErrorMessage } from './storeErrors';

const t = i18n.t.bind(i18n);

describe('storeErrorMessage', () => {
    it('traduce la clave i18n del StoreError', () => {
        expect(storeErrorMessage(t, new StoreError('store.errors.too_many_pending'))).toBe(
            'Ya tenés varios pedidos pendientes. Esperá a que los confirmemos para hacer otro.',
        );
        expect(storeErrorMessage(t, new StoreError('store.errors.invalid_credentials'))).toBe('Correo o contraseña incorrectos.');
    });

    it('stock insuficiente: con nombre del producto lo incluye; sin nombre usa la version generica (nunca cantidades)', () => {
        expect(storeErrorMessage(t, new StoreError('store.errors.insufficient_availability', 'Manzana Fuji'))).toBe(
            'No hay suficiente disponibilidad de Manzana Fuji, probá con una cantidad menor.',
        );
        expect(storeErrorMessage(t, new StoreError('store.errors.insufficient_availability'))).toBe(
            'No hay suficiente disponibilidad de uno de los productos, probá con una cantidad menor.',
        );
    });

    it('un error que no es StoreError se muestra como generico (no filtra el mensaje)', () => {
        const msg = storeErrorMessage(t, new Error('relation "orders" does not exist'));
        expect(msg).toBe('Ocurrió un error inesperado. Intentá de nuevo.');
        expect(msg).not.toContain('relation');
    });
});
