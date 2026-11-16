// US-VAC-01/02 (IMPL-65/66) — mismo cálculo que corre server-side en crear_vacacion/
// actualizar_vacacion (Art. 177 CT: recargo 30% sobre el monto base), reproducido acá SOLO
// para la vista previa en vivo del formulario (CA6) — el servidor es la autoridad final,
// nunca se confía en este cálculo del cliente para persistir.

export function calcularDiasVacacion(fechaInicio: string, fechaFin: string): number {
    const inicio = new Date(`${fechaInicio}T00:00:00`);
    const fin = new Date(`${fechaFin}T00:00:00`);
    const dias = Math.round((fin.getTime() - inicio.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    return Math.max(0, dias);
}

export interface CalculoVacacion {
    dias: number;
    sueldoDiario: number;
    montoBase: number;
    recargo30: number;
    montoTotal: number;
}

export function calcularPagoVacacion(fechaInicio: string, fechaFin: string, sueldoMensual: number): CalculoVacacion {
    const dias = calcularDiasVacacion(fechaInicio, fechaFin);
    const sueldoDiario = Math.round((sueldoMensual / 30) * 100) / 100;
    const montoBase = Math.round(sueldoDiario * dias * 100) / 100;
    const recargo30 = Math.round(montoBase * 0.3 * 100) / 100;
    return { dias, sueldoDiario, montoBase, recargo30, montoTotal: montoBase + recargo30 };
}
