import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { vacacionesService } from '../../../../services/vacacionesService';
import { Logger } from '../../../../utils/logger';

interface VacacionesResumenSectionProps {
    empleadoId: string;
    fechaIngreso: string;
}

const DIAS_ACUMULADOS_POR_ANIO = 15; // Código de Trabajo Art. 177, confirmado por Imporfrut (IMPL-7): sin política interna distinta

interface Antiguedad {
    label: string;
    aniosCompletos: number;
    mesesEnAnioActual: number;
    vencimiento: Date;
}

function calcularAntiguedad(fechaIngreso: string, hoy: Date = new Date()): Antiguedad | null {
    const ingreso = new Date(`${fechaIngreso}T00:00:00`);
    let anios = hoy.getFullYear() - ingreso.getFullYear();
    let meses = hoy.getMonth() - ingreso.getMonth();
    if (hoy.getDate() < ingreso.getDate()) meses--;
    if (meses < 0) { anios--; meses += 12; }
    if (anios < 0) return null;

    // Fin del año de servicio en curso (próximo aniversario de ingreso) — usado como
    // "vencimiento" a falta de una política de caducidad legal explícita (IMPL-7).
    // Bugfix (auditoría): para un ingreso el 29 de febrero, `setFullYear` en un año no
    // bisiesto desborda nativamente a 1° de marzo en vez de clampear a 28 de febrero.
    const vencimiento = new Date(ingreso.getFullYear() + anios + 1, ingreso.getMonth(), ingreso.getDate());
    if (vencimiento.getMonth() !== ingreso.getMonth()) vencimiento.setDate(0);

    const partes = [];
    if (anios > 0) partes.push(`${anios} ${anios === 1 ? 'año' : 'años'}`);
    partes.push(`${meses} ${meses === 1 ? 'mes' : 'meses'}`);

    return { label: partes.join(', '), aniosCompletos: anios, mesesEnAnioActual: meses, vencimiento };
}

/**
 * Resumen de Vacaciones (US-EMP-05 / IMPL-7). "Gozados" es dato real desde Vacaciones
 * (IMPL-63): se suma `dias` de `planilla_vacaciones` donde NOT no_gozada (no_gozada=true
 * significa que se pagó en vez de descansarse, ver calcular_planilla_empleado). "Acumulados"
 * = 15 días/año de servicio (proporcional al año en curso según meses de antigüedad).
 * "Pendientes" = Acumulados - Gozados. De solo lectura (CA2): el registro real de vacaciones
 * se gestiona desde el módulo de Vacaciones.
 */
export const VacacionesResumenSection: React.FC<VacacionesResumenSectionProps> = ({ empleadoId, fechaIngreso }) => {
    const { t } = useTranslation();
    const [diasGozados, setDiasGozados] = useState<number | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelado = false;
        setIsLoading(true);
        vacacionesService.getPorEmpleado(empleadoId)
            .then((vacaciones) => {
                if (cancelado) return;
                const total = vacaciones.filter((v) => !v.no_gozada).reduce((sum, v) => sum + v.dias, 0);
                setDiasGozados(total);
            })
            .catch((err: unknown) => Logger.error('Error al cargar resumen de vacaciones', { empleadoId }, err))
            .finally(() => { if (!cancelado) setIsLoading(false); });
        return () => { cancelado = true; };
    }, [empleadoId]);

    const antiguedad = calcularAntiguedad(fechaIngreso);
    const acumulados = antiguedad
        ? Math.round(DIAS_ACUMULADOS_POR_ANIO * (antiguedad.aniosCompletos + antiguedad.mesesEnAnioActual / 12) * 10) / 10
        : null;
    // Bugfix real IMPL-179 (UAT) — el Math.max(0, ...) anterior truncaba a 0 un sobregiro real
    // (ej. Gozados 33 > Acumulados 22.5), ocultando que la empleada quedó con saldo negativo.
    // Ahora se muestra el valor con signo; la UI resalta en rojo cuando queda negativo.
    const pendientes = acumulados !== null && diasGozados !== null
        ? Math.round((acumulados - diasGozados) * 10) / 10
        : null;

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
            <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <CalendarDays size={14} className="text-primary" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_vacaciones')}</h3>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-md">
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.vacaciones_antiguedad')}</p>
                    <p className="text-body font-bold mt-xs text-heading">{antiguedad?.label ?? '—'}</p>
                </div>
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.vacaciones_acumulados')}</p>
                    <p className="text-body font-bold mt-xs text-heading">
                        {acumulados === null ? '—' : t('empleados.vacaciones_dias_count', { count: acumulados })}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.vacaciones_gozados')}</p>
                    <p className="text-body font-bold mt-xs text-heading">
                        {isLoading ? '…' : t('empleados.vacaciones_dias_count', { count: diasGozados ?? 0 })}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.vacaciones_pendientes')}</p>
                    <p className={`text-body font-bold mt-xs ${pendientes !== null && pendientes < 0 ? 'text-error' : 'text-heading'}`} title={pendientes !== null && pendientes < 0 ? t('empleados.vacaciones_pendientes_sobregiro') : undefined}>
                        {isLoading ? '…' : pendientes === null ? '—' : t('empleados.vacaciones_dias_count', { count: pendientes })}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.vacaciones_vencimiento')}</p>
                    <p className="text-body font-bold mt-xs text-heading">
                        {antiguedad ? antiguedad.vencimiento.toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                    </p>
                </div>
            </div>
        </section>
    );
};
