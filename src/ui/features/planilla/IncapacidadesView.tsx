import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Paperclip, CalendarDays, ShieldCheck, Info, HeartPulse, HardHat, Baby, X } from 'lucide-react';

import { useToast } from '../../../context/ToastContext';
import { usePlanillaContext } from './PlanillaLayout';
import { planillaEmpleadosService, type Empleado } from '../../../services/planillaEmpleadosService';
import { incapacidadesService, type Incapacidad } from '../../../services/incapacidadesService';
import { viaticoDocumentosService } from '../../../services/viaticoDocumentosService';
import type { TipoIncapacidad } from '../../../utils/incapacidadesUtils';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { ViaticoAdjuntosModal } from './components/ViaticoAdjuntosModal';
import { IncapacidadModal } from './components/IncapacidadModal';
import { Logger } from '../../../utils/logger';
import { getCodigoEmpleado } from '../../../utils/empleadoCodigoUtils';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

const TIPO_CONFIG: Record<TipoIncapacidad, { icon: React.ElementType; badgeCls: string; stripeCls: string }> = {
    enfermedad_comun: { icon: HeartPulse, badgeCls: 'bg-primary-light text-primary border-primary/20', stripeCls: 'bg-primary' },
    accidente_trabajo: { icon: HardHat, badgeCls: 'bg-amber-50 text-amber-700 border-amber-200', stripeCls: 'bg-amber-400' },
    maternidad: { icon: Baby, badgeCls: 'bg-pink-50 text-pink-700 border-pink-200', stripeCls: 'bg-pink-400' },
};

/**
 * Tarjeta de incapacidad (US-INC-00, fidelidad DEMO US-UX-02): franja de color por tipo,
 * badges de tipo/subsidio, rango de fechas, días, y el texto de cobertura ya calculado por
 * `textoCoberturaPara` (CA3/CA5 de US-INC-01, nunca editable) como una línea con color —
 * mismo patrón "tarjeta con ícono de color" confirmado 4+ veces esta sesión.
 */
const IncapacidadCard: React.FC<{
    registro: Incapacidad;
    nombreEmpleado: string;
    codigoEmpleado: string;
    textoCobertura: string;
    quincenaCerrada: boolean;
    cantidadAdjuntos: number;
    onAdjuntos: () => void;
    onEditar: () => void;
    onEliminar: () => void;
}> = ({ registro: r, nombreEmpleado, codigoEmpleado, textoCobertura, quincenaCerrada, cantidadAdjuntos, onAdjuntos, onEditar, onEliminar }) => {
    const { t } = useTranslation();
    const tipoCfg = TIPO_CONFIG[r.tipo];
    const TipoIcon = tipoCfg.icon;
    const coberturaEsInformativa = r.tipo === 'enfermedad_comun' && r.con_subsidio;
    const CoberturaIcon = coberturaEsInformativa ? Info : ShieldCheck;
    const coberturaCls = coberturaEsInformativa ? 'bg-blue-50 text-blue-700' : 'bg-primary-light text-primary';

    return (
        <div className="bg-white rounded-xl border border-border shadow-cards overflow-hidden">
            <div className="flex">
                <div className={`w-1.5 shrink-0 ${tipoCfg.stripeCls}`} />
                <div className="flex-1 p-md flex flex-col gap-sm">
                    <div className="flex flex-wrap items-start justify-between gap-sm">
                        <div className="min-w-0">
                            <p className="text-body font-bold text-heading truncate">{nombreEmpleado}</p>
                            <p className="text-[11px] text-text-secondary font-mono mt-0.5">{codigoEmpleado} · {r.numero_cit}</p>
                        </div>
                        <div className="flex flex-wrap gap-xs shrink-0 items-center">
                            <span className={`inline-flex items-center gap-xs px-sm py-0.5 rounded-full text-[10px] font-bold border ${tipoCfg.badgeCls}`}>
                                <TipoIcon size={11} /> {t(`incapacidades.tipo_${r.tipo}`)}
                            </span>
                            {r.con_subsidio ? (
                                <span className="inline-flex items-center gap-xs px-sm py-0.5 rounded-full text-[10px] font-bold bg-primary-light text-primary border border-primary/20">
                                    <ShieldCheck size={10} /> {t('incapacidades.stat_con_subsidio')}
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-xs px-sm py-0.5 rounded-full text-[10px] font-bold bg-surface text-text-secondary border border-border">
                                    {t('incapacidades.stat_sin_subsidio')}
                                </span>
                            )}
                            <button type="button" onClick={onAdjuntos} className={`relative p-1 transition-colors ${cantidadAdjuntos > 0 ? 'text-primary' : 'text-text-secondary hover:text-primary'}`}>
                                <Paperclip size={13} />
                                {cantidadAdjuntos > 0 && (
                                    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">{cantidadAdjuntos}</span>
                                )}
                            </button>
                            {!quincenaCerrada && (
                                <>
                                    <button type="button" onClick={onEditar} className="p-1 text-text-secondary hover:text-primary transition-colors"><Pencil size={13} /></button>
                                    <button type="button" onClick={onEliminar} className="p-1 text-text-secondary hover:text-error transition-colors"><Trash2 size={13} /></button>
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex items-center gap-lg flex-wrap">
                        <div className="flex items-center gap-xs text-[12px] text-text-secondary">
                            <CalendarDays size={13} className="shrink-0 text-primary" />
                            <span>{r.fecha_inicio}</span>
                            <span className="text-border">→</span>
                            <span>{r.fecha_fin}</span>
                        </div>
                        <div className="flex items-center gap-xs">
                            <span className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">{t('incapacidades.col_dias')}:</span>
                            <span className="text-body font-bold text-heading">{r.dias}</span>
                        </div>
                        {r.trabajo_durante_incapacidad && (
                            <span className="text-[11px] text-primary font-semibold">
                                {t('incapacidades.badge_trabajo_bono', { monto: (r.monto_bono_trabajado ?? 0).toFixed(2) })}
                            </span>
                        )}
                    </div>

                    <div className={`flex items-center gap-xs px-sm py-xs rounded-lg ${coberturaCls}`}>
                        <CoberturaIcon size={13} className="shrink-0" />
                        <span className="text-[11px] font-semibold">{textoCobertura}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

/**
 * Panel de Indicadores y Listado (US-INC-00) + Registrar Certificado (US-INC-01). El botón
 * "Registrar" (CA4 de US-INC-00) abre el modal (fidelidad DEMO US-UX-02, ver
 * IncapacidadModal.tsx). El desglose de cobertura (CA3 de US-INC-01) nunca es editable (CA5:
 * sin excepción manual posible) — la misma función de texto se reusa acá para las tarjetas del
 * listado (CA3 de US-INC-00: los textos nunca deben decir "días descontados al empleado").
 */
export const IncapacidadesView: React.FC = () => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const { quincenaId, quincena, quincenaCerrada } = usePlanillaContext();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [registros, setRegistros] = useState<Incapacidad[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const [showModal, setShowModal] = useState(false);
    const [editTarget, setEditTarget] = useState<Incapacidad | null>(null);

    const [eliminarObjetivo, setEliminarObjetivo] = useState<Incapacidad | null>(null);
    const [isEliminando, setIsEliminando] = useState(false);
    const [adjuntosAbiertoPara, setAdjuntosAbiertoPara] = useState<Incapacidad | null>(null);
    /** IMPL-131 (Observación General UAT) — cantidad de adjuntos por registro, para mostrarla
     * junto al ícono de clip (batch, sin N+1), mismo patrón que KilometrajeSection. */
    const [adjuntosPorRegistro, setAdjuntosPorRegistro] = useState<Map<string, number>>(new Map());

    const [filtroBusqueda, setFiltroBusqueda] = useState('');
    const [filtroTipo, setFiltroTipo] = useState<TipoIncapacidad | 'todos'>('todos');
    const [filtroSubsidio, setFiltroSubsidio] = useState<'todos' | 'con_subsidio' | 'sin_subsidio'>('todos');

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        Promise.all([
            planillaEmpleadosService.getEmpleadosActivos(),
            incapacidadesService.getPorQuincena(quincenaId),
        ])
            .then(([emps, regs]) => { setEmpleados(emps); setRegistros(regs); })
            .catch((err: unknown) => {
                Logger.error('Error al cargar incapacidades', { quincenaId }, err);
                setError(t('incapacidades.error_cargar'));
            })
            .finally(() => setIsLoading(false));
    }, [quincenaId, t]);

    useEffect(() => {
        if (registros.length === 0) {
            setAdjuntosPorRegistro(new Map());
            return;
        }
        let activo = true;
        viaticoDocumentosService.getPorRegistros('incapacidad', registros.map((r) => r.id))
            .then((docs) => {
                if (!activo) return;
                const counts = new Map<string, number>();
                for (const d of docs) counts.set(d.registro_id, (counts.get(d.registro_id) ?? 0) + 1);
                setAdjuntosPorRegistro(counts);
            })
            .catch((err: unknown) => Logger.error('Error al cargar contadores de adjuntos de incapacidad', {}, err));
        return () => { activo = false; };
    }, [registros]);

    const nombreEmpleado = (empleadoId: string): string => empleados.find((e) => e.id === empleadoId)?.nombre_completo ?? empleadoId;

    /** IMPL-132 (Observación General UAT) — código de empleado junto al nombre en la lista. */
    const codigoEmpleado = (empleadoId: string): string => {
        const emp = empleados.find((e) => e.id === empleadoId);
        return emp ? getCodigoEmpleado(emp) : '';
    };

    const indicadores = useMemo(() => ({
        certificados: registros.length,
        totalDias: registros.reduce((sum, r) => sum + r.dias, 0),
        conSubsidio: registros.filter((r) => r.con_subsidio).length,
        sinSubsidio: registros.filter((r) => !r.con_subsidio).length,
    }), [registros]);

    /** US-INC-05 — búsqueda por nombre/código de empleado (CA1) + filtros por tipo y
     * con/sin subsidio (CA2). Los indicadores (US-INC-00) reflejan el total del período, no
     * el resultado filtrado — el filtro solo acota el listado. */
    const registrosFiltrados = useMemo(() => {
        const termino = filtroBusqueda.trim().toLowerCase();
        return registros.filter((r) => {
            if (filtroTipo !== 'todos' && r.tipo !== filtroTipo) return false;
            if (filtroSubsidio === 'con_subsidio' && !r.con_subsidio) return false;
            if (filtroSubsidio === 'sin_subsidio' && r.con_subsidio) return false;
            if (termino) {
                const emp = empleados.find((e) => e.id === r.empleado_id);
                const coincide = emp?.nombre_completo.toLowerCase().includes(termino) || (!!emp && getCodigoEmpleado(emp).toLowerCase().includes(termino));
                if (!coincide) return false;
            }
            return true;
        });
    }, [registros, empleados, filtroBusqueda, filtroTipo, filtroSubsidio]);

    const hayFiltrosActivos = filtroBusqueda.trim() !== '' || filtroTipo !== 'todos' || filtroSubsidio !== 'todos';
    const handleLimpiarFiltros = () => {
        setFiltroBusqueda('');
        setFiltroTipo('todos');
        setFiltroSubsidio('todos');
    };

    const handleEditar = (registro: Incapacidad) => {
        setEditTarget(registro);
        setShowModal(true);
    };

    const handleSaved = (registro: Incapacidad) => {
        setRegistros((prev) => {
            const existe = prev.some((r) => r.id === registro.id);
            return existe ? prev.map((r) => (r.id === registro.id ? registro : r)) : [registro, ...prev];
        });
        showToast(editTarget ? t('incapacidades.toast_actualizado') : t('incapacidades.toast_guardado'), 'success');
        setEditTarget(null);
    };

    const handleConfirmarEliminar = async () => {
        if (!eliminarObjetivo) return;
        setIsEliminando(true);
        try {
            await incapacidadesService.eliminar(eliminarObjetivo.id);
            setRegistros((prev) => prev.filter((r) => r.id !== eliminarObjetivo.id));
            setEliminarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al eliminar incapacidad', { id: eliminarObjetivo.id }, err);
            showToast(err instanceof Error ? err.message : t('incapacidades.error_eliminar'), 'error');
        } finally {
            setIsEliminando(false);
        }
    };

    const textoCoberturaPara = (tipo: TipoIncapacidad, conSubsidio: boolean): string => {
        if (tipo === 'accidente_trabajo') return t('incapacidades.cobertura_accidente_trabajo');
        if (tipo === 'maternidad') return t('incapacidades.cobertura_maternidad');
        return conSubsidio ? t('incapacidades.cobertura_enfermedad_con_subsidio') : t('incapacidades.cobertura_enfermedad_sin_subsidio');
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {isLoading ? (
                <div className="h-32 bg-surface rounded-lg animate-pulse" />
            ) : (
                <>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-md">
                        {[
                            { label: t('incapacidades.stat_certificados'), value: indicadores.certificados, color: 'text-heading' },
                            { label: t('incapacidades.stat_total_dias'), value: indicadores.totalDias, color: 'text-primary' },
                            { label: t('incapacidades.stat_con_subsidio'), value: indicadores.conSubsidio, color: 'text-amber-600' },
                            { label: t('incapacidades.stat_sin_subsidio'), value: indicadores.sinSubsidio, color: 'text-text-secondary' },
                        ].map((s) => (
                            <div key={s.label} className="bg-white rounded-lg shadow-cards border border-border p-md">
                                <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{s.label}</p>
                                <p className={`text-[1.75rem] font-bold mt-xs ${s.color}`}>{s.value}</p>
                            </div>
                        ))}
                    </div>

                    {registros.length === 0 ? (
                        <div className="bg-white rounded-xl border border-border shadow-cards p-xl flex flex-col items-center gap-md text-center">
                            <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center">
                                <HeartPulse size={24} className="text-text-secondary" />
                            </div>
                            <div>
                                <p className="text-body font-bold text-heading">{t('incapacidades.listado_empty_title')}</p>
                                <p className="text-[12px] text-text-secondary mt-xs">{t('incapacidades.listado_empty')}</p>
                            </div>
                            {!quincenaCerrada && (
                                <button
                                    type="button"
                                    onClick={() => setShowModal(true)}
                                    className="flex items-center gap-xs px-lg py-sm bg-primary text-white rounded-xl font-semibold text-body hover:bg-primary-dark transition-colors"
                                >
                                    <Plus size={15} /> {t('incapacidades.action_registrar_primera')}
                                </button>
                            )}
                        </div>
                    ) : (
                        <section className="flex flex-col gap-3">
                            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
                                <div className="flex flex-col sm:flex-row gap-2 flex-1">
                                    <input
                                        type="text"
                                        value={filtroBusqueda}
                                        onChange={(e) => setFiltroBusqueda(e.target.value)}
                                        placeholder={t('incapacidades.filtro_busqueda_placeholder')}
                                        className="flex-1 rounded-md border border-border bg-white px-3 py-2 text-sm"
                                    />
                                    <select
                                        value={filtroTipo}
                                        onChange={(e) => setFiltroTipo(e.target.value as TipoIncapacidad | 'todos')}
                                        className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                                    >
                                        <option value="todos">{t('incapacidades.filtro_tipo_todos')}</option>
                                        <option value="enfermedad_comun">{t('incapacidades.tipo_enfermedad_comun')}</option>
                                        <option value="accidente_trabajo">{t('incapacidades.tipo_accidente_trabajo')}</option>
                                        <option value="maternidad">{t('incapacidades.tipo_maternidad')}</option>
                                    </select>
                                    <select
                                        value={filtroSubsidio}
                                        onChange={(e) => setFiltroSubsidio(e.target.value as 'todos' | 'con_subsidio' | 'sin_subsidio')}
                                        className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                                    >
                                        <option value="todos">{t('incapacidades.filtro_subsidio_todos')}</option>
                                        <option value="con_subsidio">{t('incapacidades.stat_con_subsidio')}</option>
                                        <option value="sin_subsidio">{t('incapacidades.stat_sin_subsidio')}</option>
                                    </select>
                                    {hayFiltrosActivos && (
                                        <button
                                            type="button"
                                            onClick={handleLimpiarFiltros}
                                            className="flex items-center gap-xs px-md py-2 text-sm font-semibold text-text-secondary hover:text-heading transition-colors shrink-0"
                                        >
                                            <X size={14} /> {t('incapacidades.action_limpiar_filtros')}
                                        </button>
                                    )}
                                </div>
                                {!quincenaCerrada && (
                                    <Button type="button" onClick={() => setShowModal(true)} className="flex items-center gap-1.5 shrink-0">
                                        <Plus size={16} /> {t('incapacidades.action_registrar')}
                                    </Button>
                                )}
                            </div>

                            {registrosFiltrados.length === 0 ? (
                                <p className="text-caption text-text-secondary italic">{t('incapacidades.listado_sin_resultados')}</p>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    {registrosFiltrados.map((r) => (
                                        <IncapacidadCard
                                            key={r.id}
                                            registro={r}
                                            nombreEmpleado={nombreEmpleado(r.empleado_id)}
                                            codigoEmpleado={codigoEmpleado(r.empleado_id)}
                                            textoCobertura={textoCoberturaPara(r.tipo, r.con_subsidio)}
                                            quincenaCerrada={quincenaCerrada}
                                            cantidadAdjuntos={adjuntosPorRegistro.get(r.id) ?? 0}
                                            onAdjuntos={() => setAdjuntosAbiertoPara(r)}
                                            onEditar={() => handleEditar(r)}
                                            onEliminar={() => setEliminarObjetivo(r)}
                                        />
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                    {error && <p className="text-caption text-error">{error}</p>}
                </>
            )}

            {showModal && (
                <IncapacidadModal
                    empleados={empleados}
                    quincenaId={quincenaId}
                    quincenaFechaInicio={quincena?.fecha_inicio}
                    quincenaFechaFin={quincena?.fecha_fin}
                    registroExistente={editTarget}
                    onClose={() => { setShowModal(false); setEditTarget(null); }}
                    onSaved={handleSaved}
                />
            )}

            <ConfirmModal
                isOpen={eliminarObjetivo !== null}
                onClose={() => setEliminarObjetivo(null)}
                onConfirm={handleConfirmarEliminar}
                title={t('incapacidades.eliminar_confirm_title')}
                message={eliminarObjetivo ? t('incapacidades.eliminar_confirm_message', { empleado: nombreEmpleado(eliminarObjetivo.empleado_id), numeroCit: eliminarObjetivo.numero_cit }) : ''}
                confirmLabel={t('incapacidades.eliminar_confirm_action')}
                cancelLabel={t('incapacidades.action_cancelar')}
                variant="danger"
                Icon={Trash2}
                isLoading={isEliminando}
            />

            {adjuntosAbiertoPara && (
                <ViaticoAdjuntosModal
                    tipoRegistro="incapacidad"
                    registroId={adjuntosAbiertoPara.id}
                    nombreRegistro={nombreEmpleado(adjuntosAbiertoPara.empleado_id)}
                    onClose={() => setAdjuntosAbiertoPara(null)}
                />
            )}
        </div>
    );
};
