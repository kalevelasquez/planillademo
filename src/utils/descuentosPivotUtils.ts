import { normalizarTexto } from './fuzzyMatchUtils';

/**
 * Clasificación de descuentos hacia el reporte pivot de IMPL-167 (US-EXP-11) — columnas
 * confirmadas contra el Excel real de Imporfrut (`Planilla 1ra quincena abril 2026.xlsx`, hoja
 * "Descuentos"). `institucion` en `planilla_descuentos` es texto libre (no FK a Bancos), así que
 * el match contra estas listas usa `normalizarTexto()` (mismo criterio que
 * `buscarPorNombreSimilar`, sin inventar un segundo algoritmo de fuzzy-match).
 */

export const BANCOS_FINANCIERAS = [
    'Banco Davivienda', 'Banco Promerica', 'Banco Azul', 'Banco Agrícola', 'Banco Cuscatlán',
    'BAC', 'Primer Banco', 'Capital S.A. de C.V.', 'Cajas de Crédito', 'Banco Hipotecario',
] as const;

export const INSTITUCIONES_VIVIENDA = ['Habitad para la Humanidad', 'Fondo Social para la Vivienda'] as const;

export const CATEGORIAS_DIVERSAS = [
    'Calzado y Uniformes', 'Procuraduría', 'Anticipos', 'Descuento compra producto', 'Reintegro de viaje', 'Descuento genérico',
] as const;

/** Columna catch-all: ninguna categoría/institución se pierde, todo lo no reconocido aterriza acá. */
export const COLUMNA_DESCUENTO_GENERICO = 'Descuento genérico';
const COLUMNA_OTRAS_FINANCIERAS = 'Otras Instituciones Financieras';
const COLUMNA_OTRA_VIVIENDA = 'Otra Vivienda';
const COLUMNA_VEHICULO = 'Vehículo';
const COLUMNA_LENTES = 'Lentes';

export type GrupoColumnaDescuento = 'financieras' | 'vivienda' | 'vehiculo' | 'lentes' | 'diversos';

export interface ClasificacionDescuento {
    grupo: GrupoColumnaDescuento;
    /** Nombre exacto de la columna del reporte donde debe sumarse el monto. */
    columna: string;
}

function matchPorNombre(valor: string | null, opciones: readonly string[]): string | null {
    if (!valor) return null;
    const normalizado = normalizarTexto(valor);
    return opciones.find((op) => normalizarTexto(op) === normalizado) ?? null;
}

/**
 * Clasifica un descuento (por nombre de categoría + institución en texto libre) hacia su columna
 * del reporte pivot. Ninguna combinación queda sin columna: lo que no matchea una lista conocida
 * cae en un catch-all documentado (`COLUMNA_DESCUENTO_GENERICO` u "Otra/s..."), nunca se descarta
 * el monto.
 */
export function clasificarDescuento(categoriaNombre: string, institucion: string | null): ClasificacionDescuento {
    const categoriaNormalizada = normalizarTexto(categoriaNombre);

    if (categoriaNormalizada === normalizarTexto('Préstamo bancario') || categoriaNormalizada === normalizarTexto('Financiera')) {
        const banco = matchPorNombre(institucion, BANCOS_FINANCIERAS);
        return { grupo: 'financieras', columna: banco ?? COLUMNA_OTRAS_FINANCIERAS };
    }

    if (categoriaNormalizada === normalizarTexto('Vivienda')) {
        const institucionVivienda = matchPorNombre(institucion, INSTITUCIONES_VIVIENDA);
        return { grupo: 'vivienda', columna: institucionVivienda ?? COLUMNA_OTRA_VIVIENDA };
    }

    if (categoriaNormalizada === normalizarTexto('Vehículo')) {
        return { grupo: 'vehiculo', columna: COLUMNA_VEHICULO };
    }

    if (categoriaNormalizada === normalizarTexto('Lentes')) {
        return { grupo: 'lentes', columna: COLUMNA_LENTES };
    }

    const diversa = matchPorNombre(categoriaNombre, CATEGORIAS_DIVERSAS);
    if (diversa) {
        return { grupo: 'diversos', columna: diversa };
    }

    // Catch-all: categorías heredadas (Uniforme, Faltante de caja, Factura de producto,
    // Permiso sin goce) o cualquier categoría nueva que un admin cree sin saber de este reporte.
    return { grupo: 'diversos', columna: COLUMNA_DESCUENTO_GENERICO };
}

/** Orden de columnas del reporte, tal cual el Excel real (Financieras → Vivienda → Vehículo → Lentes → Diversos). */
export const COLUMNAS_REPORTE_DESCUENTOS: { grupo: GrupoColumnaDescuento; columnas: string[] }[] = [
    { grupo: 'financieras', columnas: [...BANCOS_FINANCIERAS, COLUMNA_OTRAS_FINANCIERAS] },
    { grupo: 'vivienda', columnas: [...INSTITUCIONES_VIVIENDA, COLUMNA_OTRA_VIVIENDA] },
    { grupo: 'vehiculo', columnas: [COLUMNA_VEHICULO] },
    { grupo: 'lentes', columnas: [COLUMNA_LENTES] },
    { grupo: 'diversos', columnas: [...CATEGORIAS_DIVERSAS] },
];
