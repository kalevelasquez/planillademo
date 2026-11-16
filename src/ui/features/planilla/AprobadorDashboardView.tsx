import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';
import { CalendarClock, Users, Send, XCircle, MessageSquare, ShieldCheck } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useQuincenasStore } from '../../../store/quincenasStore';
import { usePlanillaEmpleadosStore } from '../../../store/planillaEmpleadosStore';
import { quincenasService, getEstadoVisual } from '../../../services/quincenasService';
import { calculoPlanillaService } from '../../../services/calculoPlanillaService';
import { userService } from '../../../services/userService';
import { TIPO_QUINCENA_LABEL, encontrarQuincenaAnterior, resolverEmpleadosCount } from '../../../utils/quincenaUtils';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { PageLoader } from '../../components/PageLoader';
import { EstadoQuincenaBadge } from './components/EstadoQuincenaBadge';
import { ModulosChecklistSection } from './components/ModulosChecklistSection';
import { ResumenFinancieroSection } from './components/ResumenFinancieroSection';
import { ResumenDepartamentosSection } from './components/ResumenDepartamentosSection';
import { useToast } from '../../../context/ToastContext';
import { auditService } from '../../../services/auditService';
import { Logger } from '../../../utils/logger';

function fmtFecha(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtFechaHora(iso: string): string {
    return new Date(iso).toLocaleString('es-SV', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface AprobadorDashboardViewProps {
    /** Quincena elegida en el selector compartido del header (PlanillaLayout) — permite
     * BROWSEAR el resumen de cualquier quincena. Aprobar/Rechazar siguen atados SOLO a
     * `quincenaPendienteReal` (ver comentario más abajo), nunca a esta. */
    quincenaSeleccionadaId?: string;
}

/**
 * Vista de Aprobador: Resumen Ejecutivo (US-QNA-08 / IMPL-18). "Quincena a revisar" es la
 * más reciente en estado 'enviada_aprobacion'. Rechazar/Aprobar y Cerrar (US-CIE-00 CA2/CA3,
 * IMPL-102) reusan el mismo textarea de comentario: obligatorio para Rechazar (motivo),
 * opcional para Aprobar y Cerrar — evita duplicar el campo, ninguno de los dos CAs de Jira
 * pide campos separados. CA5 (segregación) se valida acá client-side (deshabilita el botón
 * si `enviada_por === usuarioActual.id`) Y server-side dentro del RPC — la UI es solo
 * feedback inmediato, el RPC es la autoridad real.
 */
export const AprobadorDashboardView: React.FC<AprobadorDashboardViewProps> = ({ quincenaSeleccionadaId }) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const { profile } = useAuthStore();

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

    // `quincenaPendienteReal` es la ÚNICA sobre la que Aprobar/Rechazar pueden operar — mismo
    // criterio que "Enviar a Aprobación" en Preparador: la acción real nunca sigue al selector
    // de navegación. `quincenaMostrada` es la que efectivamente se pinta en pantalla — la
    // seleccionada si existe, si no la pendiente real.
    const quincenaPendienteReal = useMemo(
        () => [...quincenas].sort((a, b) => b.fecha_inicio.localeCompare(a.fecha_inicio)).find((q) => q.estado === 'enviada_aprobacion'),
        [quincenas]
    );
    const quincenaMostrada = useMemo(
        () => (quincenaSeleccionadaId ? quincenas.find((q) => q.id === quincenaSeleccionadaId) : undefined) ?? quincenaPendienteReal,
        [quincenas, quincenaSeleccionadaId, quincenaPendienteReal]
    );
    const esQuincenaPendienteReal = !!quincenaMostrada && quincenaMostrada.id === quincenaPendienteReal?.id;
    // CA2/CA3 (comparativo y variaciones por departamento) — RESUELTO (revisión épica por
    // épica, post-IMPL-85): mismo criterio que el comparativo de Preparador (IMPL-10).
    const quincenaAnterior = useMemo(
        () => (quincenaMostrada ? encontrarQuincenaAnterior(quincenas, quincenaMostrada) : null),
        [quincenas, quincenaMostrada]
    );

    const [comentario, setComentario] = useState('');
    const [accionConfirmar, setAccionConfirmar] = useState<'aprobar' | 'rechazar' | null>(null);
    const [isProcesando, setIsProcesando] = useState(false);
    // "# Empleados" (CA1) — RESUELTO (revisión épica por épica, post-IMPL-85): conteo real en
    // vez del proxy de "activos totales" (mismo criterio que Preparador/Historial).
    const [empleadosVinculados, setEmpleadosVinculados] = useState(0);
    const [totalNeto, setTotalNeto] = useState<number | null>(null);
    // "Quién la envió" (CA1) — RESUELTO (revisión épica por épica): enviada_por ya existe
    // (IMPL-102), solo faltaba resolver el UUID a un nombre real.
    const [enviadoPorNombre, setEnviadoPorNombre] = useState<string | null>(null);

    useEffect(() => {
        if (!quincenaMostrada) { setEmpleadosVinculados(0); setTotalNeto(null); return; }
        calculoPlanillaService.getPorQuincena(quincenaMostrada.id)
            .then((registros) => {
                setEmpleadosVinculados(registros.length);
                setTotalNeto(registros.length > 0 ? registros.reduce((s, r) => s + r.neto_a_pagar, 0) : null);
            })
            .catch((err: unknown) => Logger.error('Error al verificar empleados vinculados a la quincena', { quincenaId: quincenaMostrada.id }, err));
    }, [quincenaMostrada]);

    useEffect(() => {
        if (!quincenaMostrada?.enviada_por) { setEnviadoPorNombre(null); return; }
        userService.getNombrePorId(quincenaMostrada.enviada_por)
            .then(setEnviadoPorNombre)
            .catch((err: unknown) => Logger.error('Error al resolver nombre de quien envió la quincena', { userId: quincenaMostrada.enviada_por }, err));
    }, [quincenaMostrada?.enviada_por]);

    const esMismoUsuarioQueEnvio = !!profile?.id && !!quincenaPendienteReal?.enviada_por && quincenaPendienteReal.enviada_por === profile.id;

    const handleConfirmarAccion = async () => {
        if (!quincenaPendienteReal || !accionConfirmar) return;
        setIsProcesando(true);
        try {
            if (accionConfirmar === 'aprobar') {
                await quincenasService.aprobarYCerrar(quincenaPendienteReal.id, comentario.trim() || undefined);
                // US-AUD-06 CA1: "Aprobar y Cerrar" es un solo botón pero son 2 acciones
                // semánticas distintas para el log de auditoría — se registran ambas.
                await auditService.logAction('APROBACION', 'quincena', quincenaPendienteReal.id, { comentario: comentario.trim() || null });
                await auditService.logAction('CIERRE', 'quincena', quincenaPendienteReal.id);
                showToast(t('quincenas.toast_aprobada'), 'success');
            } else {
                await quincenasService.rechazar(quincenaPendienteReal.id, comentario.trim());
                await auditService.logAction('RECHAZO', 'quincena', quincenaPendienteReal.id, { motivo: comentario.trim() });
                showToast(t('quincenas.toast_rechazada'), 'success');
            }
            await fetchQuincenas();
            setComentario('');
            setAccionConfirmar(null);
        } catch (err: unknown) {
            Logger.error('Error al procesar transición de quincena', { quincenaId: quincenaPendienteReal.id, accion: accionConfirmar }, err);
            showToast(err instanceof Error ? err.message : t('quincenas.error_procesar_transicion'), 'error');
        } finally {
            setIsProcesando(false);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-40 md:pb-24 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {isLoading ? (
                <PageLoader label={t('common.loading')} />
            ) : !quincenaMostrada ? (
                <div className="bg-white rounded-lg shadow-cards border border-border p-xl text-center flex flex-col items-center gap-md">
                    <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center">
                        <CalendarClock size={32} className="text-text-secondary/50" />
                    </div>
                    <div>
                        <h3 className="text-h3 text-heading">{t('quincenas.sin_quincena_pendiente_title')}</h3>
                        <p className="text-body text-text-secondary mt-xs">{t('quincenas.sin_quincena_pendiente_desc')}</p>
                    </div>
                </div>
            ) : (
                <>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary flex items-center gap-xs">
                        <ShieldCheck size={12} className="text-primary" />
                        {esQuincenaPendienteReal ? t('quincenas.label_quincena_a_revisar') : t('quincenas.label_quincena_seleccionada')}
                    </p>

                    {/* Tarjeta "Quincena a Revisar" — CA1 */}
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

                        <p className="text-[11px] text-white/50 italic pt-2 border-t border-white/20">
                            {quincenaMostrada.enviada_at
                                ? (enviadoPorNombre
                                    ? t('quincenas.card_enviada_por_y_en', { nombre: enviadoPorNombre, fecha: fmtFechaHora(quincenaMostrada.enviada_at) })
                                    : t('quincenas.card_enviada_en', { fecha: fmtFechaHora(quincenaMostrada.enviada_at) }))
                                : t('quincenas.card_enviada_por_placeholder')}
                        </p>
                    </div>

                    <ResumenFinancieroSection quincenaId={quincenaMostrada.id} />
                    <ResumenDepartamentosSection quincenaId={quincenaMostrada.id} quincenaAnteriorId={quincenaAnterior?.id ?? null} />
                    <ModulosChecklistSection quincenaId={quincenaMostrada.id} tipoQuincena={quincenaMostrada.tipo} isReadOnly />

                    {/* Comentario/motivo y botones de acción — SOLO disponibles viendo la
                        quincena realmente pendiente (ver comentario de `quincenaPendienteReal`
                        más arriba). Al navegar otra quincena desde el selector, se muestra todo
                        lo de arriba en solo lectura sin esta acción. */}
                    {esQuincenaPendienteReal ? (
                        <div className="bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-2">
                            <div className="flex items-center gap-2">
                                <MessageSquare size={14} className="text-primary" />
                                <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                                    {t('quincenas.section_comentario_preparador')}{' '}
                                    <span className="normal-case font-normal text-text-secondary/70">{t('quincenas.comentario_preparador_opcional')}</span>
                                </h3>
                            </div>
                            <textarea
                                value={comentario}
                                onChange={(e) => setComentario(e.target.value)}
                                rows={3}
                                placeholder={t('quincenas.comentario_preparador_placeholder')}
                                className="w-full rounded-md border border-border bg-surface/50 p-sm text-body text-heading"
                            />
                            {esMismoUsuarioQueEnvio && (
                                <p className="text-caption text-red-600">{t('quincenas.aprobar_bloqueado_mismo_usuario')}</p>
                            )}
                        </div>
                    ) : (
                        <p className="text-caption text-text-secondary italic">{t('quincenas.nota_solo_lectura_no_pendiente')}</p>
                    )}
                </>
            )}

            {/* Botones sticky — CA7. Solo se renderizan viendo la quincena realmente pendiente. */}
            {esQuincenaPendienteReal && quincenaPendienteReal && (
                <div className="fixed bottom-0 left-0 right-0 z-50">
                    <div className="bg-white/95 backdrop-blur-sm border-t border-border shadow-modals px-md py-sm md:px-lg">
                        <div className="max-w-4xl mx-auto flex items-center justify-between gap-sm">
                            {totalNeto !== null && (
                                <div className="hidden sm:block">
                                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('quincenas.financiero_neto_total')}</p>
                                    <p className="text-h3 font-bold text-primary">${totalNeto.toLocaleString('es-SV', { minimumFractionDigits: 2 })}</p>
                                </div>
                            )}
                            <div className="flex items-center gap-sm ml-auto">
                                <Button
                                    variant="outline-danger"
                                    disabled={!comentario.trim()}
                                    title={comentario.trim() ? undefined : t('quincenas.rechazar_motivo_obligatorio_tooltip')}
                                    onClick={() => setAccionConfirmar('rechazar')}
                                    className="flex items-center gap-2"
                                >
                                    <XCircle size={16} /> {t('quincenas.action_rechazar')}
                                </Button>
                                <Button
                                    disabled={esMismoUsuarioQueEnvio || empleadosVinculados === 0}
                                    title={
                                        esMismoUsuarioQueEnvio ? t('quincenas.aprobar_bloqueado_mismo_usuario')
                                        : empleadosVinculados === 0 ? t('quincenas.aprobar_bloqueado_sin_calculo')
                                        : undefined
                                    }
                                    onClick={() => setAccionConfirmar('aprobar')}
                                    className="flex items-center gap-2"
                                >
                                    <Send size={16} /> {t('quincenas.action_aprobar_cerrar')}
                                </Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={accionConfirmar !== null}
                onClose={() => setAccionConfirmar(null)}
                onConfirm={handleConfirmarAccion}
                title={accionConfirmar === 'rechazar' ? t('quincenas.confirmar_rechazar_title') : t('quincenas.confirmar_aprobar_title')}
                message={accionConfirmar === 'rechazar' ? t('quincenas.confirmar_rechazar_message') : t('quincenas.confirmar_aprobar_message')}
                confirmLabel={accionConfirmar === 'rechazar' ? t('quincenas.action_rechazar') : t('quincenas.action_aprobar_cerrar')}
                variant={accionConfirmar === 'rechazar' ? 'danger' : 'primary'}
                Icon={accionConfirmar === 'rechazar' ? XCircle : Send}
                isLoading={isProcesando}
            />
        </div>
    );
};
