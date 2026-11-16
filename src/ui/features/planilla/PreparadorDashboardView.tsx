import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { CalendarClock, Users, Plus, Send } from 'lucide-react';

import { useQuincenasStore } from '../../../store/quincenasStore';
import { usePlanillaEmpleadosStore } from '../../../store/planillaEmpleadosStore';
import type { ModuloPlanilla } from '../../../services/modulosQuincenaService';
import { calculoPlanillaService } from '../../../services/calculoPlanillaService';
import { quincenasService, getEstadoVisual } from '../../../services/quincenasService';
import { TIPO_QUINCENA_LABEL, encontrarQuincenaAnterior, encontrarQuincenaActiva, resolverEmpleadosCount } from '../../../utils/quincenaUtils';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { EstadoQuincenaBadge } from './components/EstadoQuincenaBadge';
import { ComparativoQuincenaSection } from './components/ComparativoQuincenaSection';
import { ModulosChecklistSection } from './components/ModulosChecklistSection';
import { ConfirmModal } from '../../components/ConfirmModal';
import { useToast } from '../../../context/ToastContext';
import { Logger } from '../../../utils/logger';

function fmtFecha(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface PreparadorDashboardViewProps {
    /** Quincena elegida en el selector compartido del header (PlanillaLayout) — IMPL-156 CA4:
     * "Enviar a Aprobación" opera sobre esta misma selección (mientras esté `en_proceso`), no
     * sobre una "activa" inferida por separado. */
    quincenaSeleccionadaId?: string;
    /** El modal vive en PlanillaHomeView (padre común de esta vista y del tab switcher
     * Preparar/Aprobar) — acá solo se dispara. */
    onNuevaQuincena: () => void;
    /** false cuando PlanillaHomeView ya puso el botón junto al selector Preparar/Aprobar
     * (usuario con ambos permisos) — evita duplicarlo acá. Default true (un solo permiso,
     * sin selector de pestañas, el botón va en su propia fila como siempre). */
    mostrarBotonNuevaQuincena?: boolean;
}

/**
 * Vista de Preparador: Quincena Activa (US-QNA-00 / IMPL-10). IMPL-156 (US-QNA-10) ya resolvió
 * la ambigüedad de "varias quincenas abiertas simultáneas" que este comentario documentaba
 * como pregunta abierta: solo puede haber una `en_proceso` por tipo (CA1, garantizado a nivel
 * de datos), y las acciones reales operan sobre la explícitamente seleccionada (CA4), nunca
 * sobre `encontrarQuincenaActiva` — esa función solo se usa acá como valor por defecto inicial.
 */
export const PreparadorDashboardView: React.FC<PreparadorDashboardViewProps> = ({ quincenaSeleccionadaId, onNuevaQuincena, mostrarBotonNuevaQuincena = true }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();

    const { quincenas, isLoading, fetchQuincenas } = useQuincenasStore(
        useShallow((state) => ({ quincenas: state.quincenas, isLoading: state.isLoading, fetchQuincenas: state.fetchQuincenas }))
    );
    const { indicadores, fetchIndicadores } = usePlanillaEmpleadosStore(
        useShallow((state) => ({ indicadores: state.indicadores, fetchIndicadores: state.fetchIndicadores }))
    );

    useEffect(() => {
        fetchQuincenas();
        fetchIndicadores();
    }, [fetchQuincenas, fetchIndicadores]);

    // IMPL-156 (US-QNA-10) CA4 — "Enviar a Aprobación" ahora opera SIEMPRE sobre la quincena
    // explícitamente elegida en el selector compartido (`quincenaMostrada`, vía
    // `quincenaSeleccionadaId` propagado desde `usePlanillaContext()`), nunca sobre una "activa"
    // inferida por separado — ese patrón era la causa raíz de IMPL-150/152 en Anticipos/
    // Descuentos. `quincenaActivaFallback` solo cubre el instante inicial antes de que
    // `quincenaSeleccionadaId` tenga un valor.
    const quincenaActivaFallback = useMemo(() => encontrarQuincenaActiva(quincenas), [quincenas]);
    const quincenaMostrada = useMemo(
        () => (quincenaSeleccionadaId ? quincenas.find((q) => q.id === quincenaSeleccionadaId) : undefined) ?? quincenaActivaFallback,
        [quincenas, quincenaSeleccionadaId, quincenaActivaFallback]
    );
    const checklistReadOnly = quincenaMostrada ? quincenaMostrada.estado !== 'en_proceso' : true;
    // CA2 (comparativo) — RESUELTO (revisión épica por épica, post-IMPL-85/IMPL-20).
    const quincenaAnterior = useMemo(
        () => (quincenaMostrada ? encontrarQuincenaAnterior(quincenas, quincenaMostrada) : null),
        [quincenas, quincenaMostrada]
    );

    const [checklistCompleto, setChecklistCompleto] = useState(false);
    const [modulosFaltantes, setModulosFaltantes] = useState<ModuloPlanilla[]>([]);

    /** 8vo requisito para enviar a aprobación, en paralelo al checklist de 7 módulos: el
     * Cálculo de Planilla (IMPL-85) debe haber corrido para todos los empleados activos.
     * Sin modificar `ModulosChecklistSection.tsx` (genérico, lo usan otras 2 vistas). El
     * RPC enviar_a_aprobacion (IMPL-102) revalida ambos requisitos server-side — este
     * chequeo client-side solo habilita/deshabilita el botón para feedback inmediato. */
    const [calculoCompleto, setCalculoCompleto] = useState(false);
    const [calculoConAlertas, setCalculoConAlertas] = useState(false);
    // Staleness post-reapertura (7ma pasada QA, hallazgo MINOR #1): el RPC enviar_a_aprobacion
    // ya bloquea el envío si algún planilla_calculo_empleado.calculado_at < reabierta_at — este
    // chequeo client-side replica esa misma comparación para no mostrar "completo, sin alertas"
    // de forma engañosa cuando en realidad hace falta recalcular tras la reapertura.
    const [calculoDesactualizado, setCalculoDesactualizado] = useState(false);
    // "# Empleados" (CA1) — RESUELTO (revisión épica por épica, post-IMPL-85): antes era
    // siempre el proxy de "activos totales"; ahora usa el vínculo real quincena↔empleado una
    // vez que se corrió el Cálculo de Planilla, con el proxy como fallback mientras no corrió.
    const [empleadosVinculados, setEmpleadosVinculados] = useState(0);
    const [totalNetoActual, setTotalNetoActual] = useState<number | null>(null);
    const [totalHorasExtraActual, setTotalHorasExtraActual] = useState<number | null>(null);
    const [totalNetoAnterior, setTotalNetoAnterior] = useState<number | null>(null);
    const [totalHorasExtraAnterior, setTotalHorasExtraAnterior] = useState<number | null>(null);
    const [showConfirmEnviar, setShowConfirmEnviar] = useState(false);
    const [isEnviando, setIsEnviando] = useState(false);

    useEffect(() => {
        if (!quincenaMostrada) return;
        calculoPlanillaService.getPorQuincena(quincenaMostrada.id)
            .then((registros) => {
                const totalActivos = indicadores?.activos ?? 0;
                setCalculoCompleto(totalActivos > 0 && registros.length >= totalActivos);
                setCalculoConAlertas(registros.some((r) => r.descuentos_alerta_tope_superado || r.alerta_neto_bajo_minimo));
                const reabiertaAt = quincenaMostrada.reabierta_at ? new Date(quincenaMostrada.reabierta_at).getTime() : null;
                setCalculoDesactualizado(
                    reabiertaAt !== null && registros.some((r) => new Date(r.calculado_at).getTime() < reabiertaAt)
                );
                setEmpleadosVinculados(registros.length);
                setTotalNetoActual(registros.length > 0 ? registros.reduce((s, r) => s + r.neto_a_pagar, 0) : null);
                setTotalHorasExtraActual(registros.length > 0 ? registros.reduce((s, r) => s + r.horas_extras_monto, 0) : null);
            })
            .catch((err: unknown) => Logger.error('Error al verificar estado de cálculo de planilla', { quincenaId: quincenaMostrada.id }, err));
    }, [quincenaMostrada, indicadores?.activos]);

    useEffect(() => {
        if (!quincenaAnterior) { setTotalNetoAnterior(null); setTotalHorasExtraAnterior(null); return; }
        calculoPlanillaService.getPorQuincena(quincenaAnterior.id)
            .then((registros) => {
                setTotalNetoAnterior(registros.length > 0 ? registros.reduce((s, r) => s + r.neto_a_pagar, 0) : null);
                setTotalHorasExtraAnterior(registros.length > 0 ? registros.reduce((s, r) => s + r.horas_extras_monto, 0) : null);
            })
            .catch((err: unknown) => Logger.error('Error al verificar cálculo de la quincena anterior', { quincenaId: quincenaAnterior.id }, err));
    }, [quincenaAnterior]);

    const puedeEnviar = !checklistReadOnly && checklistCompleto && calculoCompleto && !calculoDesactualizado;

    const handleConfirmarEnvio = async () => {
        if (!quincenaMostrada) return;
        setIsEnviando(true);
        try {
            await quincenasService.enviarAAprobacion(quincenaMostrada.id);
            await fetchQuincenas();
            showToast(t('quincenas.toast_enviada_aprobacion'), 'success');
            setShowConfirmEnviar(false);
        } catch (err: unknown) {
            Logger.error('Error al enviar quincena a aprobación', { quincenaId: quincenaMostrada.id }, err);
            showToast(err instanceof Error ? err.message : t('quincenas.error_enviar_aprobacion'), 'error');
        } finally {
            setIsEnviando(false);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {mostrarBotonNuevaQuincena && (
                <div className="flex items-center justify-end">
                    <Button onClick={onNuevaQuincena} className="flex items-center gap-2">
                        <Plus size={18} /> {t('quincenas.action_nueva_quincena')}
                    </Button>
                </div>
            )}

            {isLoading ? (
                <PageLoader label={t('common.loading')} />
            ) : !quincenaMostrada ? (
                <div className="bg-white rounded-lg shadow-cards border border-border p-xl text-center flex flex-col items-center gap-md">
                    <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center">
                        <CalendarClock size={32} className="text-text-secondary/50" />
                    </div>
                    <div>
                        <h3 className="text-h3 text-heading">{t('quincenas.sin_quincena_activa_title')}</h3>
                        <p className="text-body text-text-secondary mt-xs">{t('quincenas.sin_quincena_activa_desc')}</p>
                    </div>
                </div>
            ) : (
                <>
                    {/* Puramente informativo (no gatea ninguna acción, ver IMPL-156 CA4 arriba):
                        distingue si lo que se ve es la más reciente no cerrada del sistema, o
                        una distinta que el usuario eligió a propósito en el selector. */}
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary flex items-center gap-xs">
                        {quincenaMostrada.id === quincenaActivaFallback?.id && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse inline-block" />}
                        {quincenaMostrada.id === quincenaActivaFallback?.id ? t('quincenas.label_quincena_activa') : t('quincenas.label_quincena_seleccionada')}
                    </p>

                    {/* Tarjeta principal — CA1 */}
                    <div className="rounded-lg shadow-cards overflow-hidden bg-linear-to-r from-secondary-dark to-secondary p-lg flex flex-col gap-4">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div>
                                <span className="text-[11px] font-bold uppercase tracking-widest text-white/70">{TIPO_QUINCENA_LABEL[quincenaMostrada.tipo] ?? quincenaMostrada.tipo}</span>
                                <h2 className="text-h2 font-display text-white leading-tight">{quincenaMostrada.etiqueta_estandar}</h2>
                                {quincenaMostrada.nombre && quincenaMostrada.nombre !== quincenaMostrada.etiqueta_estandar && (
                                    <p className="text-caption text-white/60">{quincenaMostrada.nombre}</p>
                                )}
                            </div>
                            <EstadoQuincenaBadge estado={getEstadoVisual(quincenaMostrada)} variant="dark" />
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-md pt-3 border-t border-white/20">
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">{t('quincenas.field_fecha_inicio')}</p>
                                <p className="text-body font-bold mt-xs text-white">{fmtFecha(quincenaMostrada.fecha_inicio)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">{t('quincenas.field_fecha_fin')}</p>
                                <p className="text-body font-bold mt-xs text-white">{fmtFecha(quincenaMostrada.fecha_fin)}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60">{t('quincenas.dias_habiles_label')}</p>
                                <p className="text-body font-bold mt-xs text-white">{quincenaMostrada.dias_habiles}</p>
                            </div>
                            <div>
                                <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 flex items-center gap-1"><Users size={11} /> {t('quincenas.empleados_label')}</p>
                                <p className="text-body font-bold mt-xs text-white">{resolverEmpleadosCount(empleadosVinculados, indicadores?.activos)}</p>
                            </div>
                        </div>

                        {/* Motivo/comentario de la última transición relevante — antes solo se
                            veía en un toast descartable (7ma pasada QA, hallazgo MINOR #2). */}
                        {(() => {
                            const estadoVisual = getEstadoVisual(quincenaMostrada);
                            if (estadoVisual === 'rechazada' && quincenaMostrada.rechazo_motivo) {
                                return (
                                    <p className="text-[11px] text-white/70 italic pt-2 border-t border-white/20">
                                        {t('quincenas.card_motivo_rechazo', { motivo: quincenaMostrada.rechazo_motivo })}
                                    </p>
                                );
                            }
                            if (estadoVisual === 'reabierta' && quincenaMostrada.reapertura_motivo) {
                                return (
                                    <p className="text-[11px] text-white/70 italic pt-2 border-t border-white/20">
                                        {t('quincenas.card_motivo_reapertura', { motivo: quincenaMostrada.reapertura_motivo })}
                                    </p>
                                );
                            }
                            return null;
                        })()}

                        <ComparativoQuincenaSection
                            empleadosActivos={indicadores?.activos ?? 0}
                            totalNetoActual={totalNetoActual}
                            totalNetoAnterior={totalNetoAnterior}
                            totalHorasExtraActual={totalHorasExtraActual}
                            totalHorasExtraAnterior={totalHorasExtraAnterior}
                        />
                    </div>

                    <ModulosChecklistSection
                        quincenaId={quincenaMostrada.id}
                        tipoQuincena={quincenaMostrada.tipo}
                        isReadOnly={checklistReadOnly}
                        onCompletionChange={(completo, faltantes) => { setChecklistCompleto(completo); setModulosFaltantes(faltantes); }}
                    />

                    {/* Enviar a Aprobación — disponible para CUALQUIER quincena seleccionada que
                        esté `en_proceso` (IMPL-156 CA4), no solo la "más reciente no cerrada" del
                        sistema. Si la seleccionada ya está enviada/cerrada, se muestra en solo
                        lectura sin esta acción. */}
                    {!checklistReadOnly ? (
                        <div className="bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col sm:flex-row items-center justify-between gap-3">
                            <div className="flex flex-col gap-1">
                                {totalNetoActual !== null && (
                                    <div className="mb-1">
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('quincenas.footer_total_neto_estimado')}</p>
                                        <p className="text-h3 font-bold text-heading">${totalNetoActual.toLocaleString('es-SV', { minimumFractionDigits: 2 })}</p>
                                    </div>
                                )}
                                <p className="text-caption text-text-secondary">
                                    {checklistCompleto
                                        ? t('quincenas.enviar_disclaimer_completo')
                                        : t('quincenas.enviar_disclaimer_faltantes', { modulos: modulosFaltantes.map((m) => t(`quincenas.modulo_${m}`)).join(', ') })}
                                </p>
                                <p className="text-caption text-text-secondary">
                                    {calculoDesactualizado
                                        ? t('quincenas.enviar_calculo_desactualizado_reapertura')
                                        : calculoCompleto
                                            ? (calculoConAlertas ? t('quincenas.enviar_calculo_con_alertas') : t('quincenas.enviar_calculo_completo'))
                                            : t('quincenas.enviar_calculo_pendiente')}
                                </p>
                            </div>
                            <Button
                                disabled={!puedeEnviar}
                                title={puedeEnviar ? undefined : t('quincenas.enviar_disabled_tooltip')}
                                onClick={() => setShowConfirmEnviar(true)}
                                className="flex items-center gap-2 w-full sm:w-auto"
                            >
                                <Send size={16} /> {t('quincenas.action_enviar_aprobacion')}
                            </Button>
                        </div>
                    ) : (
                        <p className="text-caption text-text-secondary italic">{t('quincenas.nota_solo_lectura_no_activa')}</p>
                    )}
                </>
            )}

            <ConfirmModal
                isOpen={showConfirmEnviar}
                onClose={() => setShowConfirmEnviar(false)}
                onConfirm={handleConfirmarEnvio}
                title={t('quincenas.confirmar_enviar_title')}
                message={t('quincenas.confirmar_enviar_message')}
                confirmLabel={t('quincenas.action_enviar_aprobacion')}
                Icon={Send}
                isLoading={isEnviando}
            />
        </div>
    );
};
