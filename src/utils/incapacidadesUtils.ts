// US-INC-01 CA2/CA3/CA5 — el cálculo de cobertura/subsidio es SIEMPRE automático y estricto
// según tipo + duración, sin excepción manual posible (CA5). El % que cubre el ISSS es solo
// informativo (CA4) y vive como constante separada, no participa de este cálculo.

export type TipoIncapacidad = 'enfermedad_comun' | 'accidente_trabajo' | 'maternidad';

export const DIAS_ENFERMEDAD_COMUN_SIN_SUBSIDIO = 3;
export const PORCENTAJE_ISSS_INFORMATIVO = 66.67; // solo informativo para RRHH, CA4 — no participa del cálculo

export interface CoberturaIncapacidad {
    conSubsidio: boolean;
    diasCubiertosImporfrut: number;
    diaInicioSubsidioIsss: number | null; // 1-indexed, null si no aplica subsidio
}

/** Días totales del certificado, ambos extremos inclusive. */
export function calcularDiasIncapacidad(fechaInicio: string, fechaFin: string): number {
    const inicio = new Date(`${fechaInicio}T00:00:00`);
    const fin = new Date(`${fechaFin}T00:00:00`);
    const diffMs = fin.getTime() - inicio.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;
}

export function calcularCoberturaIncapacidad(tipo: TipoIncapacidad, dias: number): CoberturaIncapacidad {
    if (tipo === 'accidente_trabajo' || tipo === 'maternidad') {
        return { conSubsidio: true, diasCubiertosImporfrut: 0, diaInicioSubsidioIsss: 1 };
    }

    // enfermedad_comun
    if (dias <= DIAS_ENFERMEDAD_COMUN_SIN_SUBSIDIO) {
        return { conSubsidio: false, diasCubiertosImporfrut: dias, diaInicioSubsidioIsss: null };
    }
    return {
        conSubsidio: true,
        diasCubiertosImporfrut: DIAS_ENFERMEDAD_COMUN_SIN_SUBSIDIO,
        diaInicioSubsidioIsss: DIAS_ENFERMEDAD_COMUN_SIN_SUBSIDIO + 1,
    };
}
