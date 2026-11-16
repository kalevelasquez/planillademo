import { EXCEL_HEADERS, MARCACION_HEADERS } from '../config/constants';
import { normalizarTexto } from './fuzzyMatchUtils';

/**
 * CA1: Lógica de parsing de Excel (US-NFR-02)
 * Extraída para permitir validación de encabezados y mapeo de datos sin dependencias del navegador.
 */

export const validateExcelHeaders = (headers: string[]) => {
    const mandatoryHeaders = Object.values(EXCEL_HEADERS)
        .filter(h => h !== EXCEL_HEADERS.DIAS_EN_BODEGA);

    const missingHeaders = mandatoryHeaders.filter(h => !headers.includes(h));

    return {
        isValid: missingHeaders.length === 0,
        missingHeaders
    };
};

export const mapExcelRowToProduct = (row: Record<string, any>) => {
    return {
        name: String(row[EXCEL_HEADERS.PRODUCTO] || '').trim().toUpperCase(),
        quality: String(row[EXCEL_HEADERS.CALIDAD] || '').trim().toUpperCase(),
        caliber: String(row[EXCEL_HEADERS.CALIBRE] || '').trim().toUpperCase(),
        brand: String(row[EXCEL_HEADERS.MARCA] || '').trim().toUpperCase(),
        shipment_number: String(row[EXCEL_HEADERS.EMBARQUE] || '').trim().toUpperCase(),
        category: String(row[EXCEL_HEADERS.CATEGORIA] || 'OTROS').trim().toUpperCase(),
        entry_date: row[EXCEL_HEADERS.INGRESO],
        price: Number(row[EXCEL_HEADERS.PRECIO] || 0),
        available_quantity: Number(row[EXCEL_HEADERS.INVENTARIO] || 0)
    };
};

/**
 * CA3 (US-HEX-02): "la plantilla puede variar por ubicación si el formato de su reloj difiere"
 * — el archivo real que comparte Imporfrut trae `Nombre`/`Entrada`/`Salir` en vez de
 * `NOMBRE COMPLETO`/`HORA DE ENTRADA`/`HORA DE SALIDA` (los nombres "canónicos" que sigue usando
 * la plantilla descargable de `handleDescargarPlantilla`). Este mapeo son las variantes
 * ADEMÁS del nombre canónico — el matching es insensible a mayúsculas/tildes vía
 * `normalizarTexto` (mismo criterio que `constanciaSalarioUtils.sumarCategoria`), así que
 * `ID DE USUARIO`/`FECHA` ya matchean `ID de usuario`/`Fecha` sin necesitar una variante aparte.
 */
const MARCACION_HEADER_VARIANTES: Record<keyof typeof MARCACION_HEADERS, string[]> = {
    ID_USUARIO: [MARCACION_HEADERS.ID_USUARIO],
    NOMBRE_COMPLETO: [MARCACION_HEADERS.NOMBRE_COMPLETO, 'NOMBRE'],
    FECHA: [MARCACION_HEADERS.FECHA],
    HORA_ENTRADA: [MARCACION_HEADERS.HORA_ENTRADA, 'ENTRADA'],
    HORA_SALIDA: [MARCACION_HEADERS.HORA_SALIDA, 'SALIDA', 'SALIR'],
};

/** Encuentra, entre los encabezados reales del archivo subido, cuál matchea (normalizado) alguna
 * de las variantes aceptadas para ese campo — `undefined` si ninguno matchea. */
function resolverHeaderReal(headersDisponibles: string[], variantes: string[]): string | undefined {
    const normalizadas = variantes.map(normalizarTexto);
    return headersDisponibles.find((h) => normalizadas.includes(normalizarTexto(h)));
}

/**
 * US-HEX-02 CA2: valida que el archivo del reloj marcador tenga los 5 campos mínimos.
 * Cualquier otra columna (HEN/HED/Nocturnidad/Corto pre-calculados) se ignora silenciosamente
 * — no se valida su ausencia ni presencia, simplemente no se lee.
 */
export const validateMarcacionHeaders = (headers: string[]) => {
    const missingHeaders = (Object.keys(MARCACION_HEADERS) as (keyof typeof MARCACION_HEADERS)[])
        .filter((campo) => !resolverHeaderReal(headers, MARCACION_HEADER_VARIANTES[campo]))
        .map((campo) => MARCACION_HEADERS[campo]);

    return {
        isValid: missingHeaders.length === 0,
        missingHeaders,
    };
};

export interface MarcacionCruda {
    idUsuario: string;
    nombreCompleto: string;
    fecha: string;
    horaEntrada: string;
    horaSalida: string;
}

/**
 * `xlsx.read` se llama con `cellDates: true` (ImportacionMarcacionesSection.tsx), así que si la
 * celda del reloj viene con formato de fecha/hora nativo de Excel (no texto), `sheet_to_json`
 * entrega un `Date` en vez de un string. SheetJS construye ese `Date` con componentes UTC (gotcha
 * documentado: https://docs.sheetjs.com/docs/csf/features/dates/), por eso se usan los getters
 * UTC acá — usar getters locales corrompería la fecha/hora según el timezone del navegador.
 */
function celdaAFecha(valor: unknown): string {
    if (valor instanceof Date) {
        const y = valor.getUTCFullYear();
        const m = String(valor.getUTCMonth() + 1).padStart(2, '0');
        const d = String(valor.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return String(valor ?? '').trim();
}

function celdaAHora(valor: unknown): string {
    if (valor instanceof Date) {
        const h = String(valor.getUTCHours()).padStart(2, '0');
        const min = String(valor.getUTCMinutes()).padStart(2, '0');
        return `${h}:${min}`;
    }
    return String(valor ?? '').trim();
}

/**
 * US-HEX-02 CA2: mapea una fila cruda del archivo a los 5 campos mínimos. Soporta tanto texto
 * plano ("2026-07-20", "08:00") como celdas de fecha/hora nativas de Excel (ver `celdaAFecha`/
 * `celdaAHora` — antes de este fix, una celda nativa producía un string tipo
 * "Wed Jul 20 2026 00:00:00 GMT..." en vez de la fecha, corrompiendo el dato en silencio).
 *
 * Igual que `validateMarcacionHeaders`, resuelve el encabezado real de CADA fila (no asume el
 * nombre canónico) — necesario porque `sheet_to_json` usa el texto exacto del encabezado del
 * archivo como clave del objeto, y el archivo real de Imporfrut no usa los nombres canónicos.
 */
export const mapExcelRowToMarcacion = (row: Record<string, any>): MarcacionCruda => {
    const headersDisponibles = Object.keys(row);
    const valorDe = (campo: keyof typeof MARCACION_HEADERS): unknown => {
        const headerReal = resolverHeaderReal(headersDisponibles, MARCACION_HEADER_VARIANTES[campo]);
        return headerReal !== undefined ? row[headerReal] : undefined;
    };

    return {
        idUsuario: String(valorDe('ID_USUARIO') ?? '').trim(),
        nombreCompleto: String(valorDe('NOMBRE_COMPLETO') ?? '').trim(),
        fecha: celdaAFecha(valorDe('FECHA')),
        horaEntrada: celdaAHora(valorDe('HORA_ENTRADA')),
        horaSalida: celdaAHora(valorDe('HORA_SALIDA')),
    };
};
