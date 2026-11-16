/**
 * Compartida entre Anticipos (US-ANT-02, IMPL-51) y Descuentos (US-DESC-01, IMPL-58) — ambas
 * épicas modelan "monto_total + numero_cuotas" con la misma fórmula de cuota fija (sin intereses,
 * sin prorrateo por cuotas ya pagadas). Extraída acá (revisión de arquitectura del PM) porque
 * antes vivía duplicada literal en `anticiposUtils.ts` y `descuentosUtils.ts`.
 */
export function calcularMontoCuota(montoTotal: number, numeroCuotas: number): number {
    return Math.round((montoTotal / numeroCuotas) * 100) / 100;
}
