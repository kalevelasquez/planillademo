// US-VIA-05 CA4 — "Lavado y gasolina" (concepto Fijo) es condicional: solo se otorga si el
// motorista lavó el vehículo al menos este número de veces en la quincena. El monto en sí NO
// es un valor fijo en código (lo escribe el Preparador) — lo único hardcodeado es el umbral.
export const CONCEPTO_LAVADO_GASOLINA = 'Lavado y gasolina';
export const CANTIDAD_LAVADOS_MINIMA = 3;

export function esConceptoLavadoGasolina(concepto: string): boolean {
    return concepto.trim() === CONCEPTO_LAVADO_GASOLINA;
}

export function puedeAplicarLavadoGasolina(cantidadLavados: number | null): boolean {
    return (cantidadLavados ?? 0) >= CANTIDAD_LAVADOS_MINIMA;
}
