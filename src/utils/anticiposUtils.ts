export type TipoAnticipo = 'salario' | 'vacaciones' | 'aguinaldo';

export const TIPOS_ANTICIPO_CON_AUTORIZACION_GG: TipoAnticipo[] = ['vacaciones', 'aguinaldo'];

export function requiereAutorizacionGG(tipo: TipoAnticipo): boolean {
    return TIPOS_ANTICIPO_CON_AUTORIZACION_GG.includes(tipo);
}

// Compartida con Descuentos (US-DESC-01/IMPL-58) — ver cuotasUtils.ts.
export { calcularMontoCuota } from './cuotasUtils';
