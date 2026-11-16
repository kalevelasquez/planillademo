import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, CalendarClock, RotateCcw, AlertTriangle } from 'lucide-react';

import { quincenasService, getEstadoVisual, type Quincena } from '../../../services/quincenasService';
import { usePlanillaEmpleadosStore } from '../../../store/planillaEmpleadosStore';
import { calculoPlanillaService } from '../../../services/calculoPlanillaService';
import { useAuthStore } from '../../../store/authStore';
import { useShallow } from 'zustand/react/shallow';
import { TIPO_QUINCENA_LABEL, resolverEmpleadosCount } from '../../../utils/quincenaUtils';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { PageLoader } from '../../components/PageLoader';
import { EstadoQuincenaBadge } from './components/EstadoQuincenaBadge';
import { ModulosChecklistSection } from './components/ModulosChecklistSection';
import { useToast } from '../../../context/ToastContext';
import { auditService } from '../../../services/auditService';
import { Logger } from '../../../utils/logger';

function fmtFecha(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Detalle de una quincena cerrada, de solo lectura (US-QNA-07 CA3). Reusa
 * ModulosChecklistSection en modo isReadOnly (además la RLS de en_proceso ya lo
 * bloquearía a nivel de datos aunque se intentara editar).
 *
 * Punto de entrada de "Re-abrir" (US-CIE-00 CA4): solo tiene sentido acá, no en el
 * dashboard del Aprobador (que solo lista quincenas 'enviada_aprobacion') — una quincena
 * 'aprobada_cerrada' solo se ve en el Historial/Detalle.
 */
export const QuincenaDetalleView: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { profile } = useAuthStore();
    const { id } = useParams<{ id: string }>();
    const [quincena, setQuincena] = useState<Quincena | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(false);
    const [motivoReapertura, setMotivoReapertura] = useState('');
    const [mostrarFormReapertura, setMostrarFormReapertura] = useState(false);
    const [isReabriendo, setIsReabriendo] = useState(false);

    const isAdmin = Array.isArray(profile?.roles) ? profile.roles.includes('admin') : profile?.role === 'admin';
    const isAprobador = Array.isArray(profile?.roles) && profile.roles.includes('aprobador_planilla');
    const puedeReabrir = quincena?.estado === 'aprobada_cerrada' && (isAdmin || isAprobador);

    const { indicadores, fetchIndicadores } = usePlanillaEmpleadosStore(
        useShallow((state) => ({ indicadores: state.indicadores, fetchIndicadores: state.fetchIndicadores }))
    );
    // CA1 (Monto Total) y "# Empleados" — RESUELTO (revisión épica por épica, post-IMPL-85):
    // antes "Monto Total" ni siquiera existía como elemento y "# Empleados" seguía leyendo el
    // proxy de activos totales (mismo fix ya aplicado en Preparador/Historial/Aprobador).
    const [empleadosVinculados, setEmpleadosVinculados] = useState(0);
    const [montoTotal, setMontoTotal] = useState<number | null>(null);

    useEffect(() => {
        if (!id) return;
        setIsLoading(true);
        setError(false);
        fetchIndicadores();
        quincenasService.getQuincenaById(id)
            .then(setQuincena)
            .catch((err: unknown) => { Logger.error('Error al cargar detalle de quincena', { id }, err); setError(true); })
            .finally(() => setIsLoading(false));
        calculoPlanillaService.getPorQuincena(id)
            .then((registros) => {
                setEmpleadosVinculados(registros.length);
                setMontoTotal(registros.length > 0 ? registros.reduce((s, r) => s + r.neto_a_pagar, 0) : null);
            })
            .catch((err: unknown) => Logger.error('Error al cargar cálculo de la quincena', { id }, err));
    }, [id, fetchIndicadores]);

    const handleReabrir = async () => {
        if (!quincena || !motivoReapertura.trim()) return;
        setIsReabriendo(true);
        try {
            const actualizada = await quincenasService.reabrir(quincena.id, motivoReapertura.trim());
            // US-AUD-06 CA2: el comentario de motivo va como parte del JSONB de detalles.
            await auditService.logAction('RE_APERTURA', 'quincena', quincena.id, { motivo: motivoReapertura.trim() });
            setQuincena(actualizada);
            setMostrarFormReapertura(false);
            setMotivoReapertura('');
            showToast(t('quincenas.toast_reabierta'), 'success');
        } catch (err: unknown) {
            Logger.error('Error al re-abrir quincena', { id: quincena.id }, err);
            showToast(err instanceof Error ? err.message : t('quincenas.error_reabrir'), 'error');
        } finally {
            setIsReabriendo(false);
        }
    };

    if (isLoading) {
        return <PageLoader fullPage label={t('common.loading')} />;
    }
    if (error || !quincena) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[400px] gap-4 max-w-[28rem] mx-auto text-center px-6">
                <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center">
                    <AlertTriangle size={32} />
                </div>
                <p className="text-body text-text-secondary">{t('quincenas.detalle_error_cargar')}</p>
                <Button variant="primary" onClick={() => navigate('/planilla/historial')} className="mt-2">
                    {t('quincenas.detalle_action_volver_historial')}
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <div className="flex items-center gap-sm">
                <button onClick={() => navigate('/planilla/historial')} className="p-sm rounded-lg hover:bg-surface text-text-secondary hover:text-heading transition-colors">
                    <ArrowLeft size={20} />
                </button>
                <PageHeader icon={CalendarClock} title={quincena.etiqueta_estandar} description={TIPO_QUINCENA_LABEL[quincena.tipo]} className="mb-0 pb-0 border-b-0 flex-1" />
            </div>

            <div className="bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <span className="text-caption text-text-secondary">{t('quincenas.detalle_solo_lectura')}</span>
                    <EstadoQuincenaBadge estado={getEstadoVisual(quincena)} />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-md pt-3 border-t border-border/50">
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('quincenas.field_fecha_inicio')}</p>
                        <p className="text-body font-bold mt-xs text-heading">{fmtFecha(quincena.fecha_inicio)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('quincenas.field_fecha_fin')}</p>
                        <p className="text-body font-bold mt-xs text-heading">{fmtFecha(quincena.fecha_fin)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('quincenas.dias_habiles_label')}</p>
                        <p className="text-body font-bold mt-xs text-heading">{quincena.dias_habiles}</p>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('quincenas.empleados_label')}</p>
                        <p className="text-body font-bold mt-xs text-heading">{resolverEmpleadosCount(empleadosVinculados, indicadores?.activos)}</p>
                    </div>
                    <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('quincenas.detalle_monto_total')}</p>
                        <p className={`text-body font-bold mt-xs ${montoTotal === null ? 'text-text-secondary/40' : 'text-heading'}`}>
                            {montoTotal === null ? '—' : `$${montoTotal.toLocaleString('es-SV', { minimumFractionDigits: 2 })}`}
                        </p>
                    </div>
                </div>

                {/* Motivo/comentario de la última transición relevante — antes solo se veía en
                    un toast descartable (7ma pasada QA, hallazgo MINOR #2). */}
                {(() => {
                    const estadoVisual = getEstadoVisual(quincena);
                    if (estadoVisual === 'aprobada_cerrada' && quincena.aprobada_comentario) {
                        return (
                            <p className="text-caption text-text-secondary italic pt-2 border-t border-border/50">
                                {t('quincenas.card_comentario_aprobacion', { comentario: quincena.aprobada_comentario })}
                            </p>
                        );
                    }
                    if (estadoVisual === 'rechazada' && quincena.rechazo_motivo) {
                        return (
                            <p className="text-caption text-red-600 italic pt-2 border-t border-border/50">
                                {t('quincenas.card_motivo_rechazo', { motivo: quincena.rechazo_motivo })}
                            </p>
                        );
                    }
                    if (estadoVisual === 'reabierta' && quincena.reapertura_motivo) {
                        return (
                            <p className="text-caption text-orange-600 italic pt-2 border-t border-border/50">
                                {t('quincenas.card_motivo_reapertura', { motivo: quincena.reapertura_motivo })}
                            </p>
                        );
                    }
                    return null;
                })()}
            </div>

            {/* ModulosChecklistSection ya se auto-gatea para Quincena 25 (muestra la nota
                explicativa) — antes esta vista lo escondía del todo, quedando como la única
                distinta a los dashboards de Preparador/Aprobador (7ma pasada QA, MINOR #3). */}
            <ModulosChecklistSection quincenaId={quincena.id} tipoQuincena={quincena.tipo} isReadOnly />

            {puedeReabrir && (
                <div className="bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-3">
                    {!mostrarFormReapertura ? (
                        <Button
                            variant="outline-danger"
                            onClick={() => setMostrarFormReapertura(true)}
                            className="flex items-center gap-2 self-start"
                        >
                            <RotateCcw size={16} /> {t('quincenas.action_reabrir')}
                        </Button>
                    ) : (
                        <div className="flex flex-col gap-2 bg-amber-50/60 border border-amber-200 rounded-lg p-md">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                                {t('quincenas.field_motivo_reapertura')} <span className="text-error">*</span>
                            </label>
                            <textarea
                                value={motivoReapertura}
                                onChange={(e) => setMotivoReapertura(e.target.value)}
                                rows={3}
                                placeholder={t('quincenas.motivo_reapertura_placeholder')}
                                className="w-full rounded-md border border-border bg-white p-sm text-body text-heading"
                            />
                            <div className="flex gap-2">
                                <Button
                                    variant="warning"
                                    disabled={!motivoReapertura.trim()}
                                    isLoading={isReabriendo}
                                    onClick={handleReabrir}
                                    className="flex items-center gap-2"
                                >
                                    <RotateCcw size={16} /> {t('quincenas.action_confirmar_reapertura')}
                                </Button>
                                <Button variant="ghost" onClick={() => { setMostrarFormReapertura(false); setMotivoReapertura(''); }}>
                                    {t('quincenas.action_cancelar')}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
