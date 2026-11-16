import { DESCUENTO_IMPORT_HEADERS, DESCUENTO_IMPORT_HEADERS_OBLIGATORIOS } from '../config/constants';
import { normalizarTexto } from './fuzzyMatchUtils';
import { celdaAFechaISO } from './empleadosExcelUtils';

/**
 * Carga masiva de Descuentos desde Excel — mismo patrón que `empleadosExcelUtils.ts` (plantilla
 * propia descargable + parseo determinístico en cliente). Las reglas de negocio acá DUPLICAN a
 * propósito las de `crear_descuento` (ver migraciones `20260906090300` y `20261015130000`): es la
 * única forma de dar feedback fila-por-fila ANTES de llamar al RPC, que corre TODO el lote dentro
 * de una misma transacción (si una fila choca server-side, el lote entero revierte — igual que
 * `confirmar_importacion_empleados`). Repetir estas reglas acá es el mismo riesgo de "mirror
 * TS vs SQL real" ya documentado en el proyecto — si `crear_descuento` cambia, este archivo debe
 * revisarse también.
 */

const CATEGORIA_PRESTAMO_BANCARIO = 'Préstamo bancario';

export function validateDescuentoImportHeaders(headers: string[]): { isValid: boolean; missingHeaders: string[] } {
    const disponibles = headers.map(normalizarTexto);
    const missingHeaders = DESCUENTO_IMPORT_HEADERS_OBLIGATORIOS
        .map((k) => DESCUENTO_IMPORT_HEADERS[k])
        .filter((header) => !disponibles.includes(normalizarTexto(header)));
    return { isValid: missingHeaders.length === 0, missingHeaders };
}

function valorDe(row: Record<string, unknown>, header: string): unknown {
    const headerReal = Object.keys(row).find((h) => normalizarTexto(h) === normalizarTexto(header));
    return headerReal !== undefined ? row[headerReal] : undefined;
}

export interface DescuentoImportCruda {
    codigoEmpleado: string;
    categoriaNombre: string;
    institucion: string;
    montoQuincenalRaw: unknown;
    montoTotalRaw: unknown;
    numeroCuotasRaw: unknown;
    cuotaExactaRaw: unknown;
    fechaFinRaw: unknown;
    saldoInicialPagadoRaw: unknown;
}

export function mapExcelRowToDescuentoCruda(row: Record<string, unknown>): DescuentoImportCruda {
    const texto = (header: string) => String(valorDe(row, header) ?? '').trim();
    return {
        codigoEmpleado: texto(DESCUENTO_IMPORT_HEADERS.CODIGO_EMPLEADO),
        categoriaNombre: texto(DESCUENTO_IMPORT_HEADERS.CATEGORIA),
        institucion: texto(DESCUENTO_IMPORT_HEADERS.INSTITUCION),
        montoQuincenalRaw: valorDe(row, DESCUENTO_IMPORT_HEADERS.MONTO_QUINCENAL),
        montoTotalRaw: valorDe(row, DESCUENTO_IMPORT_HEADERS.MONTO_TOTAL),
        numeroCuotasRaw: valorDe(row, DESCUENTO_IMPORT_HEADERS.NUMERO_CUOTAS),
        cuotaExactaRaw: valorDe(row, DESCUENTO_IMPORT_HEADERS.CUOTA_EXACTA),
        fechaFinRaw: valorDe(row, DESCUENTO_IMPORT_HEADERS.FECHA_FIN),
        saldoInicialPagadoRaw: valorDe(row, DESCUENTO_IMPORT_HEADERS.SALDO_INICIAL_PAGADO),
    };
}

export interface DescuentoImportListo {
    empleado_id: string;
    categoria_id: string;
    institucion: string | null;
    monto_quincenal: number;
    monto_total: number | null;
    numero_cuotas: number | null;
    cuota_exacta: number | null;
    fecha_fin: string | null;
    monto_pagado_inicial: number;
}

export interface FilaImportacionDescuento {
    clientId: string;
    /** Fila 1 del Excel son los encabezados — la primera fila de datos es la 2. */
    numeroFilaExcel: number;
    codigoEmpleado: string;
    nombreEmpleado: string;
    errores: string[];
    /** `null` mientras haya al menos un error — esta fila no se manda al RPC. */
    listo: DescuentoImportListo | null;
}

export interface ContextoValidacionImportacionDescuentos {
    /** `codigo` es el que ya ve el usuario en el resto de la app (`getCodigoEmpleado`: manual si
     * existe, auto-generado si no) — resuelto por el llamador antes de validar, no acá. */
    empleados: { id: string; codigo: string; nombreCompleto: string }[];
    categoriasActivas: { id: string; nombre: string }[];
}

/**
 * Valida CADA fila del archivo contra las mismas reglas que `crear_descuento` (ver
 * `20261015130000_descuentos_fecha_fin_saldo_inicial_cuota_exacta.sql`): el CHECK
 * `(monto_total IS NULL) = (numero_cuotas IS NULL)` de la tabla, la regla especial de "Préstamo
 * bancario" (siempre requiere monto total + cuotas), y la validación de saldo inicial. Fallar acá
 * es mucho mejor UX que dejar que el lote entero reviente en el RPC transaccional.
 */
export function validarFilasImportacionDescuentos(
    crudas: DescuentoImportCruda[],
    contexto: ContextoValidacionImportacionDescuentos
): FilaImportacionDescuento[] {
    return crudas.map((c, index) => {
        const errores: string[] = [];

        let empleado: { id: string; codigo: string; nombreCompleto: string } | undefined;
        if (!c.codigoEmpleado) {
            errores.push('Código Empleado es obligatorio.');
        } else {
            empleado = contexto.empleados.find((e) => normalizarTexto(e.codigo) === normalizarTexto(c.codigoEmpleado));
            if (!empleado) errores.push(`Código Empleado "${c.codigoEmpleado}" no existe.`);
        }

        let categoria: { id: string; nombre: string } | undefined;
        if (!c.categoriaNombre) {
            errores.push('Categoría es obligatoria.');
        } else {
            categoria = contexto.categoriasActivas.find((cat) => normalizarTexto(cat.nombre) === normalizarTexto(c.categoriaNombre));
            if (!categoria) errores.push(`Categoría "${c.categoriaNombre}" no existe. Verificá el nombre exacto.`);
        }

        const montoQuincenalVacio = c.montoQuincenalRaw === undefined || c.montoQuincenalRaw === '';
        const montoQuincenal = montoQuincenalVacio ? NaN : Number(c.montoQuincenalRaw);
        if (montoQuincenalVacio) errores.push('Monto Quincenal es obligatorio.');
        else if (isNaN(montoQuincenal)) errores.push('Monto Quincenal debe ser numérico.');
        else if (montoQuincenal <= 0) errores.push('Monto Quincenal debe ser mayor a cero.');

        const montoTotalVacio = c.montoTotalRaw === undefined || c.montoTotalRaw === '';
        let montoTotal: number | null = null;
        if (!montoTotalVacio) {
            montoTotal = Number(c.montoTotalRaw);
            if (isNaN(montoTotal)) errores.push('Monto Total debe ser numérico.');
            else if (montoTotal <= 0) errores.push('Monto Total debe ser mayor a cero.');
        }

        const numeroCuotasVacio = c.numeroCuotasRaw === undefined || c.numeroCuotasRaw === '';
        let numeroCuotas: number | null = null;
        if (!numeroCuotasVacio) {
            numeroCuotas = Number(c.numeroCuotasRaw);
            if (isNaN(numeroCuotas) || !Number.isInteger(numeroCuotas) || numeroCuotas <= 0) {
                errores.push('Número de Cuotas debe ser un número entero mayor a cero.');
            }
        }

        const cuotaExactaVacia = c.cuotaExactaRaw === undefined || c.cuotaExactaRaw === '';
        let cuotaExacta: number | null = null;
        if (!cuotaExactaVacia) {
            cuotaExacta = Number(c.cuotaExactaRaw);
            if (isNaN(cuotaExacta) || cuotaExacta <= 0) errores.push('Cuota Exacta debe ser numérica mayor a cero.');
        }

        if (!numeroCuotasVacio && !cuotaExactaVacia) {
            errores.push('No puede indicar Número de Cuotas y Cuota Exacta al mismo tiempo — use solo una de las dos.');
        }

        // CHECK (monto_total IS NULL) = (numero_cuotas IS NULL) de la tabla: con Cuota Exacta en
        // vez de Número de Cuotas, el RPC igual deriva numero_cuotas — así que ambas cuentan como
        // "la otra mitad" de ese par para esta validación.
        if (montoTotalVacio && (!numeroCuotasVacio || !cuotaExactaVacia)) {
            errores.push('Número de Cuotas / Cuota Exacta requieren que Monto Total esté definido.');
        }
        if (!montoTotalVacio && numeroCuotasVacio && cuotaExactaVacia) {
            errores.push('Monto Total requiere Número de Cuotas o Cuota Exacta.');
        }

        const esPrestamoBancario = !!categoria && normalizarTexto(categoria.nombre) === normalizarTexto(CATEGORIA_PRESTAMO_BANCARIO);
        if (esPrestamoBancario) {
            if (montoTotalVacio) errores.push(`La categoría "${CATEGORIA_PRESTAMO_BANCARIO}" requiere Monto Total.`);
            if (numeroCuotasVacio && cuotaExactaVacia) errores.push(`La categoría "${CATEGORIA_PRESTAMO_BANCARIO}" requiere Número de Cuotas o Cuota Exacta.`);
        }

        const fechaFinVacia = c.fechaFinRaw === undefined || c.fechaFinRaw === '';
        let fechaFin: string | null = null;
        if (!fechaFinVacia) {
            fechaFin = celdaAFechaISO(c.fechaFinRaw);
            if (!fechaFin) errores.push('Fecha Fin con formato inválido (use DD/MM/AAAA).');
        }

        const saldoInicialVacio = c.saldoInicialPagadoRaw === undefined || c.saldoInicialPagadoRaw === '';
        let saldoInicial = 0;
        if (!saldoInicialVacio) {
            saldoInicial = Number(c.saldoInicialPagadoRaw);
            if (isNaN(saldoInicial) || saldoInicial < 0) {
                errores.push('Saldo Inicial Pagado debe ser numérico y no negativo.');
            } else if (saldoInicial > 0 && montoTotalVacio) {
                errores.push('Saldo Inicial Pagado solo aplica si Monto Total está definido.');
            } else if (montoTotal !== null && saldoInicial > montoTotal) {
                errores.push('El Saldo Inicial Pagado no puede superar el Monto Total.');
            }
        }

        const listo: DescuentoImportListo | null = errores.length === 0 ? {
            empleado_id: (empleado as { id: string }).id,
            categoria_id: (categoria as { id: string }).id,
            institucion: c.institucion || null,
            monto_quincenal: montoQuincenal,
            monto_total: montoTotal,
            numero_cuotas: numeroCuotas,
            cuota_exacta: cuotaExacta,
            fecha_fin: fechaFin,
            monto_pagado_inicial: saldoInicial,
        } : null;

        return {
            clientId: `fila-${index}`,
            numeroFilaExcel: index + 2,
            codigoEmpleado: c.codigoEmpleado,
            nombreEmpleado: empleado?.nombreCompleto ?? '',
            errores,
            listo,
        };
    });
}
