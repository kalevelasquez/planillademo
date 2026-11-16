export type TipoDescuento = 'fijo' | 'variable';

// Compartida con Anticipos (US-ANT-02/IMPL-51) — ver cuotasUtils.ts.
export { calcularMontoCuota } from './cuotasUtils';

/** US-DESC-03 (IMPL-60) CA1/CA2 — solo aplica a descuentos con cuotas definidas. */
export function esPenultimaCuota(numeroCuotas: number | null, cuotasPagadas: number): boolean {
    return numeroCuotas !== null && cuotasPagadas === numeroCuotas - 1;
}
