import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Minus, ChevronDown, ChevronUp, RefreshCw, Trash2, Search, Banknote, Pencil, ShieldCheck, PauseCircle, Paperclip, PackageOpen } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useToast } from '../../../context/ToastContext';
import { useQuincenasStore } from '../../../store/quincenasStore';
import { planillaEmpleadosService, type Empleado } from '../../../services/planillaEmpleadosService';
import { anticiposService, type Anticipo, type AnticipoPago } from '../../../services/anticiposService';
import { viaticoDocumentosService } from '../../../services/viaticoDocumentosService';
import type { Quincena } from '../../../services/quincenasService';
import { modulosQuincenaService } from '../../../services/modulosQuincenaService';
import { auditService } from '../../../services/auditService';
import { calcularMontoCuota, requiereAutorizacionGG, type TipoAnticipo } from '../../../utils/anticiposUtils';
import { armarScheduleCuotas, type EstadoCuotaSchedule } from '../../../utils/anticipoCuotasUtils';
import { encontrarQuincenaActiva } from '../../../utils/quincenaUtils';
import { usePlanillaContext } from './PlanillaLayout';
import { Button } from '../../components/Button';
import { InputField } from '../../components/InputField';
import { ConfirmModal } from '../../components/ConfirmModal';
import { AnticipoModal } from './components/AnticipoModal';
import { ImportarAnticiposLoteModal } from './components/ImportarAnticiposLoteModal';
import { ViaticoAdjuntosModal } from './components/ViaticoAdjuntosModal';
import { Logger } from '../../../utils/logger';
import { getCodigoEmpleado } from '../../../utils/empleadoCodigoUtils';

type EstadoVisualAnticipo = 'activo' | 'saldado' | 'suspendido';

const BADGE_ESTADO: Record<EstadoVisualAnticipo, string> = {
    activo: 'bg-blue-50 text-blue-600 border border-blue-200',
    saldado: 'bg-primary-light text-primary border border-primary/20',
    suspendido: 'bg-surface text-text-secondary border border-border',
};

const BADGE_TIPO: Record<TipoAnticipo, string> = {
    salario: 'bg-blue-50 text-blue-600 border border-blue-200',
    vacaciones: 'bg-teal-50 text-teal-700 border border-teal-200',
    aguinaldo: 'bg-purple-50 text-purple-700 border border-purple-200',
};

// US-ANT-03 CA1 (defecto UAT) — badges de estado de cuota, mismos colores que el prototipo.
const BADGE_CUOTA: Record<EstadoCuotaSchedule, string> = {
    pagada: 'bg-primary-light text-primary',
    pendiente: 'bg-amber-50 text-amber-600',
    suspendida: 'bg-surface text-text-secondary',
};

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual'>;

interface AnticipoCardProps {
    r: Anticipo;
    nombreEmpleado: string;
    codigoEmpleado: string;
    estado: EstadoVisualAnticipo;
    expandido: boolean;
    onToggleExpandir: () => void;
    pagos: AnticipoPago[] | undefined;
    quincenasAplicables: Quincena[];
    quincenaActivaId: string | undefined;
    recalculando: boolean;
    onAbrirRecalcular: () => void;
    onCerrarRecalcular: () => void;
    nuevoNumeroCuotasForm: number;
    onCambiarNuevoNumeroCuotas: (n: number) => void;
    autorizadoGGRecalculo: boolean;
    onCambiarAutorizadoGGRecalculo: (v: boolean) => void;
    autorizadoGGPorRecalculo: string;
    onCambiarAutorizadoGGPorRecalculo: (v: string) => void;
    isRecalculando: boolean;
    onConfirmarRecalculo: () => void;
    suspendiendo: boolean;
    onAbrirSuspender: () => void;
    onCerrarSuspender: () => void;
    motivoSuspension: string;
    onCambiarMotivoSuspension: (v: string) => void;
    isSuspendiendo: boolean;
    onConfirmarSuspension: () => void;
    onEliminar: () => void;
    cantidadAdjuntos: number;
    onAdjuntos: () => void;
}

const AnticipoCard: React.FC<AnticipoCardProps> = ({
    r, nombreEmpleado, codigoEmpleado, estado, expandido, onToggleExpandir, pagos, quincenasAplicables, quincenaActivaId,
    recalculando, onAbrirRecalcular, onCerrarRecalcular, nuevoNumeroCuotasForm, onCambiarNuevoNumeroCuotas,
    autorizadoGGRecalculo, onCambiarAutorizadoGGRecalculo, autorizadoGGPorRecalculo, onCambiarAutorizadoGGPorRecalculo,
    isRecalculando, onConfirmarRecalculo, suspendiendo, onAbrirSuspender, onCerrarSuspender, motivoSuspension,
    onCambiarMotivoSuspension, isSuspendiendo, onConfirmarSuspension, onEliminar, cantidadAdjuntos, onAdjuntos,
}) => {
    const { t } = useTranslation();
    const pendiente = r.monto_total - r.monto_pagado;
    const porcentaje = Math.round((r.monto_pagado / r.monto_total) * 100);
    const nuevaCuotaPreview = nuevoNumeroCuotasForm > 0 ? calcularMontoCuota(pendiente, nuevoNumeroCuotasForm) : 0;

    // US-ANT-03 CA1 (defecto UAT) — detalle de cuotas COMPLETO: anteriores (reales, con evento),
    // la actual y las futuras (proyectadas si la quincena todavía no existe en la BD). El monto
    // se muestra en todas las filas (la última pagada puede ser parcial, CA2).
    const cuotas = armarScheduleCuotas(r.fecha_vale, r.monto_cuota, r.numero_cuotas, quincenasAplicables, pagos, r.estado);

    // US-ANT-04 CA1 (defecto UAT IMPL-151) — "Suspender esta quincena" es una acción propia en la
    // sección de acciones del detalle expandido (mismo diseño que el prototipo y que Eliminar).
    // Antes comparaba contra la quincena activa GLOBAL directo en `pagos`, sin mirar cuál es la
    // próxima cuota pendiente de ESTE anticipo — con 1 sola cuota nunca se notaba (en cuanto se
    // procesa, el anticipo pasa a 'saldado' y sale del universo), pero con varias cuotas, en
    // cuanto se procesaba la primera, ya había un evento para la quincena activa y el botón
    // desaparecía aunque quedaran cuotas futuras. Ahora deriva la quincena objetivo del propio
    // schedule (`cuotas`, ya calculado arriba): la primera fila real (no proyectada) todavía
    // pendiente. El INSERT queda igual de gateado server-side por la policy de quincena en_proceso.
    const proximaCuotaPendiente = cuotas.find((c) => c.estado === 'pendiente' && !c.esProyectada);
    const puedeSuspender = r.estado === 'activo' && pagos !== undefined && proximaCuotaPendiente?.key === quincenaActivaId;

    return (
        <div className={`bg-white rounded-xl border shadow-cards overflow-hidden transition-all ${expandido ? 'border-primary/30' : 'border-border'}`}>
            <div
                role="button"
                tabIndex={0}
                className="w-full text-left p-md flex flex-col gap-sm cursor-pointer"
                onClick={onToggleExpandir}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggleExpandir(); } }}
            >
                <div className="flex items-center justify-between gap-sm">
                    <div className="flex items-center gap-sm min-w-0">
                        <div className="w-9 h-9 rounded-full bg-primary-light flex items-center justify-center shrink-0">
                            <Banknote size={16} className="text-primary" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-body font-bold text-heading truncate">{nombreEmpleado}</p>
                            <p className="text-[11px] text-text-secondary font-mono">{codigoEmpleado} · {r.numero_vale}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${BADGE_TIPO[r.tipo]}`}>{t(`anticipos.tipo_${r.tipo}`)}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${BADGE_ESTADO[estado]}`}>{t(`anticipos.estado_${estado}`)}</span>
                        <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onAdjuntos(); }}
                            className={`relative p-1 transition-colors ${cantidadAdjuntos > 0 ? 'text-primary' : 'text-text-secondary hover:text-primary'}`}
                            title={t('viaticos.col_respaldo_tooltip')}
                        >
                            <Paperclip size={14} />
                            {cantidadAdjuntos > 0 && (
                                <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-primary text-white text-[9px] font-bold flex items-center justify-center">{cantidadAdjuntos}</span>
                            )}
                        </button>
                        {expandido ? <ChevronUp size={16} className="text-text-secondary" /> : <ChevronDown size={16} className="text-text-secondary" />}
                    </div>
                </div>

                <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-secondary">{t('anticipos.detalle_pagado')}: <span className="font-bold text-heading">${r.monto_pagado.toFixed(2)}</span></span>
                        <span className="font-bold text-heading">{porcentaje}%</span>
                    </div>
                    <div className="w-full bg-surface rounded-full h-2 overflow-hidden">
                        <div
                            className={`h-2 rounded-full transition-all duration-500 ${estado === 'saldado' ? 'bg-primary' : estado === 'suspendido' ? 'bg-border' : 'bg-blue-400'}`}
                            style={{ width: `${porcentaje}%` }}
                        />
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                        <span className="text-text-secondary">{t('anticipos.col_cuota')}: <span className="font-semibold text-heading">${r.monto_cuota.toFixed(2)}</span></span>
                        <span className="text-text-secondary">{t('anticipos.detalle_pendiente')}: <span className={`font-bold ${pendiente > 0 ? 'text-heading' : 'text-primary'}`}>${pendiente.toFixed(2)}</span></span>
                    </div>
                </div>
            </div>

            {expandido && (
                <div className="border-t border-border p-md flex flex-col gap-sm">
                    {requiereAutorizacionGG(r.tipo) && r.autorizado_gg && (
                        <div className="flex items-center gap-1.5 px-2 py-1 bg-primary-light rounded-lg border border-primary/20">
                            <ShieldCheck size={13} className="text-primary shrink-0" />
                            <span className="text-[11px] font-semibold text-primary">
                                {t('anticipos.field_autorizado_gg')}{r.autorizado_gg_por ? ` — ${r.autorizado_gg_por}` : ''}
                            </span>
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">
                            {t('anticipos.col_progreso')} — {r.numero_cuotas} {t('anticipos.field_numero_cuotas').toLowerCase()}
                        </p>
                        {r.estado === 'activo' && !recalculando && (
                            <button type="button" onClick={onAbrirRecalcular} className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                                <Pencil size={12} /> {t('anticipos.action_recalcular_cuotas')}
                            </button>
                        )}
                    </div>

                    {recalculando && (
                        <div className="flex flex-col gap-2 bg-surface rounded-xl border border-border p-md">
                            <div className="flex items-center gap-2">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.field_numero_cuotas')}</label>
                                <button type="button" onClick={() => onCambiarNuevoNumeroCuotas(Math.max(1, nuevoNumeroCuotasForm - 1))} className="p-1.5 rounded-md border border-border hover:bg-white">
                                    <Minus size={12} />
                                </button>
                                <span className="w-6 text-center font-semibold text-heading">{nuevoNumeroCuotasForm}</span>
                                <button type="button" onClick={() => onCambiarNuevoNumeroCuotas(nuevoNumeroCuotasForm + 1)} className="p-1.5 rounded-md border border-border hover:bg-white">
                                    <Plus size={12} />
                                </button>
                            </div>
                            <p className="text-[11px] text-text-secondary">{t('anticipos.cuota_preview', { monto: nuevaCuotaPreview.toFixed(2) })}</p>
                            {requiereAutorizacionGG(r.tipo) && (
                                <div className="flex flex-col gap-2 bg-amber-50/60 border border-amber-200 rounded-lg p-md">
                                    <label className="flex items-center gap-2 text-caption text-heading">
                                        <input type="checkbox" checked={autorizadoGGRecalculo} onChange={(e) => onCambiarAutorizadoGGRecalculo(e.target.checked)} />
                                        {t('anticipos.field_autorizado_gg')}
                                    </label>
                                    <InputField
                                        label={t('anticipos.field_autorizado_gg_por')}
                                        value={autorizadoGGPorRecalculo}
                                        onChange={(e) => onCambiarAutorizadoGGPorRecalculo(e.target.value)}
                                    />
                                </div>
                            )}
                            <div className="flex gap-2">
                                <Button type="button" isLoading={isRecalculando} onClick={onConfirmarRecalculo}>{t('anticipos.action_confirmar_recalculo')}</Button>
                                <Button type="button" variant="ghost" onClick={onCerrarRecalcular}>{t('anticipos.action_cancelar')}</Button>
                            </div>
                        </div>
                    )}

                    {!pagos ? (
                        <p className="text-[11px] text-text-secondary italic">{t('anticipos.detalle_cargando')}</p>
                    ) : cuotas.length === 0 ? (
                        <p className="text-[11px] text-text-secondary italic">{t('anticipos.detalle_sin_cuotas')}</p>
                    ) : (
                        <div className="rounded-xl border border-border overflow-hidden">
                            <table className="w-full text-left">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.detalle_col_quincena')}</th>
                                        <th className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('anticipos.detalle_col_monto')}</th>
                                        <th className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-text-secondary text-left">{t('anticipos.detalle_col_estado')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cuotas.map((c) => (
                                        <tr key={c.key} className="border-t border-border/40">
                                            <td className="px-3 py-2 text-[12px] text-text-secondary whitespace-nowrap">{c.etiqueta}</td>
                                            <td className="px-3 py-2 text-[12px] font-semibold text-heading text-right whitespace-nowrap">${c.monto.toFixed(2)}</td>
                                            <td className="px-3 py-2">
                                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${BADGE_CUOTA[c.estado]}`}>
                                                    {c.estado === 'suspendida' && c.motivoSuspension
                                                        ? t('anticipos.detalle_estado_suspendida', { motivo: c.motivoSuspension })
                                                        : t(`anticipos.detalle_estado_${c.estado}`)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-2 text-center">
                        {[
                            { label: t('anticipos.detalle_monto_total'), value: `$${r.monto_total.toFixed(2)}`, cls: 'text-heading' },
                            { label: t('anticipos.detalle_pagado'), value: `$${r.monto_pagado.toFixed(2)}`, cls: 'text-primary' },
                            { label: t('anticipos.detalle_pendiente'), value: `$${pendiente.toFixed(2)}`, cls: pendiente === 0 ? 'text-primary' : 'text-heading' },
                        ].map((s) => (
                            <div key={s.label} className="bg-surface rounded-lg p-2">
                                <p className="text-[9px] font-bold uppercase tracking-widest text-text-secondary">{s.label}</p>
                                <p className={`text-[13px] font-bold mt-0.5 ${s.cls}`}>{s.value}</p>
                            </div>
                        ))}
                    </div>

                    {puedeSuspender && (
                        <button type="button" onClick={onAbrirSuspender} className="flex items-center justify-center gap-1.5 w-full px-md py-2 border border-amber-200 bg-amber-50 text-amber-700 rounded-xl text-[13px] font-semibold hover:bg-amber-100 transition-colors">
                            <PauseCircle size={14} /> {t('anticipos.action_suspender_quincena')}
                        </button>
                    )}

                    {suspendiendo && (
                        <div className="flex flex-col gap-2 bg-amber-50/60 border border-amber-200 rounded-lg p-md">
                            <InputField label={t('anticipos.field_motivo_suspension')} value={motivoSuspension} onChange={(e) => onCambiarMotivoSuspension(e.target.value)} required />
                            <div className="flex gap-2">
                                <Button type="button" variant="warning" isLoading={isSuspendiendo} onClick={onConfirmarSuspension}>{t('anticipos.action_confirmar_suspension')}</Button>
                                <Button type="button" variant="ghost" onClick={onCerrarSuspender}>{t('anticipos.action_cancelar')}</Button>
                            </div>
                        </div>
                    )}

                    {r.monto_pagado === 0 && (
                        <button type="button" onClick={onEliminar} className="flex items-center justify-center gap-1.5 w-full px-md py-2 border border-red-200 bg-red-50 text-red-600 rounded-xl text-[13px] font-semibold hover:bg-red-100 transition-colors">
                            <Trash2 size={14} /> {t('anticipos.eliminar_confirm_action')}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

/**
 * Registrar Nuevo Anticipo (US-ANT-02 / IMPL-51) + Panel de Indicadores y Listado
 * (US-ANT-00 / IMPL-49) + Ciclo de Descuento por Quincena (US-ANT-03 / IMPL-52). A diferencia
 * de Horas Extras/Viáticos/Incapacidades, un anticipo no está escopeado a una quincena: vive
 * across-quincenas hasta saldarse (ver planilla-contexto.md).
 */
export const AnticiposView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { quincenas, fetchQuincenas } = useQuincenasStore();
    const { quincenaId } = usePlanillaContext();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [registros, setRegistros] = useState<Anticipo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filtroBusqueda, setFiltroBusqueda] = useState('');

    const [showModal, setShowModal] = useState(false);
    const [showLoteModal, setShowLoteModal] = useState(false);

    const [pagosQuincenaVista, setPagosQuincenaVista] = useState<AnticipoPago[]>([]);
    const [expandidoId, setExpandidoId] = useState<string | null>(null);
    const [pagosPorAnticipo, setPagosPorAnticipo] = useState<Record<string, AnticipoPago[]>>({});
    /** IMPL-173 (defecto UAT) — eventos de TODOS los anticipos (no solo el expandido), para poder
     * armar el schedule completo de cada tarjeta y filtrar el listado principal por la quincena
     * seleccionada. Independiente de `pagosPorAnticipo` (que alimenta el detalle expandible, que
     * nunca debe filtrarse — sigue mostrando todas las cuotas de todas las quincenas). */
    const [pagosTodos, setPagosTodos] = useState<AnticipoPago[]>([]);
    const [isProcesandoCuotas, setIsProcesandoCuotas] = useState(false);
    const [suspendiendoAnticipoId, setSuspendiendoAnticipoId] = useState<string | null>(null);
    const [motivoSuspension, setMotivoSuspension] = useState('');
    const [isSuspendiendo, setIsSuspendiendo] = useState(false);
    const [eliminarObjetivo, setEliminarObjetivo] = useState<Anticipo | null>(null);
    const [isEliminando, setIsEliminando] = useState(false);
    const [adjuntosAbiertoPara, setAdjuntosAbiertoPara] = useState<Anticipo | null>(null);
    /** IMPL-131 (Observación General UAT) — cantidad de adjuntos por registro, mismo patrón
     * batch (sin N+1) que KilometrajeSection/IncapacidadesView. */
    const [adjuntosPorRegistro, setAdjuntosPorRegistro] = useState<Map<string, number>>(new Map());

    const [recalculandoAnticipoId, setRecalculandoAnticipoId] = useState<string | null>(null);
    const [nuevoNumeroCuotasForm, setNuevoNumeroCuotasForm] = useState(1);
    const [autorizadoGGRecalculo, setAutorizadoGGRecalculo] = useState(false);
    const [autorizadoGGPorRecalculo, setAutorizadoGGPorRecalculo] = useState('');
    const [isRecalculando, setIsRecalculando] = useState(false);

    useEffect(() => { fetchQuincenas(); }, [fetchQuincenas]);

    // IMPL-156 (US-QNA-10) CA4 — "Procesar Cuotas"/"Suspender" ahora operan SIEMPRE sobre la
    // quincena explícitamente elegida en el selector compartido (`quincenaVista`), nunca sobre
    // una "activa" inferida por separado — eso era exactamente la causa raíz de IMPL-150 (cuota
    // agendada en la quincena siguiente). `quincenaActivaFallback` solo cubre el instante inicial
    // antes de que PlanillaLayout termine de fijar su selección por defecto.
    const quincenaActivaFallback = useMemo(() => encontrarQuincenaActiva(quincenas) ?? null, [quincenas]);
    const quincenaVista = useMemo(() => quincenas.find((q) => q.id === quincenaId) ?? quincenaActivaFallback, [quincenas, quincenaId, quincenaActivaFallback]);
    // Gap real (observación UAT, 2026-10-05) — "Registrar"/"Importar lote" no tenían ningún gate
    // por quincena cerrada, a diferencia de Vacaciones/Incapacidades/Bonificaciones/Otros
    // Ingresos/Permisos/Viáticos (que sí usan `!quincenaCerrada` desde `usePlanillaContext()`).
    // Acá se deriva de `quincenaVista` (no del `quincena` de contexto) para quedar consistente
    // con "Procesar Cuotas", que ya usa esta misma variable.
    const quincenaCerrada = quincenaVista?.estado === 'aprobada_cerrada';

    /** IMPL-173 — agrupa `pagosTodos` por anticipo para poder armar el schedule de cada uno sin
     * un fetch por tarjeta (mismo espíritu que `getPagosPorQuincena`, pero para TODAS las
     * quincenas de cada anticipo, que es lo que necesita `armarScheduleCuotas`). */
    const pagosPorAnticipoTodos = useMemo(() => {
        const map: Record<string, AnticipoPago[]> = {};
        for (const p of pagosTodos) {
            (map[p.anticipo_id] ??= []).push(p);
        }
        return map;
    }, [pagosTodos]);

    useEffect(() => {
        setIsLoading(true);
        Promise.all([planillaEmpleadosService.getEmpleadosActivos(), anticiposService.getTodos(), anticiposService.getPagosDeTodos()])
            .then(([emps, regs, pagos]) => { setEmpleados(emps); setRegistros(regs); setPagosTodos(pagos); })
            .catch((err: unknown) => {
                Logger.error('Error al cargar anticipos', {}, err);
                setError(t('anticipos.error_cargar'));
            })
            .finally(() => setIsLoading(false));
    }, [t]);

    useEffect(() => {
        if (registros.length === 0) {
            setAdjuntosPorRegistro(new Map());
            return;
        }
        let activo = true;
        viaticoDocumentosService.getPorRegistros('anticipo', registros.map((r) => r.id))
            .then((docs) => {
                if (!activo) return;
                const counts = new Map<string, number>();
                for (const d of docs) counts.set(d.registro_id, (counts.get(d.registro_id) ?? 0) + 1);
                setAdjuntosPorRegistro(counts);
            })
            .catch((err: unknown) => Logger.error('Error al cargar contadores de adjuntos de anticipos', {}, err));
        return () => { activo = false; };
    }, [registros]);

    useEffect(() => {
        if (!quincenaVista) { setPagosQuincenaVista([]); return; }
        anticiposService.getPagosPorQuincena(quincenaVista.id)
            .then(setPagosQuincenaVista)
            .catch((err: unknown) => Logger.error('Error al cargar eventos de la quincena vista', { quincenaId: quincenaVista.id }, err));
    }, [quincenaVista]);

    const nombreEmpleado = (empleadoId: string): string => empleados.find((e) => e.id === empleadoId)?.nombre_completo ?? empleadoId;

    /** IMPL-132 (Observación General UAT) — código de empleado junto al nombre en la lista,
     * mismo patrón ya usado para el número de Vale/CIT en otras columnas. */
    const codigoEmpleado = (empleadoId: string): string => {
        const emp = empleados.find((e) => e.id === empleadoId);
        return emp ? getCodigoEmpleado(emp) : '';
    };

    /** US-ANT-00 CA2 — el tercer valor visual ("Suspendido") se deriva viendo si existe un
     * evento de suspensión para la quincena que se está viendo; nunca se persiste como estado
     * permanente. */
    const estadoVisual = (r: Anticipo): EstadoVisualAnticipo => {
        if (r.estado === 'saldado') return 'saldado';
        const evento = pagosQuincenaVista.find((p) => p.anticipo_id === r.id);
        return evento?.tipo === 'suspension' ? 'suspendido' : 'activo';
    };

    const handleToggleExpandir = async (anticipoId: string) => {
        if (expandidoId === anticipoId) { setExpandidoId(null); return; }
        setExpandidoId(anticipoId);
        if (pagosPorAnticipo[anticipoId]) return;
        try {
            const pagos = await anticiposService.getPagosPorAnticipo(anticipoId);
            setPagosPorAnticipo((prev) => ({ ...prev, [anticipoId]: pagos }));
        } catch (err: unknown) {
            Logger.error('Error al cargar el detalle de cuotas', { anticipoId }, err);
        }
    };

    const handleProcesarCuotas = async () => {
        if (!quincenaVista || !profile?.id) return;
        setIsProcesandoCuotas(true);
        try {
            const procesados = await anticiposService.procesarCuotasQuincena(quincenaVista.id, profile.id);
            const [regs, pagos, pagosTodosNuevo] = await Promise.all([
                anticiposService.getTodos(),
                anticiposService.getPagosPorQuincena(quincenaVista.id),
                anticiposService.getPagosDeTodos(),
            ]);
            setRegistros(regs);
            setPagosQuincenaVista(pagos);
            setPagosTodos(pagosTodosNuevo);
            setPagosPorAnticipo({});
            if (profile?.tenant_id) {
                await modulosQuincenaService.confirmarModuloConDatos(profile.tenant_id, quincenaVista.id, 'anticipos', profile.id);
            }
            showToast(t('anticipos.toast_cuotas_procesadas', { count: procesados }), 'success');
        } catch (err: unknown) {
            Logger.error('Error al procesar cuotas de anticipos', { quincenaId: quincenaVista.id }, err);
            showToast(t('anticipos.error_procesar_cuotas'), 'error');
        } finally {
            setIsProcesandoCuotas(false);
        }
    };

    /** US-ANT-04 (IMPL-53) CA2 — no toca monto_pagado/estado del anticipo, solo registra el
     * evento de suspensión para la quincena explícitamente elegida (CA3: motivo obligatorio). */
    const handleConfirmarSuspension = async (anticipoId: string) => {
        if (!quincenaVista || !profile?.tenant_id || !profile.id) return;
        if (!motivoSuspension.trim()) {
            showToast(t('anticipos.error_motivo_suspension_requerido'), 'error');
            return;
        }
        setIsSuspendiendo(true);
        try {
            await anticiposService.suspenderCuota(profile.tenant_id, anticipoId, quincenaVista.id, motivoSuspension.trim(), profile.id);
            await auditService.logAction('SUSPENSION_DESCUENTO', 'planilla_anticipos', anticipoId, { quincenaId: quincenaVista.id, motivo: motivoSuspension.trim() });
            const [pagos, pagosQ, pagosTodosNuevo] = await Promise.all([
                anticiposService.getPagosPorAnticipo(anticipoId),
                anticiposService.getPagosPorQuincena(quincenaVista.id),
                anticiposService.getPagosDeTodos(),
            ]);
            setPagosPorAnticipo((prev) => ({ ...prev, [anticipoId]: pagos }));
            setPagosQuincenaVista(pagosQ);
            setPagosTodos(pagosTodosNuevo);
            showToast(t('anticipos.toast_suspendido'), 'success');
            setSuspendiendoAnticipoId(null);
            setMotivoSuspension('');
        } catch (err: unknown) {
            Logger.error('Error al suspender cuota de anticipo', { anticipoId, quincenaId: quincenaVista.id }, err);
            showToast(t('anticipos.error_suspender'), 'error');
        } finally {
            setIsSuspendiendo(false);
        }
    };

    /** US-ANT-05 (IMPL-54) CA1/CA2: el botón de eliminar en el listado ya solo se renderiza si
     * monto_pagado === 0 (ver JSX); la policy de DELETE es la autoridad final. CA3: auditado
     * automáticamente vía el trigger genérico ya definido en la migración de IMPL-51. */
    const handleConfirmarEliminar = async () => {
        if (!eliminarObjetivo) return;
        setIsEliminando(true);
        try {
            await anticiposService.eliminar(eliminarObjetivo.id);
            setRegistros((prev) => prev.filter((r) => r.id !== eliminarObjetivo.id));
            if (expandidoId === eliminarObjetivo.id) setExpandidoId(null);
            showToast(t('anticipos.toast_eliminado'), 'success');
            setEliminarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al eliminar anticipo', { id: eliminarObjetivo.id }, err);
            showToast(err instanceof Error ? err.message : t('anticipos.error_eliminar'), 'error');
        } finally {
            setIsEliminando(false);
        }
    };

    /** US-ANT-06 (IMPL-55) CA1/CA3: abre el editor inline precargado con los valores vigentes
     * del anticipo (incluida la autorización GG ya otorgada, si aplica). */
    const handleAbrirRecalcular = (r: Anticipo) => {
        setRecalculandoAnticipoId(r.id);
        setNuevoNumeroCuotasForm(r.numero_cuotas);
        setAutorizadoGGRecalculo(r.autorizado_gg);
        setAutorizadoGGPorRecalculo(r.autorizado_gg_por ?? '');
    };

    const handleConfirmarRecalculo = async (r: Anticipo) => {
        if (requiereAutorizacionGG(r.tipo) && !autorizadoGGRecalculo) {
            showToast(t('anticipos.error_autorizacion_gg_requerida'), 'error');
            return;
        }
        setIsRecalculando(true);
        try {
            const actualizado = await anticiposService.recalcularCuotas(r.id, nuevoNumeroCuotasForm, autorizadoGGRecalculo, autorizadoGGPorRecalculo.trim() || null);
            setRegistros((prev) => prev.map((x) => (x.id === r.id ? actualizado : x)));
            showToast(t('anticipos.toast_recalculado'), 'success');
            setRecalculandoAnticipoId(null);
        } catch (err: unknown) {
            Logger.error('Error al recalcular cuotas de anticipo', { anticipoId: r.id }, err);
            showToast(t('anticipos.error_recalcular'), 'error');
        } finally {
            setIsRecalculando(false);
        }
    };

    /** US-ANT-00 (IMPL-49) CA1 — RESUELTO (revisión épica por épica): "Por Cobrar Esta
     * Quincena" ya excluye a los activos que tienen un evento (pago o suspensión) registrado
     * para la quincena que se está viendo en `planilla_anticipo_pagos` (IMPL-52) — un anticipo con
     * evento 'pago' ya se cobró, y uno con 'suspension' no se va a cobrar esa quincena. */
    const indicadores = useMemo(() => {
        const activos = registros.filter((r) => r.estado === 'activo');
        const idsConEvento = new Set(pagosQuincenaVista.map((p) => p.anticipo_id));
        const ahora = new Date();
        const prefijoMesActual = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}`;
        return {
            totalActivosMonto: activos.reduce((sum, r) => sum + r.monto_total, 0),
            totalActivosCount: activos.length,
            porCobrarQuincena: activos.filter((r) => !idsConEvento.has(r.id)).reduce((sum, r) => sum + r.monto_cuota, 0),
            saldadosEsteMesCount: registros.filter((r) => r.estado === 'saldado' && r.updated_at.startsWith(prefijoMesActual)).length,
        };
    }, [registros, pagosQuincenaVista]);

    /** IMPL-173 (defecto UAT máxima prioridad) — el listado principal solo debe mostrar una
     * tarjeta si AL MENOS UNA de sus cuotas (pagada o pendiente) cae en la quincena seleccionada
     * en el selector de arriba; el detalle expandible de cuotas (`AnticipoCard`, vía
     * `pagosPorAnticipo`) sigue mostrando el calendario COMPLETO sin tocarse. Antes `registros`
     * se pintaba directo sin ningún cruce contra `quincenaVista` — el selector no afectaba en
     * absoluto qué tarjetas aparecían. */
    const registrosQuincena = useMemo(() => {
        if (!quincenaVista) return registros;
        return registros.filter((r) => {
            const cuotas = armarScheduleCuotas(r.fecha_vale, r.monto_cuota, r.numero_cuotas, quincenas, pagosPorAnticipoTodos[r.id], r.estado);
            return cuotas.some((c) => c.key === quincenaVista.id);
        });
    }, [registros, pagosPorAnticipoTodos, quincenas, quincenaVista]);

    /** CA3 — búsqueda por nombre/código de empleado sobre el listado (mismo patrón que
     * Incapacidades US-INC-05), client-side, sin debounce (mismo criterio ya documentado). */
    const registrosFiltrados = useMemo(() => {
        const termino = filtroBusqueda.trim().toLowerCase();
        if (!termino) return registrosQuincena;
        return registrosQuincena.filter((r) => {
            const emp = empleados.find((e) => e.id === r.empleado_id);
            return emp?.nombre_completo.toLowerCase().includes(termino) || (emp && getCodigoEmpleado(emp).toLowerCase().includes(termino)) || r.numero_vale.toLowerCase().includes(termino);
        });
    }, [registrosQuincena, empleados, filtroBusqueda]);

    const handleAnticipoGuardado = (creado: Anticipo) => {
        setRegistros((prev) => [creado, ...prev]);
        showToast(t('anticipos.toast_guardado'), 'success');
    };

    const handleLoteImportado = (creados: Anticipo[]) => {
        setRegistros((prev) => [...creados, ...prev]);
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {isLoading ? (
                <div className="h-32 bg-surface rounded-lg animate-pulse" />
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-md">
                        <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.stat_total_activos')}</p>
                            <p className="text-[1.75rem] font-bold mt-xs text-heading">${indicadores.totalActivosMonto.toFixed(2)}</p>
                            <p className="text-caption text-text-secondary">{t('anticipos.stat_total_activos_sub', { count: indicadores.totalActivosCount })}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.stat_por_cobrar')}</p>
                            <p className="text-[1.75rem] font-bold mt-xs text-primary">${indicadores.porCobrarQuincena.toFixed(2)}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('anticipos.stat_saldados_mes')}</p>
                            <p className="text-[1.75rem] font-bold mt-xs text-heading">{indicadores.saldadosEsteMesCount}</p>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2">
                        {quincenaVista?.estado === 'en_proceso' && (
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={handleProcesarCuotas}
                                isLoading={isProcesandoCuotas}
                                className="flex items-center gap-1.5"
                            >
                                <RefreshCw size={16} /> {t('anticipos.action_procesar_cuotas')}
                            </Button>
                        )}
                        {!quincenaCerrada && (
                            <Button type="button" variant="secondary" onClick={() => setShowLoteModal(true)} className="flex items-center gap-1.5">
                                <PackageOpen size={16} /> {t('anticipos.action_lote')}
                            </Button>
                        )}
                        {!quincenaCerrada && (
                            <Button type="button" onClick={() => setShowModal(true)} className="flex items-center gap-1.5">
                                <Plus size={16} /> {t('anticipos.action_registrar')}
                            </Button>
                        )}
                    </div>

                    {registros.length === 0 ? (
                        <p className="text-caption text-text-secondary italic">{t('anticipos.listado_empty')}</p>
                    ) : (
                        <div className="flex flex-col gap-sm">
                            <div className="relative">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
                                <input
                                    type="text"
                                    value={filtroBusqueda}
                                    onChange={(e) => setFiltroBusqueda(e.target.value)}
                                    placeholder={t('anticipos.filtro_busqueda_placeholder')}
                                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-white text-sm shadow-cards focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-colors"
                                />
                            </div>

                            <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">
                                {filtroBusqueda.trim()
                                    ? t('anticipos.listado_resultados_count', { count: registrosFiltrados.length })
                                    : t('anticipos.listado_contador', { count: registrosQuincena.length })}
                            </p>

                            {registrosFiltrados.length === 0 ? (
                                <div className="bg-white rounded-xl border border-border shadow-cards p-xl flex flex-col items-center gap-2 text-center">
                                    <Search size={22} className="text-text-secondary" />
                                    <p className="text-body font-bold text-heading">{t('anticipos.listado_sin_resultados_title')}</p>
                                    <p className="text-[12px] text-text-secondary">
                                        {filtroBusqueda.trim() ? t('anticipos.listado_sin_resultados') : t('anticipos.listado_sin_resultados_quincena')}
                                    </p>
                                </div>
                            ) : (
                                <div className="flex flex-col gap-sm">
                                    {registrosFiltrados.map((r) => (
                                        <AnticipoCard
                                            key={r.id}
                                            r={r}
                                            nombreEmpleado={nombreEmpleado(r.empleado_id)}
                                            codigoEmpleado={codigoEmpleado(r.empleado_id)}
                                            estado={estadoVisual(r)}
                                            expandido={expandidoId === r.id}
                                            onToggleExpandir={() => handleToggleExpandir(r.id)}
                                            pagos={pagosPorAnticipo[r.id]}
                                            quincenasAplicables={quincenas}
                                            quincenaActivaId={quincenaVista?.id}
                                            recalculando={recalculandoAnticipoId === r.id}
                                            onAbrirRecalcular={() => handleAbrirRecalcular(r)}
                                            onCerrarRecalcular={() => setRecalculandoAnticipoId(null)}
                                            nuevoNumeroCuotasForm={nuevoNumeroCuotasForm}
                                            onCambiarNuevoNumeroCuotas={setNuevoNumeroCuotasForm}
                                            autorizadoGGRecalculo={autorizadoGGRecalculo}
                                            onCambiarAutorizadoGGRecalculo={setAutorizadoGGRecalculo}
                                            autorizadoGGPorRecalculo={autorizadoGGPorRecalculo}
                                            onCambiarAutorizadoGGPorRecalculo={setAutorizadoGGPorRecalculo}
                                            isRecalculando={isRecalculando}
                                            onConfirmarRecalculo={() => handleConfirmarRecalculo(r)}
                                            suspendiendo={suspendiendoAnticipoId === r.id}
                                            onAbrirSuspender={() => { setSuspendiendoAnticipoId(r.id); setMotivoSuspension(''); }}
                                            onCerrarSuspender={() => setSuspendiendoAnticipoId(null)}
                                            motivoSuspension={motivoSuspension}
                                            onCambiarMotivoSuspension={setMotivoSuspension}
                                            isSuspendiendo={isSuspendiendo}
                                            onConfirmarSuspension={() => handleConfirmarSuspension(r.id)}
                                            onEliminar={() => setEliminarObjetivo(r)}
                                            cantidadAdjuntos={adjuntosPorRegistro.get(r.id) ?? 0}
                                            onAdjuntos={() => setAdjuntosAbiertoPara(r)}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                    {error && <p className="text-caption text-error">{error}</p>}
                </>
            )}

            <ConfirmModal
                isOpen={eliminarObjetivo !== null}
                onClose={() => setEliminarObjetivo(null)}
                onConfirm={handleConfirmarEliminar}
                title={t('anticipos.eliminar_confirm_title')}
                message={eliminarObjetivo ? t('anticipos.eliminar_confirm_message', { empleado: nombreEmpleado(eliminarObjetivo.empleado_id), numeroVale: eliminarObjetivo.numero_vale }) : ''}
                confirmLabel={t('anticipos.eliminar_confirm_action')}
                cancelLabel={t('anticipos.action_cancelar')}
                variant="danger"
                Icon={Trash2}
                isLoading={isEliminando}
            />

            {showModal && (
                <AnticipoModal
                    empleados={empleados}
                    quincenaActivaFechaInicio={quincenaVista?.fecha_inicio}
                    quincenaActivaFechaFin={quincenaVista?.fecha_fin}
                    onClose={() => setShowModal(false)}
                    onSaved={handleAnticipoGuardado}
                />
            )}

            {showLoteModal && (
                <ImportarAnticiposLoteModal
                    empleados={empleados}
                    onClose={() => setShowLoteModal(false)}
                    onImportado={handleLoteImportado}
                />
            )}

            {adjuntosAbiertoPara && (
                <ViaticoAdjuntosModal
                    tipoRegistro="anticipo"
                    registroId={adjuntosAbiertoPara.id}
                    nombreRegistro={nombreEmpleado(adjuntosAbiertoPara.empleado_id)}
                    onClose={() => setAdjuntosAbiertoPara(null)}
                />
            )}
        </div>
    );
};
