import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, ChevronDown, TrendingUp, TrendingDown } from 'lucide-react';

import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { calculoPlanillaService, type CalculoEmpleado } from '../../../../services/calculoPlanillaService';
import { Logger } from '../../../../utils/logger';

interface ResumenDepartamentosSectionProps {
    quincenaId: string;
    quincenaAnteriorId: string | null;
}

interface DepartamentoRow {
    departamento: string | null;
    count: number;
    ingresos: number;
    deducciones: number;
    neto: number;
    conCalculo: boolean;
}

const UMBRAL_VARIACION = 0.10;

// IMPL-178 (defecto UAT) — mismo defecto que ResumenFinancieroSection.tsx (ver su comentario):
// faltaban vacaciones_monto y otros_ingresos_*, y en Deducciones faltaba ipsfa_empleado. También
// suma las bases "bono10" (vacaciones no gozadas/bonificaciones/otros ingresos/incapacidad con
// Renta 10%) — bug real de plata en el motor, corregido en `20260925110000_...sql`.
function sumaIngresos(r: CalculoEmpleado): number {
    return r.sueldo_proporcional + r.horas_extras_monto + r.viaticos_monto
        + r.vacaciones_monto + r.vacaciones_bono10_base
        + r.bonificaciones_monto
        + r.otros_ingresos_gravables + r.otros_ingresos_no_gravables + r.otros_ingresos_bono10_base
        + r.incapacidad_bono10_base;
}

function sumaDeducciones(r: CalculoEmpleado): number {
    return r.isss_empleado + r.afp_empleado + r.ipsfa_empleado + r.renta_isr + r.renta_bono10 + r.descuentos_no_obligatorios_aplicado;
}

function agruparPorDepartamento(
    empleados: { id: string; departamento: string | null }[],
    registros: CalculoEmpleado[]
): DepartamentoRow[] {
    const calculoPorEmpleado = new Map(registros.map((r) => [r.empleado_id, r]));
    const porDepto = new Map<string | null, DepartamentoRow>();

    for (const emp of empleados) {
        const key = emp.departamento?.trim() || null;
        const actual = porDepto.get(key) ?? { departamento: key, count: 0, ingresos: 0, deducciones: 0, neto: 0, conCalculo: false };
        actual.count += 1;
        const r = calculoPorEmpleado.get(emp.id);
        if (r) {
            actual.ingresos += sumaIngresos(r);
            actual.deducciones += sumaDeducciones(r);
            actual.neto += r.neto_a_pagar;
            actual.conCalculo = true;
        }
        porDepto.set(key, actual);
    }

    return [...porDepto.values()];
}

/**
 * Resumen por Departamento (US-QNA-08 CA3) — RESUELTO (revisión épica por épica, post-IMPL-85):
 * Ingresos/Deducciones/Neto ahora son reales, sumados desde `planilla_calculo_empleado` por
 * empleado y agrupados por su `departamento`. "Variaciones Destacadas" compara el Neto de cada
 * departamento contra la quincena anterior del mismo tipo (>10% de cambio se marca destacada).
 */
export const ResumenDepartamentosSection: React.FC<ResumenDepartamentosSectionProps> = ({ quincenaId, quincenaAnteriorId }) => {
    const { t } = useTranslation();
    const [empleados, setEmpleados] = useState<{ id: string; departamento: string | null }[]>([]);
    const [registros, setRegistros] = useState<CalculoEmpleado[]>([]);
    const [registrosAnterior, setRegistrosAnterior] = useState<CalculoEmpleado[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [verVariaciones, setVerVariaciones] = useState(false);

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        Promise.all([
            planillaEmpleadosService.getEmpleadosActivos(),
            calculoPlanillaService.getPorQuincena(quincenaId),
        ])
            .then(([emps, regs]) => { setEmpleados(emps); setRegistros(regs); })
            .catch((err: unknown) => Logger.error('Error al cargar resumen por departamento', { quincenaId }, err))
            .finally(() => setIsLoading(false));
    }, [quincenaId]);

    useEffect(() => {
        if (!quincenaAnteriorId) { setRegistrosAnterior([]); return; }
        calculoPlanillaService.getPorQuincena(quincenaAnteriorId)
            .then(setRegistrosAnterior)
            .catch((err: unknown) => Logger.error('Error al cargar cálculo de la quincena anterior', { quincenaId: quincenaAnteriorId }, err));
    }, [quincenaAnteriorId]);

    const departamentos = useMemo(() => agruparPorDepartamento(empleados, registros), [empleados, registros]);
    const departamentosAnterior = useMemo(() => agruparPorDepartamento(empleados, registrosAnterior), [empleados, registrosAnterior]);

    const variaciones = useMemo(() => {
        const netoAnteriorPorDepto = new Map(departamentosAnterior.filter((d) => d.conCalculo).map((d) => [d.departamento, d.neto]));
        return departamentos
            .filter((d) => d.conCalculo && netoAnteriorPorDepto.has(d.departamento) && (netoAnteriorPorDepto.get(d.departamento) ?? 0) > 0)
            .map((d) => {
                const netoAnterior = netoAnteriorPorDepto.get(d.departamento)!;
                const variacion = (d.neto - netoAnterior) / netoAnterior;
                return { departamento: d.departamento, variacion };
            })
            .filter((v) => Math.abs(v.variacion) > UMBRAL_VARIACION)
            .sort((a, b) => Math.abs(b.variacion) - Math.abs(a.variacion));
    }, [departamentos, departamentosAnterior]);

    const totalEmpleados = departamentos.reduce((sum, d) => sum + d.count, 0);
    const totales = departamentos.reduce((acc, d) => ({
        ingresos: acc.ingresos + d.ingresos, deducciones: acc.deducciones + d.deducciones, neto: acc.neto + d.neto,
    }), { ingresos: 0, deducciones: 0, neto: 0 });
    const algunCalculado = departamentos.some((d) => d.conCalculo);

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
            <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <Building2 size={14} className="text-primary" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('quincenas.section_resumen_departamentos')}</h3>
            </div>

            {isLoading ? (
                <div className="h-24 bg-surface rounded animate-pulse" />
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="text-[10px] font-bold uppercase tracking-widest text-text-secondary border-b border-border/50">
                                <th className="py-2 pr-2">{t('quincenas.col_departamento')}</th>
                                <th className="py-2 px-2 text-right">{t('quincenas.empleados_label')}</th>
                                <th className="py-2 px-2 text-right">{t('quincenas.col_ingresos')}</th>
                                <th className="py-2 px-2 text-right">{t('quincenas.col_deducciones')}</th>
                                <th className="py-2 pl-2 text-right">{t('quincenas.col_neto')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {departamentos.map((d) => (
                                <tr key={d.departamento ?? '__sin_departamento__'} className="border-b border-border/30 last:border-b-0">
                                    <td className="py-2 pr-2 font-medium text-heading">{d.departamento ?? t('quincenas.departamento_sin_asignar')}</td>
                                    <td className="py-2 px-2 text-right text-heading">{d.count}</td>
                                    <td className={`py-2 px-2 text-right ${d.conCalculo ? 'text-heading' : 'text-text-secondary/40'}`}>{d.conCalculo ? `$${d.ingresos.toFixed(2)}` : '—'}</td>
                                    <td className={`py-2 px-2 text-right ${d.conCalculo ? 'text-error' : 'text-text-secondary/40'}`}>{d.conCalculo ? `$${d.deducciones.toFixed(2)}` : '—'}</td>
                                    <td className={`py-2 pl-2 text-right font-bold ${d.conCalculo ? 'text-heading' : 'text-text-secondary/40'}`}>{d.conCalculo ? `$${d.neto.toFixed(2)}` : '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                        <tfoot>
                            <tr className="border-t-2 border-border font-bold">
                                <td className="py-2 pr-2 text-heading">{t('quincenas.fila_total')}</td>
                                <td className="py-2 px-2 text-right text-heading">{totalEmpleados}</td>
                                <td className={`py-2 px-2 text-right ${algunCalculado ? 'text-heading' : 'text-text-secondary/40'}`}>{algunCalculado ? `$${totales.ingresos.toFixed(2)}` : '—'}</td>
                                <td className={`py-2 px-2 text-right ${algunCalculado ? 'text-error' : 'text-text-secondary/40'}`}>{algunCalculado ? `$${totales.deducciones.toFixed(2)}` : '—'}</td>
                                <td className={`py-2 pl-2 text-right ${algunCalculado ? 'text-heading' : 'text-text-secondary/40'}`}>{algunCalculado ? `$${totales.neto.toFixed(2)}` : '—'}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            )}

            {!algunCalculado && (
                <p className="text-[11px] text-text-secondary italic">{t('quincenas.resumen_departamentos_disclaimer')}</p>
            )}

            <div className="pt-3 border-t border-border/50">
                <button
                    onClick={() => setVerVariaciones((v) => !v)}
                    className="w-full flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-text-secondary"
                >
                    {t('quincenas.section_variaciones')}
                    <ChevronDown size={14} className={`transition-transform ${verVariaciones ? 'rotate-180' : ''}`} />
                </button>
                {verVariaciones && (
                    !quincenaAnteriorId || !algunCalculado ? (
                        <p className="text-caption text-text-secondary italic mt-2">{t('quincenas.variaciones_disclaimer')}</p>
                    ) : variaciones.length === 0 ? (
                        <p className="text-caption text-text-secondary italic mt-2">{t('quincenas.variaciones_sin_destacadas')}</p>
                    ) : (
                        <ul className="flex flex-col gap-1.5 mt-2">
                            {variaciones.map((v) => (
                                <li key={v.departamento ?? '__sin_departamento__'} className="flex items-center justify-between text-caption">
                                    <span className="text-heading font-medium">{v.departamento ?? t('quincenas.departamento_sin_asignar')}</span>
                                    <span className={`flex items-center gap-1 font-bold ${v.variacion > 0 ? 'text-error' : 'text-primary'}`}>
                                        {v.variacion > 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                                        {(v.variacion * 100).toFixed(1)}%
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )
                )}
            </div>
        </section>
    );
};
