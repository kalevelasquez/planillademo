import React from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface ComparativoQuincenaSectionProps {
    empleadosActivos: number;
    totalNetoActual: number | null;
    totalNetoAnterior: number | null;
    totalHorasExtraActual: number | null;
    totalHorasExtraAnterior: number | null;
}

function fmtMonto(n: number | null): string {
    if (n === null) return '—';
    return `$${n.toLocaleString('es-SV', { minimumFractionDigits: 2 })}`;
}

/** % de variación vs. anterior, redondeado — solo cuando ambos valores existen y anterior > 0. */
function VariacionPct({ actual, anterior }: { actual: number | null; anterior: number | null }) {
    if (actual === null || anterior === null || anterior <= 0) return null;
    const diff = actual - anterior;
    const pct = Math.round((Math.abs(diff) / anterior) * 100);
    // Redondeado a 0%, no exactamente 0 — un diff sub-centavo por drift de punto flotante al
    // sumar muchos neto_a_pagar no debe disparar la flecha direccional coloreada (7ma pasada
    // QA, hallazgo cosmético #6).
    if (pct === 0) {
        return (
            <span className="inline-flex items-center gap-0.5 text-white/50">
                <Minus size={11} /> 0%
            </span>
        );
    }
    return (
        <span className={`inline-flex items-center gap-0.5 font-semibold ${diff > 0 ? 'text-green-300' : 'text-red-300'}`}>
            {diff > 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {diff > 0 ? '+' : '-'}{pct}%
        </span>
    );
}

/**
 * Comparativo vs. quincena anterior (US-QNA-00 CA2) — RESUELTO (revisión épica por épica,
 * post-IMPL-85/IMPL-20): Total Neto y Total Horas Extra ahora son reales, sumados desde
 * `planilla_calculo_empleado` para la quincena activa y la inmediatamente anterior del mismo
 * tipo (`encontrarQuincenaAnterior`, `quincenaUtils.ts`). "—" cuando el cálculo todavía no
 * corrió para esa quincena, o cuando no existe una quincena anterior del mismo tipo. El
 * comparativo histórico de "# empleados" sigue sin snapshot por quincena — se deja como
 * proxy de activos totales, sin comparación (ver gap en planilla-contexto.md). Se renderiza
 * dentro de la tarjeta principal (fondo navy), igual que el prototipo — no es una tarjeta
 * propia.
 */
export const ComparativoQuincenaSection: React.FC<ComparativoQuincenaSectionProps> = ({
    empleadosActivos, totalNetoActual, totalNetoAnterior, totalHorasExtraActual, totalHorasExtraAnterior,
}) => {
    const { t } = useTranslation();

    return (
        <div className="pt-3 border-t border-white/20 flex flex-col gap-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">{t('quincenas.section_comparativo')}</p>
            <div className="flex flex-wrap gap-xl">
                <div>
                    <p className="text-[10px] text-white/60 uppercase tracking-widest">{t('quincenas.comparativo_total_neto')}</p>
                    <p className="font-bold text-[15px] text-white mt-0.5">{fmtMonto(totalNetoActual)}</p>
                    <p className="text-[11px] text-white/50 flex items-center gap-1 mt-0.5">
                        <VariacionPct actual={totalNetoActual} anterior={totalNetoAnterior} />
                        {t('quincenas.comparativo_vs_anterior', { monto: fmtMonto(totalNetoAnterior) })}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] text-white/60 uppercase tracking-widest">{t('quincenas.comparativo_horas_extra')}</p>
                    <p className="font-bold text-[15px] text-white mt-0.5">{fmtMonto(totalHorasExtraActual)}</p>
                    <p className="text-[11px] text-white/50 flex items-center gap-1 mt-0.5">
                        <VariacionPct actual={totalHorasExtraActual} anterior={totalHorasExtraAnterior} />
                        {t('quincenas.comparativo_vs_anterior', { monto: fmtMonto(totalHorasExtraAnterior) })}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] text-white/60 uppercase tracking-widest">{t('quincenas.comparativo_empleados')}</p>
                    <p className="font-bold text-[15px] text-white mt-0.5">{empleadosActivos}</p>
                </div>
            </div>
            <p className="text-[11px] text-white/50 italic">{t('quincenas.comparativo_disclaimer')}</p>
        </div>
    );
};
