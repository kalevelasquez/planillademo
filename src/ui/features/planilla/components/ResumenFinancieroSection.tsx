import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Wallet } from 'lucide-react';

import { calculoPlanillaService, type CalculoEmpleado } from '../../../../services/calculoPlanillaService';
import { Logger } from '../../../../utils/logger';

interface ResumenFinancieroSectionProps {
    quincenaId: string;
}

/**
 * Resumen Financiero (US-QNA-08 CA2). Desde IMPL-89 (US-CALC-03) consume el snapshot real ya
 * persistido en `planilla_calculo_empleado` — deja de ser placeholder. Si la quincena todavía no
 * fue calculada (US-CALC-04/IMPL-90), muestra el mismo disclaimer de antes en vez de $0 (que
 * induciría a error, "$0" no es lo mismo que "todavía no calculado").
 */
export const ResumenFinancieroSection: React.FC<ResumenFinancieroSectionProps> = ({ quincenaId }) => {
    const { t } = useTranslation();
    const [registros, setRegistros] = useState<CalculoEmpleado[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        calculoPlanillaService.getPorQuincena(quincenaId)
            .then(setRegistros)
            .catch((err: unknown) => Logger.error('Error al cargar resumen financiero', { quincenaId }, err))
            .finally(() => setIsLoading(false));
    }, [quincenaId]);

    // IMPL-178 (defecto UAT) — "Ingresos" sumaba una lista fija de 4 campos que no incluía
    // Vacaciones ni Otros Ingresos, aunque el motor SÍ los suma dentro de `neto_a_pagar`
    // (v_total_gravable/v_total_no_gravable en calcular_planilla_empleado) — la relación
    // Ingresos − Deducciones = Neto se rompía en pantalla por $65.01 en un caso real de UAT.
    // Deducciones ahora suma `ipsfa_empleado` junto con AFP (IMPL-87): son mutuamente excluyentes
    // por empleado (un empleado cotiza AFP O IPSFA, nunca ambos) y el motor ya resta ambos del
    // neto — sin esto, un futuro empleado con afiliación IPSFA reproduciría el mismo defecto.
    //
    // También se suman `vacaciones_bono10_base`/`otros_ingresos_bono10_base`/
    // `incapacidad_bono10_base` (bug real de plata encontrado al investigar el gap de arriba, ver
    // migración `20260925110000_...sql`): la porción "bono10" de vacaciones no gozadas,
    // bonificaciones y otros ingresos con tratamiento especial de Renta 10% nunca sumaba al Neto
    // en el motor — el empleado pagaba el impuesto sin recibir la plata. Ya corregido en el motor
    // (esas bases ahora entran a `v_total_no_gravable`), así que el frontend también tiene que
    // sumarlas para no volver a romper la igualdad Ingresos−Deducciones=Neto.
    const totales = useMemo(() => {
        const sum = (fn: (r: CalculoEmpleado) => number) => registros.reduce((s, r) => s + fn(r), 0);
        return {
            sueldos_base: sum((r) => r.sueldo_proporcional),
            horas_extras: sum((r) => r.horas_extras_monto),
            viaticos: sum((r) => r.viaticos_monto),
            vacaciones: sum((r) => r.vacaciones_monto + r.vacaciones_bono10_base),
            bonificaciones: sum((r) => r.bonificaciones_monto),
            otros_ingresos: sum((r) => r.otros_ingresos_gravables + r.otros_ingresos_no_gravables + r.otros_ingresos_bono10_base + r.incapacidad_bono10_base),
            isss: sum((r) => r.isss_empleado),
            afp: sum((r) => r.afp_empleado + r.ipsfa_empleado),
            renta_isr: sum((r) => r.renta_isr + r.renta_bono10),
            descuentos_anticipos: sum((r) => r.descuentos_no_obligatorios_aplicado),
            neto: sum((r) => r.neto_a_pagar),
        };
    }, [registros]);

    const calculado = !isLoading && registros.length > 0;

    const FILAS: { key: Exclude<keyof typeof totales, 'neto'>; tipo: 'ingreso' | 'deduccion' }[] = [
        { key: 'sueldos_base', tipo: 'ingreso' },
        { key: 'horas_extras', tipo: 'ingreso' },
        { key: 'viaticos', tipo: 'ingreso' },
        { key: 'vacaciones', tipo: 'ingreso' },
        { key: 'bonificaciones', tipo: 'ingreso' },
        { key: 'otros_ingresos', tipo: 'ingreso' },
        { key: 'isss', tipo: 'deduccion' },
        { key: 'afp', tipo: 'deduccion' },
        { key: 'renta_isr', tipo: 'deduccion' },
        { key: 'descuentos_anticipos', tipo: 'deduccion' },
    ];

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
            <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <Wallet size={14} className="text-primary" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('quincenas.section_resumen_financiero')}</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
                {FILAS.map((fila) => (
                    <div key={fila.key} className="flex items-center justify-between text-sm border-b border-border/30 pb-2">
                        <span className="text-text-secondary">{t(`quincenas.financiero_${fila.key}`)}</span>
                        <span className={`font-semibold ${calculado ? (fila.tipo === 'deduccion' ? 'text-error' : 'text-heading') : (fila.tipo === 'deduccion' ? 'text-error/50' : 'text-text-secondary/40')}`}>
                            {calculado ? `$${totales[fila.key].toFixed(2)}` : '—'}
                        </span>
                    </div>
                ))}
            </div>

            <div className="border-t-2 border-primary/20 bg-primary-light/30 rounded-xl p-md flex items-center justify-between">
                <span className="text-body font-semibold text-heading">{t('quincenas.financiero_neto_total')}</span>
                <span className={`text-h3 font-bold ${calculado ? 'text-primary' : 'text-primary/50'}`}>{calculado ? `$${totales.neto.toFixed(2)}` : '—'}</span>
            </div>

            {!calculado && (
                <p className="text-[11px] text-text-secondary italic">{t('quincenas.resumen_financiero_disclaimer')}</p>
            )}
        </section>
    );
};
