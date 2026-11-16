import { BANCOS_FINANCIERAS, INSTITUCIONES_VIVIENDA, CATEGORIAS_DIVERSAS } from './descuentosPivotUtils';
import type { GrupoCostosPivot } from '../ui/features/planilla/reportes/useDescuentosPivotReporte';

const COLUMNA_OTRAS_FINANCIERAS = 'Otras Instituciones Financieras';
const COLUMNA_OTRA_VIVIENDA = 'Otra Vivienda';

const COLUMNAS_FINANCIERAS = [...BANCOS_FINANCIERAS, COLUMNA_OTRAS_FINANCIERAS];
const COLUMNAS_VIVIENDA = [...INSTITUCIONES_VIVIENDA, COLUMNA_OTRA_VIVIENDA];
// Vehículo y Lentes son columnas propias del layout (van físicamente junto a Diversos, igual que
// el Excel real de Imporfrut), pero CA2 las trata como sumandos independientes del total general
// — "Otros Descuentos" es exclusivamente el subtotal de las 6 categorías catch-all de Diversos,
// NO incluye Vehículo ni Lentes (a diferencia de un intento anterior que sí las mezclaba).
const COLUMNAS_DIVERSOS = ['Vehículo', 'Lentes', ...CATEGORIAS_DIVERSAS];

/** Índice de columna (0-based) donde arranca cada bloque, después de Código(0)/Empleado(1). */
const COL_INICIO_FINANCIERAS = 2;
const COL_SUBTOTAL_FINANCIERAS = COL_INICIO_FINANCIERAS + COLUMNAS_FINANCIERAS.length; // 13
const COL_INICIO_VIVIENDA = COL_SUBTOTAL_FINANCIERAS + 1; // 14
const COL_SUBTOTAL_VIVIENDA = COL_INICIO_VIVIENDA + COLUMNAS_VIVIENDA.length; // 17
const COL_INICIO_DIVERSOS = COL_SUBTOTAL_VIVIENDA + 1; // 18
const COL_VEHICULO = COL_INICIO_DIVERSOS; // 18
const COL_LENTES = COL_INICIO_DIVERSOS + 1; // 19
const COL_INICIO_DIVERSAS_CATCHALL = COL_INICIO_DIVERSOS + 2; // 20 (después de Vehículo/Lentes)
const COL_SUBTOTAL_DIVERSOS = COL_INICIO_DIVERSOS + COLUMNAS_DIVERSOS.length; // 26 ("Otros Descuentos")
const COL_TOTAL_GENERAL = COL_SUBTOTAL_DIVERSOS + 1; // 27 ("Descuentos")

const ENCABEZADOS = [
    'Código', 'Empleado',
    ...COLUMNAS_FINANCIERAS, 'Descuentos Financieras',
    ...COLUMNAS_VIVIENDA, 'Vivienda',
    ...COLUMNAS_DIVERSOS, 'Otros Descuentos',
    'Descuentos',
];

/**
 * Exportación a Excel del reporte pivot de Descuentos (US-EXP-11, IMPL-167 CA2) — CON fórmulas
 * reales de subtotal (no solo valores), replicando las fórmulas del Excel de referencia de
 * Imporfrut: `Descuentos Financieras = suma columnas banco`, `Vivienda = suma columnas vivienda`,
 * `Otros Descuentos = suma de las 6 columnas catch-all de Diversos` (Vehículo/Lentes NO entran
 * acá, van directo al total), `Descuentos = Descuentos Financieras + Vivienda + Vehículo +
 * Lentes + Otros Descuentos` (5 sumandos, tal cual CA2). `exportToExcel` (exportUtils.ts) no
 * soporta fórmulas — se usa `xlsx` directamente, con el mismo encabezado corporativo
 * simplificado para mantener consistencia visual con el resto de exportaciones del sistema.
 */
export async function exportDescuentosPivotToExcel(grupos: GrupoCostosPivot[], fileName: string, generadoPor: string): Promise<void> {
    const XLSX = await import('xlsx');

    const timestamp = new Date().toLocaleString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const filas: (string | number)[][] = [
        ['IMPORFRUT - SISTEMA DE GESTIÓN OPERATIVA'],
        ['REPORTE: ESTADO DE DESCUENTOS'],
        [`Generado: ${timestamp}`, `Usuario: ${generadoPor}`],
        [],
        ENCABEZADOS,
    ];

    const filaEncabezado = filas.length; // 1-based: fila 5
    const filasFormula: { row: number; col: number; valor: number; formula: string }[] = [];
    const filasEmpleadoIdx: number[] = [];

    for (const grupo of grupos) {
        filas.push([grupo.nombre]);
        for (const departamento of grupo.departamentos) {
            filas.push([`  ${departamento.nombre}`]);
            for (const empleado of departamento.empleados) {
                const subtotalFinancieras = COLUMNAS_FINANCIERAS.reduce((acc, col) => acc + (empleado.columnas[col] ?? 0), 0);
                const subtotalVivienda = COLUMNAS_VIVIENDA.reduce((acc, col) => acc + (empleado.columnas[col] ?? 0), 0);
                const montoVehiculo = empleado.columnas['Vehículo'] ?? 0;
                const montoLentes = empleado.columnas['Lentes'] ?? 0;
                const subtotalDiversos = CATEGORIAS_DIVERSAS.reduce((acc, col) => acc + (empleado.columnas[col] ?? 0), 0);
                const totalGeneral = subtotalFinancieras + subtotalVivienda + montoVehiculo + montoLentes + subtotalDiversos;

                const filaValores: (string | number)[] = [empleado.codigoEmpleado, empleado.nombreEmpleado];
                for (const col of COLUMNAS_FINANCIERAS) filaValores.push(empleado.columnas[col] ?? 0);
                filaValores.push(subtotalFinancieras); // el valor real viaja en la celda; la fórmula se inyecta después para que Excel pueda auditar/recalcular
                for (const col of COLUMNAS_VIVIENDA) filaValores.push(empleado.columnas[col] ?? 0);
                filaValores.push(subtotalVivienda);
                for (const col of COLUMNAS_DIVERSOS) filaValores.push(empleado.columnas[col] ?? 0);
                filaValores.push(subtotalDiversos);
                filaValores.push(totalGeneral);

                const filaExcel1Based = filas.length + 1; // fila que va a ocupar esta fila de empleado
                filasEmpleadoIdx.push(filaExcel1Based);

                const letraFinFinancieras = XLSX.utils.encode_col(COL_SUBTOTAL_FINANCIERAS - 1);
                const letraInicioFinancieras = XLSX.utils.encode_col(COL_INICIO_FINANCIERAS);
                filasFormula.push({ row: filaExcel1Based, col: COL_SUBTOTAL_FINANCIERAS, valor: subtotalFinancieras, formula: `SUM(${letraInicioFinancieras}${filaExcel1Based}:${letraFinFinancieras}${filaExcel1Based})` });

                const letraInicioVivienda = XLSX.utils.encode_col(COL_INICIO_VIVIENDA);
                const letraFinVivienda = XLSX.utils.encode_col(COL_SUBTOTAL_VIVIENDA - 1);
                filasFormula.push({ row: filaExcel1Based, col: COL_SUBTOTAL_VIVIENDA, valor: subtotalVivienda, formula: `SUM(${letraInicioVivienda}${filaExcel1Based}:${letraFinVivienda}${filaExcel1Based})` });

                const letraInicioCatchAll = XLSX.utils.encode_col(COL_INICIO_DIVERSAS_CATCHALL);
                const letraFinDiversos = XLSX.utils.encode_col(COL_SUBTOTAL_DIVERSOS - 1);
                filasFormula.push({ row: filaExcel1Based, col: COL_SUBTOTAL_DIVERSOS, valor: subtotalDiversos, formula: `SUM(${letraInicioCatchAll}${filaExcel1Based}:${letraFinDiversos}${filaExcel1Based})` });

                const letraFinancieras = XLSX.utils.encode_col(COL_SUBTOTAL_FINANCIERAS);
                const letraVivienda = XLSX.utils.encode_col(COL_SUBTOTAL_VIVIENDA);
                const letraVehiculo = XLSX.utils.encode_col(COL_VEHICULO);
                const letraLentes = XLSX.utils.encode_col(COL_LENTES);
                const letraDiversos = XLSX.utils.encode_col(COL_SUBTOTAL_DIVERSOS);
                filasFormula.push({ row: filaExcel1Based, col: COL_TOTAL_GENERAL, valor: totalGeneral, formula: `${letraFinancieras}${filaExcel1Based}+${letraVivienda}${filaExcel1Based}+${letraVehiculo}${filaExcel1Based}+${letraLentes}${filaExcel1Based}+${letraDiversos}${filaExcel1Based}` });

                filas.push(filaValores);
            }
        }
    }

    // Fila de TOTAL GENERAL — suma todas las filas de empleado (con huecos, si el reporte tiene
    // filas de grupo/departamento intercaladas, SUM ignora las celdas de texto sin problema).
    const filaTotalGeneral = filas.length + 1;
    const totalesPorColumna = new Map<number, number>();
    for (let c = COL_INICIO_FINANCIERAS; c <= COL_TOTAL_GENERAL; c++) {
        const suma = filas.slice(filaEncabezado).reduce((acc, fila) => acc + (typeof fila[c] === 'number' ? (fila[c] as number) : 0), 0);
        totalesPorColumna.set(c, suma);
    }
    const filaTotalValores: (string | number)[] = ['', 'TOTAL GENERAL'];
    for (let c = COL_INICIO_FINANCIERAS; c <= COL_TOTAL_GENERAL; c++) filaTotalValores.push(totalesPorColumna.get(c) ?? 0);
    filas.push(filaTotalValores);

    const worksheet = XLSX.utils.aoa_to_sheet(filas);

    // Inyectar fórmulas de subtotal por fila de empleado — con `v` cacheado además de `f`: SheetJS
    // no ejecuta fórmulas al leer, así que sin `v` la celda aparece vacía para cualquier lector que
    // no recalcule (confirmado con una inspección directa del blob generado, UAT de IMPL-167).
    for (const { row, col, valor, formula } of filasFormula) {
        const ref = XLSX.utils.encode_cell({ r: row - 1, c: col });
        worksheet[ref] = { t: 'n', v: valor, f: formula };
    }

    // Inyectar fórmulas de la fila de TOTAL GENERAL (suma columna por columna, solo filas de empleado).
    if (filasEmpleadoIdx.length > 0) {
        for (let c = COL_INICIO_FINANCIERAS; c <= COL_TOTAL_GENERAL; c++) {
            const letraCol = XLSX.utils.encode_col(c);
            const rangos = filasEmpleadoIdx.map((r) => `${letraCol}${r}`).join('+');
            const ref = XLSX.utils.encode_cell({ r: filaTotalGeneral - 1, c });
            worksheet[ref] = { t: 'n', v: totalesPorColumna.get(c) ?? 0, f: rangos || '0' };
        }
    }

    const maxCol = ENCABEZADOS.length - 1;
    worksheet['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: maxCol } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: maxCol } },
    ];
    worksheet['!freeze'] = { xSplit: 2, ySplit: filaEncabezado, topLeftCell: `C${filaEncabezado + 1}`, activePane: 'bottomRight', state: 'frozen' };
    worksheet['!cols'] = [{ wch: 10 }, { wch: 28 }, ...ENCABEZADOS.slice(2).map(() => ({ wch: 14 }))];

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Descuentos');
    XLSX.writeFile(workbook, `${fileName}.xlsx`);
}
