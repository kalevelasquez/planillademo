import { useEffect, useMemo, useState } from 'react';
import { descuentosService } from '../../../../services/descuentosService';
import { descuentoCategoriasService } from '../../../../services/descuentoCategoriasService';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { clasificarDescuento } from '../../../../utils/descuentosPivotUtils';
import { Logger } from '../../../../utils/logger';

export interface FilaInstitucionFinanciera {
    codigoEmpleado: string;
    nombreEmpleado: string;
    monto: number;
}

export interface GrupoInstitucionFinanciera {
    institucion: string;
    filas: FilaInstitucionFinanciera[];
    subtotal: number;
}

/**
 * CA13 (US-CIE-03/IMPL-106, catálogo US-EXP-03/IMPL-101) — total a pagar por institución
 * financiera para UNA quincena puntual. A diferencia del reporte de Descuentos (snapshot del
 * maestro `planilla_descuentos`, sin filtrar por quincena), este usa
 * `planilla_descuento_eventos` (tipo='pago') como fuente del monto REALMENTE aplicado esa
 * quincena — no `monto_quincenal` (nominal, puede no coincidir si el descuento cambió o se
 * suspendió puntualmente). Solo categorías `tipo = 'fijo'` (Préstamo bancario, Financiera,
 * Vivienda, Vehículo) — mismo criterio que IMPL-95: son compromisos con instituciones externas
 * que siempre se aplican completos, a diferencia de `tipo = 'variable'` (uniformes, lentes,
 * etc.), que no tiene una institución real detrás. Reusa `clasificarDescuento` (mismo helper que
 * el reporte pivot de Descuentos, IMPL-167) para agrupar por institución con el mismo criterio
 * de normalización ya validado contra el Excel real de Imporfrut.
 */
export function useInstitucionesFinancierasReporte(quincenaId: string | null) {
    const [grupos, setGrupos] = useState<GrupoInstitucionFinanciera[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        setError(false);
        Promise.all([
            descuentosService.getTodos(),
            descuentoCategoriasService.getTodos(),
            descuentosService.getEventosPorQuincena(quincenaId),
            planillaEmpleadosService.getEmpleadosParaReportes(),
        ])
            .then(([descuentos, categorias, eventos, empleados]) => {
                const descuentosPorId = new Map(descuentos.map((d) => [d.id, d]));
                const categoriasPorId = new Map(categorias.map((c) => [c.id, c]));
                const empleadosPorId = new Map(empleados.map((e) => [e.id, e]));

                const porInstitucion = new Map<string, FilaInstitucionFinanciera[]>();

                for (const evento of eventos) {
                    if (evento.tipo !== 'pago' || evento.monto == null) continue;
                    const descuento = descuentosPorId.get(evento.descuento_id);
                    if (!descuento) continue;
                    const categoria = categoriasPorId.get(descuento.categoria_id);
                    if (!categoria || categoria.tipo !== 'fijo') continue;
                    const empleado = empleadosPorId.get(descuento.empleado_id);
                    if (!empleado) continue;

                    const { columna } = clasificarDescuento(categoria.nombre, descuento.institucion);
                    const filas = porInstitucion.get(columna) ?? [];
                    filas.push({
                        codigoEmpleado: empleado.codigo_empleado_manual ?? empleado.codigo,
                        nombreEmpleado: empleado.nombre_completo,
                        monto: evento.monto,
                    });
                    porInstitucion.set(columna, filas);
                }

                const gruposOrdenados: GrupoInstitucionFinanciera[] = Array.from(porInstitucion.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([institucion, filas]) => ({
                        institucion,
                        filas: filas.sort((a, b) => a.nombreEmpleado.localeCompare(b.nombreEmpleado)),
                        subtotal: filas.reduce((s, f) => s + f.monto, 0),
                    }));

                setGrupos(gruposOrdenados);
            })
            .catch((err: unknown) => {
                Logger.error('Error al cargar reporte de Instituciones Financieras', { quincenaId }, err);
                setError(true);
            })
            .finally(() => setIsLoading(false));
    }, [quincenaId]);

    const totalGeneral = useMemo(() => grupos.reduce((s, g) => s + g.subtotal, 0), [grupos]);
    const totalFilas = useMemo(() => grupos.reduce((s, g) => s + g.filas.length, 0), [grupos]);

    return { grupos, totalGeneral, totalFilas, isLoading, error };
}
