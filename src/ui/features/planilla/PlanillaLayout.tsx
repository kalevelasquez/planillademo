import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useOutletContext } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { Calendar, ChevronDown } from 'lucide-react';
import { useQuincenasStore } from '../../../store/quincenasStore';
import type { Quincena } from '../../../services/quincenasService';
import { encontrarQuincenaActiva } from '../../../utils/quincenaUtils';
import { PageLoader } from '../../components/PageLoader';

interface RouteMeta {
    path: string;
    titleKey: string;
    descKey?: string;
    showQuincena?: boolean;
}

/**
 * Título/descripción por ruta (US-UX-02, prototipo del PM). Reusa las mismas claves i18n
 * que cada vista ya usaba en su propio PageHeader — ver docs/product/planilla-contexto.md.
 */
const ROUTES: RouteMeta[] = [
    { path: '/planilla', titleKey: 'quincenas.home_title', showQuincena: true },
    { path: '/planilla/empleados', titleKey: 'empleados.header_title', descKey: 'empleados.header_desc', showQuincena: true },
    { path: '/planilla/historial', titleKey: 'quincenas.historial_title', descKey: 'quincenas.historial_desc' },
    { path: '/planilla/horas-extras', titleKey: 'horasExtras.dashboard_title', descKey: 'horasExtras.dashboard_desc', showQuincena: true },
    { path: '/planilla/viaticos', titleKey: 'viaticos.dashboard_title', descKey: 'viaticos.dashboard_desc', showQuincena: true },
    { path: '/planilla/incapacidades', titleKey: 'incapacidades.dashboard_title', descKey: 'incapacidades.dashboard_desc', showQuincena: true },
    // El selector filtra qué quincena se está VIENDO (indicadores + estado de eventos por fila).
    // "Procesar Cuotas"/"Suspender" siguen operando siempre sobre la quincena activa real,
    // derivada independientemente adentro de la vista — nunca sobre la que se esté mirando acá.
    { path: '/planilla/anticipos', titleKey: 'anticipos.dashboard_title', descKey: 'anticipos.dashboard_desc', showQuincena: true },
    { path: '/planilla/descuentos', titleKey: 'descuentos.dashboard_title', descKey: 'descuentos.dashboard_desc', showQuincena: true },
    { path: '/planilla/vacaciones', titleKey: 'vacaciones.dashboard_title', descKey: 'vacaciones.dashboard_desc', showQuincena: true },
    { path: '/planilla/bonificaciones', titleKey: 'bonificaciones.dashboard_title', descKey: 'bonificaciones.dashboard_desc', showQuincena: true },
    { path: '/planilla/otros-ingresos', titleKey: 'otrosIngresos.dashboard_title', descKey: 'otrosIngresos.dashboard_desc', showQuincena: true },
    { path: '/planilla/calculo', titleKey: 'calculoPlanilla.dashboard_title', descKey: 'calculoPlanilla.dashboard_desc', showQuincena: true },
    { path: '/planilla/exportaciones', titleKey: 'exportaciones.dashboard_title', descKey: 'exportaciones.dashboard_desc', showQuincena: true },
    { path: '/planilla/reportes', titleKey: 'reportes.dashboard_title', descKey: 'reportes.dashboard_desc', showQuincena: true },
    { path: '/planilla/configuracion', titleKey: 'quincenas.config_planilla_title', descKey: 'quincenas.config_planilla_desc' },
    { path: '/planilla/go-live', titleKey: 'goLive.title', descKey: 'goLive.desc' },
    { path: '/planilla/permisos', titleKey: 'permisosMatrix.title', descKey: 'permisosMatrix.desc' },
    { path: '/planilla/asistente', titleKey: 'asistenteIa.title', descKey: 'asistenteIa.desc' },
];

export interface PlanillaOutletContext {
    quincenaId: string;
    quincena: Quincena | null;
    quincenaLabel: string;
    quincenaCerrada: boolean;
}

export function usePlanillaContext() {
    return useOutletContext<PlanillaOutletContext>();
}

/**
 * Layout compartido de las subpáginas "módulo" de /planilla (US-UX-02). Reemplaza el
 * passthrough anterior: ahora arma el título+selector de quincena que antes cada vista
 * duplicaba por su cuenta, siguiendo el prototipo del PM (título+selector a la misma
 * altura, en una sola fila). El submenú de navegación entre módulos se mantiene fuera de
 * este layout — sigue viviendo en el sidebar principal (US-QNA-00/IMPL-119).
 */
export const PlanillaLayout: React.FC = () => {
    const { t } = useTranslation();
    const location = useLocation();
    const { quincenas, fetchQuincenas, quincenaId, setQuincenaId } = useQuincenasStore(
        useShallow((state) => ({
            quincenas: state.quincenas,
            fetchQuincenas: state.fetchQuincenas,
            quincenaId: state.quincenaSeleccionadaId,
            setQuincenaId: state.setQuincenaSeleccionadaId,
        }))
    );
    const [dropdownOpen, setDropdownOpen] = useState(false);

    useEffect(() => {
        fetchQuincenas();
    }, [fetchQuincenas]);

    const quincenasOrdenadas = useMemo(
        () => [...quincenas].sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio)),
        [quincenas]
    );

    useEffect(() => {
        if (quincenaId || quincenasOrdenadas.length === 0) return;
        const activa = encontrarQuincenaActiva(quincenasOrdenadas) ?? quincenasOrdenadas[0];
        setQuincenaId(activa.id);
    }, [quincenaId, quincenasOrdenadas]);

    const quincena = quincenasOrdenadas.find((q) => q.id === quincenaId) ?? null;
    const quincenaCerrada = quincena?.estado === 'aprobada_cerrada';

    // Las 9 rutas de catálogo bajo /planilla/configuracion/* comparten este título genérico —
    // el nombre específico del catálogo (Feriados, Bancos, etc.) lo muestra ConfiguracionLayout
    // dentro de su propio panel (sidebar + contenido), evitando un encabezado duplicado.
    const meta = ROUTES.find((r) => r.path === location.pathname)
        ?? (location.pathname.startsWith('/planilla/configuracion/') ? ROUTES.find((r) => r.path === '/planilla/configuracion') : undefined);
    const title = t((meta?.titleKey ?? 'quincenas.home_title') as any);
    const description = meta?.descKey ? t(meta.descKey as any) : undefined;
    const showQuincena = Boolean(meta?.showQuincena) && quincenasOrdenadas.length > 0;

    const outletContext = useMemo<PlanillaOutletContext>(
        () => ({ quincenaId, quincena, quincenaLabel: quincena?.etiqueta_estandar ?? '', quincenaCerrada }),
        [quincenaId, quincena, quincenaCerrada]
    );

    return (
        <div className="flex flex-col gap-0 min-h-full">
            {/* Defecto real IMPL-176 (UAT) — este header sticky no tenía `print:static`, a
                diferencia del resto de bloques sticky/fixed del proyecto (MainLayout.tsx,
                toolbar de CalculoPlanillaView.tsx) que sí siguen ese patrón. `position: sticky`
                se recalcula contra CADA página al imprimir/exportar a PDF (window.print()), así
                que Chromium reinserta esta tarjeta flotando encima de filas de la tabla en el
                punto donde corta la página — no un simple "aparece dos veces". Se usa
                `print:static` y no `print:hidden` porque este bloque sí trae contenido útil
                para el PDF exportado (quincena/título), a diferencia de la sidebar/toolbar que
                son puro chrome de pantalla sin valor informativo. */}
            <div className="sticky top-0 z-20 print:static bg-white border-b border-border shadow-sm">
                <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-sm">
                    <div className="flex flex-col">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                            {t('quincenas.breadcrumb_modulo')}
                        </p>
                        <h1 className="text-h3 font-bold text-heading leading-tight">{title}</h1>
                        {description && <p className="text-sm text-text-secondary mt-0.5">{description}</p>}
                    </div>

                    {showQuincena && (
                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setDropdownOpen((o) => !o)}
                                className="flex items-center gap-sm px-md py-sm bg-primary-light border border-primary/30 rounded-lg text-primary font-semibold text-body hover:bg-primary/10 transition-colors min-w-[240px] justify-between"
                            >
                                <div className="flex items-center gap-sm">
                                    <Calendar size={16} className="shrink-0" />
                                    <span className="truncate">{quincena?.etiqueta_estandar ?? ''}</span>
                                </div>
                                <ChevronDown size={16} className={`shrink-0 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {dropdownOpen && (
                                <>
                                    {/* z-30 — tiene que quedar por encima de cualquier barra sticky con z-20
                                        que pueda tener la página de abajo (ej. filtros de EmpleadosListView.tsx),
                                        que empataba con el z-20 de este dropdown y, al empatar, se pintaba
                                        encima por venir después en el DOM. */}
                                    <div className="fixed inset-0 z-20" onClick={() => setDropdownOpen(false)} />
                                    <div className="absolute right-0 top-full mt-xs z-30 bg-white border border-border rounded-lg shadow-modals w-[260px] py-xs overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                                        <p className="px-md pt-xs pb-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary border-b border-border mb-xs">
                                            {t('quincenas.selector_titulo')}
                                        </p>
                                        {quincenasOrdenadas.map((q) => (
                                            <button
                                                key={q.id}
                                                type="button"
                                                onClick={() => { setQuincenaId(q.id); setDropdownOpen(false); }}
                                                className={`w-full text-left px-md py-sm text-body transition-colors flex items-center gap-sm ${q.id === quincenaId ? 'bg-primary-light text-primary font-semibold' : 'text-text-secondary hover:bg-surface hover:text-heading'}`}
                                            >
                                                <Calendar size={14} className="shrink-0 opacity-60" />
                                                {q.etiqueta_estandar}
                                            </button>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 py-lg">
                {/* IMPL-155 — cada vista de Planilla se carga con React.lazy (ver App.tsx); sin
                    este Suspense propio, la navegación entre módulos quedaba en blanco/gris
                    hasta que el chunk terminaba de bajar, sin ningún indicador. */}
                <Suspense fallback={<PageLoader label={t('common.loading')} fullPage />}>
                    <Outlet context={outletContext} />
                </Suspense>
            </div>
        </div>
    );
};
