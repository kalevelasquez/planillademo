import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, AlertTriangle, Circle } from 'lucide-react';

type EstadoCriterio = 'ok' | 'alerta' | 'pendiente';

type CriterioId = 'ca1' | 'ca2' | 'ca3' | 'ca4' | 'ca5' | 'ca6' | 'ca7' | 'ca8' | 'ca9' | 'ca10' | 'ca11' | 'ca12' | 'ca13' | 'ca14';

type NotaKey = 'goLive.nota_ca8' | 'goLive.nota_ca9' | 'goLive.nota_ca12';

interface CriterioGoLive {
    id: CriterioId;
    estado: EstadoCriterio;
    notaKey?: NotaKey;
}

/**
 * Checklist de Go-Live / UAT (US-CIE-03 / IMPL-106). Los 14 criterios son el texto LITERAL de
 * cada CA de Jira (revisión historia por historia corrigió una versión anterior que resumía
 * por épica en vez de traducir los CA reales). Re-verificado 2026-10-15: CA1 (los 3 casos DRN
 * ahora tienen datos reales confirmados por Imporfrut, `calculoPlanillaUtils.test.ts` pasa sin
 * placeholders) y CA13/CA14 (Instituciones Financieras + Cuotas Patronales, IMPL-106) pasaron a
 * 'ok' — estaban marcados pendiente/alerta por un hallazgo anterior que ya fue resuelto con
 * código y datos reales después. CA9 sigue 'pendiente' (precisión de IA sin pruebas reales),
 * CA8/CA12 siguen en 'alerta' (bloqueados por validación/confirmación externa de Imporfrut, no
 * por código faltante) — ver planilla-contexto.md.
 */
const CRITERIOS: CriterioGoLive[] = [
    { id: 'ca1', estado: 'ok' },
    { id: 'ca2', estado: 'ok' },
    { id: 'ca3', estado: 'ok' },
    { id: 'ca4', estado: 'ok' },
    { id: 'ca5', estado: 'ok' },
    { id: 'ca6', estado: 'ok' },
    { id: 'ca7', estado: 'ok' },
    { id: 'ca8', estado: 'alerta', notaKey: 'goLive.nota_ca8' },
    { id: 'ca9', estado: 'pendiente', notaKey: 'goLive.nota_ca9' },
    { id: 'ca10', estado: 'ok' },
    { id: 'ca11', estado: 'ok' },
    { id: 'ca12', estado: 'alerta', notaKey: 'goLive.nota_ca12' },
    { id: 'ca13', estado: 'ok' },
    { id: 'ca14', estado: 'ok' },
];

const ESTADO_CONFIG: Record<EstadoCriterio, { icon: typeof CheckCircle2; className: string }> = {
    ok: { icon: CheckCircle2, className: 'text-emerald-600' },
    alerta: { icon: AlertTriangle, className: 'text-amber-600' },
    pendiente: { icon: Circle, className: 'text-text-secondary/40' },
};

export const GoLiveChecklistView: React.FC = () => {
    const { t } = useTranslation();

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <div className="bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-1">
                {CRITERIOS.map((c) => {
                    const config = ESTADO_CONFIG[c.estado];
                    const Icon = config.icon;
                    return (
                        <div key={c.id} className="flex items-start gap-3 py-sm border-b border-border/30 last:border-b-0">
                            <Icon size={18} className={`${config.className} shrink-0 mt-0.5`} />
                            <div>
                                <p className="text-body font-medium text-heading">{t(`goLive.criterio_${c.id}`)}</p>
                                {c.notaKey && (
                                    <p className="text-[11px] text-amber-700 mt-0.5">{t(c.notaKey)}</p>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <p className="text-caption text-text-secondary">{t('goLive.disclaimer')}</p>
        </div>
    );
};
