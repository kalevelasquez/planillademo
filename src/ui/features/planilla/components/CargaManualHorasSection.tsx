import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock, AlertTriangle, ChevronDown, ChevronUp, UserPlus, RotateCcw, CheckCircle2 } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { horasExtrasManualService } from '../../../../services/horasExtrasManualService';
import { saldoHorasNegativasService } from '../../../../services/saldoHorasNegativasService';
import { marcacionesService } from '../../../../services/marcacionesService';
import { planillaEmpleadosService, type Empleado } from '../../../../services/planillaEmpleadosService';
import { modulosQuincenaService, type QuincenaModuloUbicacionEstado } from '../../../../services/modulosQuincenaService';
import { auditService } from '../../../../services/auditService';
import { calcularMontoHorasExtras, horasEnTramo } from '../../../../utils/horasExtrasUtils';
import { ROLES } from '../../../../config/constants';
import { Button } from '../../../components/Button';
import { BotonSinHorasExtraUbicacion } from './BotonSinHorasExtraUbicacion';
import { ConfirmModal } from '../../../components/ConfirmModal';
import { Logger } from '../../../../utils/logger';
import { useDebounce } from '../../../../hooks/useDebounce';
import type { Quincena } from '../../../../services/quincenasService';

interface CargaManualHorasSectionProps {
    ubicacionId: string;
    ubicacionNombre: string;
    quincena: Quincena | null;
    /** Gap real (observación UAT, 2026-10-05) — el único gate que existía acá era
     * `ubicacionEstado?.estado === 'completado'` (por ubicación), nunca el estado de la
     * quincena. El autoguardado es silencioso (se dispara con solo tipear, sin tocar
     * "Confirmar"): si la quincena quedaba `aprobada_cerrada` sin que esta ubicación hubiera
     * confirmado, los inputs seguían editables y persistían cambios solos. */
    quincenaCerrada: boolean;
}

interface FilaHoras {
    empleadoId: string;
    nombreCompleto: string;
    sueldoMensual: number | null;
    horasRegulares: number;
    hed: number;
    hen: number;
    nocturnidad: number;
    feriado: number;
    agregadoManualmente?: boolean;
    /** US-HEX-11 CA1 — saldo corriente de horas negativas pendientes (tabla dedicada, no scoped
     * a esta quincena, ver `saldoHorasNegativasService`). NO entra en `CAMPOS_EDITABLES`: su
     * guardado es independiente del autoguardado por lote de abajo (servicio propio, sin
     * `calcularMontoHorasExtras`). */
    saldoHorasNegativas: number;
}

// CA1 (US-HEX-06) — "Horas Regulares" se captura igual que HED/HEN/Nocturnidad/Feriado, pero es
// puramente informativa: no entra en `calcularMontoHorasExtras` (ver uso más abajo), por eso
// vive en su propio tipo en vez de mezclarse con `CampoHoras`.
type CampoHoras = 'hed' | 'hen' | 'nocturnidad' | 'feriado';
type CampoEditable = 'horasRegulares' | CampoHoras;
const CAMPOS: CampoHoras[] = ['hed', 'hen', 'nocturnidad', 'feriado'];
const CAMPOS_EDITABLES: CampoEditable[] = ['horasRegulares', ...CAMPOS];
// La key de traducción de "Horas Regulares" es snake_case (compartida con Reloj Marcador,
// `horasExtras.col_horas_regulares`) — no calza con el patrón `col_${campo}` que sí funciona
// para hed/hen/nocturnidad/feriado.
const LABEL_KEY: Record<CampoEditable, string> = {
    horasRegulares: 'horasExtras.col_horas_regulares',
    hed: 'horasExtras.col_hed',
    hen: 'horasExtras.col_hen',
    nocturnidad: 'horasExtras.col_nocturnidad',
    feriado: 'horasExtras.col_feriado',
};
const UMBRAL_HORAS_QUINCENA = 120; // mismo umbral de CA3/US-HEX-04, combinando reloj + manual

interface FilaConMonto extends FilaHoras {
    montoTotal: number;
    sobre120h: boolean;
    sinSueldo: boolean;
}

function iniciales(nombreCompleto: string): string {
    return nombreCompleto.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

/**
 * Tarjeta colapsable por empleado (fidelidad DEMO — US-UX-02), reemplaza la tabla con scroll
 * horizontal en mobile. Mismo patrón "tabla en desktop / tarjetas en mobile" ya confirmado en
 * 2 pantallas independientes del DEMO (esta y la tabla de departamentos del Aprobador de
 * Quincenas), no un capricho de una sola pantalla.
 */
const EmpleadoHorasCard: React.FC<{
    fila: FilaConMonto;
    onChange: (empleadoId: string, campo: CampoEditable, valor: string) => void;
    onChangeSaldo: (empleadoId: string, valor: string) => void;
    onBlurSaldo: (empleadoId: string, valor: number) => void;
    readOnly?: boolean;
}> = ({ fila, onChange, onChangeSaldo, onBlurSaldo, readOnly }) => {
    const { t } = useTranslation();
    const [expanded, setExpanded] = useState(false);

    return (
        <div className={`bg-white rounded-xl border shadow-cards overflow-hidden transition-colors ${fila.sobre120h ? 'border-amber-200' : 'border-border'}`}>
            <button type="button" className="w-full flex items-center gap-md px-md py-sm text-left" onClick={() => setExpanded((e) => !e)}>
                <div className="w-9 h-9 rounded-full bg-primary-light flex items-center justify-center text-primary font-bold text-[12px] shrink-0">
                    {iniciales(fila.nombreCompleto)}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-body font-semibold text-heading truncate">{fila.nombreCompleto}</p>
                    <div className="flex items-center gap-sm flex-wrap mt-0.5">
                        <span className="text-[12px] text-text-secondary">
                            {t('horasExtras.col_monto')}: <span className="font-bold text-heading">{fila.sinSueldo ? '—' : `$${fila.montoTotal.toFixed(2)}`}</span>
                        </span>
                        {fila.agregadoManualmente && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full bg-primary text-white">
                                <UserPlus size={9} /> {t('horasExtras.badge_agregado_manualmente')}
                            </span>
                        )}
                        {fila.sobre120h && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full bg-amber-100 text-amber-700">
                                <AlertTriangle size={9} /> {t('horasExtras.badge_sobre_120h')}
                            </span>
                        )}
                        {fila.sinSueldo && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full bg-error/10 text-error">
                                {t('horasExtras.badge_sin_sueldo')}
                            </span>
                        )}
                    </div>
                </div>
                {expanded ? <ChevronUp size={16} className="text-text-secondary shrink-0" /> : <ChevronDown size={16} className="text-text-secondary shrink-0" />}
            </button>
            {expanded && (
                <div className="border-t border-border px-md py-md grid grid-cols-2 gap-md">
                    {CAMPOS_EDITABLES.map((campo) => (
                        <div key={campo} className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t(LABEL_KEY[campo] as any)}</label>
                            {readOnly ? (
                                <p className="w-full px-md py-sm bg-surface border border-border rounded-lg text-body text-heading text-center">{fila[campo]}</p>
                            ) : (
                                <input
                                    type="number"
                                    min={0}
                                    step="0.5"
                                    value={fila[campo]}
                                    onChange={(e) => onChange(fila.empleadoId, campo, e.target.value)}
                                    className="w-full px-md py-sm bg-white border border-border rounded-lg text-body text-heading text-center focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-colors"
                                />
                            )}
                        </div>
                    ))}
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('horasExtras.col_saldo_horas_negativas')}</label>
                        {readOnly ? (
                            <p className="w-full px-md py-sm bg-surface border border-border rounded-lg text-body text-heading text-center">{fila.saldoHorasNegativas}</p>
                        ) : (
                            <input
                                type="number"
                                min={0}
                                step="0.5"
                                value={fila.saldoHorasNegativas}
                                onChange={(e) => onChangeSaldo(fila.empleadoId, e.target.value)}
                                onBlur={() => onBlurSaldo(fila.empleadoId, fila.saldoHorasNegativas)}
                                title={t('horasExtras.saldo_horas_negativas_ayuda')}
                                className="w-full px-md py-sm bg-white border border-border rounded-lg text-body text-heading text-center focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-colors"
                            />
                        )}
                    </div>
                    <div className="col-span-2 flex items-center justify-between bg-surface rounded-lg px-md py-sm">
                        <span className="text-[12px] text-text-secondary font-semibold">{t('horasExtras.col_monto')}</span>
                        <span className="text-body font-bold text-heading">{fila.sinSueldo ? '—' : `$${fila.montoTotal.toFixed(2)}`}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

/**
 * Carga Manual de Horas Extra (US-HEX-06), contraparte de ImportacionMarcacionesSection para
 * ubicaciones con modalidad_captura = 'manual'. CA2 usa `calcularMontoHorasExtras` (misma
 * fuente de tarifas que el algoritmo de reloj). El chequeo de >120h (CA3) combina lo ya
 * persistido en planilla_marcaciones (otras ubicaciones reloj) con las horas que se están
 * editando acá — no cruza con otras quincenas.
 */
export const CargaManualHorasSection: React.FC<CargaManualHorasSectionProps> = ({ ubicacionId, ubicacionNombre, quincena, quincenaCerrada }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();

    
    const [ubicacionEstado, setUbicacionEstado] = useState<QuincenaModuloUbicacionEstado | null>(null);
    const [isLoadingModulo, setIsLoadingModulo] = useState(true);

    // IMPL-124 — reabrir esta ubicación mientras la quincena sigue en_proceso, sin pasar por
    // reabrir_quincena (desproporcionado para corregir un solo dato).
    const [mostrarFormReapertura, setMostrarFormReapertura] = useState(false);
    const [motivoReapertura, setMotivoReapertura] = useState('');
    const [isReabriendo, setIsReabriendo] = useState(false);
    const [errorReabrir, setErrorReabrir] = useState<string | null>(null);

    const [filas, setFilas] = useState<FilaHoras[]>([]);
    const [horasRelojPorEmpleado, setHorasRelojPorEmpleado] = useState<Map<string, number>>(new Map());
    const [empleadosSinUbicacion, setEmpleadosSinUbicacion] = useState(0);
    const [isLoadingFilas, setIsLoadingFilas] = useState(true);
    const [isGuardando, setIsGuardando] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showConfirmModal, setShowConfirmModal] = useState(false);
    // IMPL-148 (hallazgo UAT) — el guardado por fila es silencioso (sin spinner de boton), asi
    // que solo importa marcar visualmente que hubo edicion sin confirmar todavia.
    const [huboAutoguardado, setHuboAutoguardado] = useState(false);
    // Evita autoguardar el snapshot recien cargado del servidor antes de que el usuario toque algo.
    const huboEdicionUsuario = useRef(false);

    // US-HEX-07 (mismo patrón ya construido en ImportacionMarcacionesSection) — búsqueda
    // tenant-wide para cargar horas de un empleado que no está asignado a esta ubicación
    // (gap ya documentado en horasExtrasManualService.getEmpleadosPorUbicacion).
    const [busquedaTexto, setBusquedaTexto] = useState('');
    const [busquedaAbierta, setBusquedaAbierta] = useState(false);
    const [resultadosBusqueda, setResultadosBusqueda] = useState<Empleado[]>([]);
    const [isBuscando, setIsBuscando] = useState(false);
    const [errorAgregar, setErrorAgregar] = useState<string | null>(null);

    
    const quincenaId = quincena?.id ?? '';

    const quincenaSeleccionada = quincena;

    // IMPL-124 — mismos roles que pueden confirmar el módulo (completarUbicacion vía
    // handleGuardar), mismo criterio que la RLS de UPDATE en quincena_modulo_ubicacion_estado.
    const roles = Array.isArray(profile?.roles) ? profile.roles : profile?.role ? [profile.role] : [];
    const puedeReabrir = (roles.includes(ROLES.ADMIN) || roles.includes(ROLES.PREPARADOR_PLANILLA)) && quincenaSeleccionada?.estado === 'en_proceso';

    useEffect(() => {
        if (!quincenaId || !profile?.tenant_id) return;
        setIsLoadingModulo(true);
        Promise.all([
            modulosQuincenaService.inicializarEstados(profile.tenant_id, quincenaId),
            modulosQuincenaService.inicializarEstadosUbicacion(profile.tenant_id, quincenaId, [ubicacionId], 'horas_extras'),
        ])
            .then(([, estadosUbicacion]) => setUbicacionEstado(estadosUbicacion.find((e) => e.ubicacion_id === ubicacionId) ?? null))
            .catch((err: unknown) => Logger.error('Error al cargar estado de la ubicación para Horas Extras', { quincenaId, ubicacionId }, err))
            .finally(() => setIsLoadingModulo(false));
    }, [quincenaId, profile?.tenant_id, ubicacionId]);

    const handleReabrir = async () => {
        if (!quincenaSeleccionada || !motivoReapertura.trim()) return;
        setIsReabriendo(true);
        setErrorReabrir(null);
        try {
            const actualizado = await modulosQuincenaService.reabrirUbicacion(quincenaSeleccionada.id, ubicacionId, 'horas_extras', motivoReapertura.trim());
            await auditService.logAction('REAPERTURA_MODULO', 'quincena_modulo_ubicacion_estado', actualizado.id, {
                quincena_id: quincenaSeleccionada.id,
                ubicacion_id: ubicacionId,
                modulo: 'horas_extras',
                motivo: motivoReapertura.trim(),
            });
            setUbicacionEstado(actualizado);
            setMostrarFormReapertura(false);
            setMotivoReapertura('');
        } catch (err: unknown) {
            Logger.error('Error al reabrir el módulo de Horas Extras', { quincenaId: quincenaSeleccionada.id, ubicacionId }, err);
            setErrorReabrir(t('horasExtras.reabrir_error'));
        } finally {
            setIsReabriendo(false);
        }
    };

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoadingFilas(true);
        setError(null);
        Promise.all([
            horasExtrasManualService.getEmpleadosPorUbicacion(ubicacionId),
            horasExtrasManualService.getHorasGuardadas(quincenaId, ubicacionId),
            marcacionesService.getMarcacionesPorQuincena(quincenaId),
            planillaEmpleadosService.contarActivosSinUbicacion(),
        ])
            .then(async ([empleados, guardadas, marcaciones, sinUbicacion]) => {
                const guardadasPorEmpleado = new Map(guardadas.map((g) => [g.empleado_id, g]));
                const filasAsignados = empleados.map((e) => {
                    const g = guardadasPorEmpleado.get(e.id);
                    return {
                        empleadoId: e.id,
                        nombreCompleto: e.nombre_completo,
                        sueldoMensual: e.sueldo_mensual,
                        horasRegulares: g?.horas_regulares ?? 0,
                        hed: g?.hed ?? 0,
                        hen: g?.hen ?? 0,
                        nocturnidad: g?.nocturnidad ?? 0,
                        feriado: g?.feriado ?? 0,
                    };
                });

                // Horas ya guardadas para un empleado que no está (o dejó de estar) asignado a
                // esta ubicación — sin este merge, quedarían invisibles en la UI tras recargar,
                // aunque la fila siga existiendo en la base.
                const idsAsignados = new Set(empleados.map((e) => e.id));
                const idsHuerfanos = guardadas.map((g) => g.empleado_id).filter((id) => !idsAsignados.has(id));
                const empleadosHuerfanos = await Promise.all(idsHuerfanos.map((id) => planillaEmpleadosService.getEmpleadoById(id)));
                const filasHuerfanas = empleadosHuerfanos.map((e) => {
                    const g = guardadasPorEmpleado.get(e.id)!;
                    return {
                        empleadoId: e.id,
                        nombreCompleto: e.nombre_completo,
                        sueldoMensual: e.sueldo_mensual,
                        horasRegulares: g.horas_regulares,
                        hed: g.hed, hen: g.hen, nocturnidad: g.nocturnidad, feriado: g.feriado,
                        agregadoManualmente: true,
                    };
                });

                // US-HEX-11 CA1 — saldo corriente por empleado, no scoped a esta quincena (ver
                // saldoHorasNegativasService). Se busca recién acá, con la lista final de
                // asignados + huérfanos ya armada, porque el saldo aplica a ambos por igual.
                const todasLasFilas = [...filasAsignados, ...filasHuerfanas];
                const saldos = await saldoHorasNegativasService.getPorEmpleados(todasLasFilas.map((f) => f.empleadoId));
                const saldoPorEmpleado = new Map(saldos.map((s) => [s.empleado_id, s.saldo_horas]));
                setFilas(todasLasFilas.map((f) => ({ ...f, saldoHorasNegativas: saldoPorEmpleado.get(f.empleadoId) ?? 0 })));

                const horasPorEmpleado = new Map<string, number>();
                for (const m of marcaciones) {
                    horasPorEmpleado.set(m.empleado_id, (horasPorEmpleado.get(m.empleado_id) ?? 0) + horasEnTramo(m));
                }
                setHorasRelojPorEmpleado(horasPorEmpleado);
                setEmpleadosSinUbicacion(sinUbicacion);
            })
            .catch((err: unknown) => {
                Logger.error('Error al cargar horas extras manuales', { quincenaId, ubicacionId }, err);
                setError(t('horasExtras.manual_error_cargar'));
            })
            .finally(() => setIsLoadingFilas(false));
    }, [quincenaId, ubicacionId, t]);

    const actualizarHora = (empleadoId: string, campo: CampoEditable, valor: string) => {
        const numero = Math.max(0, Number(valor) || 0);
        huboEdicionUsuario.current = true;
        setFilas((prev) => prev.map((f) => (f.empleadoId === empleadoId ? { ...f, [campo]: numero } : f)));
    };

    // US-HEX-11 CA1 — edición y guardado independientes del lote de horas de arriba: este campo
    // vive en su propia tabla (sin quincena_id), así que no entra en `armarFilasParaGuardar` ni
    // en el autoguardado debounced por lote. Se guarda solo, al perder foco (onBlur), reusando
    // el mismo indicador silencioso `huboAutoguardado` para no agregar un segundo estado visual.
    const actualizarSaldoNegativo = (empleadoId: string, valor: string) => {
        const numero = Math.max(0, Number(valor) || 0);
        setFilas((prev) => prev.map((f) => (f.empleadoId === empleadoId ? { ...f, saldoHorasNegativas: numero } : f)));
    };

    const guardarSaldoNegativo = (empleadoId: string, valor: number) => {
        if (!profile?.id || !profile.tenant_id) return;
        saldoHorasNegativasService.actualizarSaldo(empleadoId, profile.tenant_id, valor, profile.id)
            .then(() => setHuboAutoguardado(true))
            .catch((err: unknown) => Logger.error('Error al guardar saldo de horas negativas pendiente', { empleadoId }, err));
    };

    useEffect(() => {
        const termino = busquedaTexto.trim();
        let cancelado = false;
        setIsBuscando(true);
        const timeoutId = window.setTimeout(() => {
            planillaEmpleadosService.getEmpleados(1, termino, undefined, 8)
                .then((res) => { if (!cancelado) setResultadosBusqueda(res.data); })
                .catch((err: unknown) => Logger.error('Error al buscar empleados para agregar', { termino }, err))
                .finally(() => { if (!cancelado) setIsBuscando(false); });
        }, 300);
        return () => { cancelado = true; window.clearTimeout(timeoutId); };
    }, [busquedaTexto]);

    const handleSeleccionarParaAgregar = async (empleado: Empleado) => {
        setErrorAgregar(null);
        if (filas.some((f) => f.empleadoId === empleado.id)) {
            setErrorAgregar(t('horasExtras.agregar_empleado_ya_en_lote'));
            return;
        }
        huboEdicionUsuario.current = true;
        // US-HEX-11 CA1 — este empleado puede ya tener un saldo de horas negativas cargado desde
        // otra pantalla/quincena (el saldo es por-empleado, no por-ubicación); se busca antes de
        // agregarlo para no mostrar 0 por defecto cuando en realidad ya existe un valor guardado.
        const saldos = await saldoHorasNegativasService.getPorEmpleados([empleado.id]);
        setFilas((prev) => [...prev, {
            empleadoId: empleado.id,
            nombreCompleto: empleado.nombre_completo,
            sueldoMensual: empleado.sueldo_mensual,
            horasRegulares: 0, hed: 0, hen: 0, nocturnidad: 0, feriado: 0,
            agregadoManualmente: true,
            saldoHorasNegativas: saldos[0]?.saldo_horas ?? 0,
        }]);
        setBusquedaTexto('');
        setResultadosBusqueda([]);
        setBusquedaAbierta(false);
    };

    const filasConMonto = useMemo(() => filas.map((f) => {
        const sinSueldo = f.sueldoMensual === null;
        const montoTotal = sinSueldo ? 0 : calcularMontoHorasExtras(f.sueldoMensual as number, { hed: f.hed, hen: f.hen, nocturnidad: f.nocturnidad, feriado: f.feriado }).montoTotal;
        const horasManuales = f.hed + f.hen + f.nocturnidad + f.feriado;
        const horasReloj = horasRelojPorEmpleado.get(f.empleadoId) ?? 0;
        const sobre120h = (horasReloj + horasManuales) > UMBRAL_HORAS_QUINCENA;
        return { ...f, montoTotal, sobre120h, sinSueldo };
    }), [filas, horasRelojPorEmpleado]);

    const montoGeneral = useMemo(() => filasConMonto.reduce((sum, f) => sum + f.montoTotal, 0), [filasConMonto]);
    // CA5 (hallazgo, IMPL-25): "Sin horas extra esta ubicación" también aplica cuando SÍ hay
    // empleados asignados pero ninguno generó horas — no solo cuando la ubicación está vacía.
    const todasLasFilasSinHoras = useMemo(
        () => filas.length > 0 && filas.every((f) => f.hed === 0 && f.hen === 0 && f.nocturnidad === 0 && f.feriado === 0),
        [filas],
    );

    /** Arma las filas en el formato que espera `guardarFilas`, a partir del snapshot que se le pase
     * (debounced para el autoguardado silencioso, o el mas reciente al confirmar). */
    const armarFilasParaGuardar = (snapshot: FilaConMonto[], ahora: string) => snapshot.map((f) => ({
        tenant_id: profile!.tenant_id as string,
        quincena_id: quincenaSeleccionada!.id,
        ubicacion_id: ubicacionId,
        empleado_id: f.empleadoId,
        horas_regulares: f.horasRegulares,
        hed: f.hed,
        hen: f.hen,
        nocturnidad: f.nocturnidad,
        feriado: f.feriado,
        monto_total: f.montoTotal,
        guardado_por: profile!.id,
        guardado_at: ahora,
    }));

    // IMPL-148 (hallazgo UAT) — autoguardado silencioso por fila, independiente de confirmar: antes
    // "Guardar Planta" guardaba Y confirmaba/bloqueaba la ubicacion en una sola accion, sin ningun
    // estado intermedio de borrador — riesgo real de perder ediciones si la sesion se interrumpe
    // mientras se llena una tabla de 20-50 empleados. `guardarFilas` (upsert por
    // quincena_id+ubicacion_id+empleado_id) ya persiste sin tocar el estado de confirmacion del
    // modulo, asi que alcanza con debouncear el snapshot editado y subirlo solo — sin disparar
    // `completarUbicacion`.
    const filasConMontoDebounced = useDebounce(filasConMonto, 800);
    useEffect(() => {
        if (!huboEdicionUsuario.current) return;
        if (!profile?.id || !profile.tenant_id || !quincenaSeleccionada) return;
        if (filasConMontoDebounced.length === 0) return;
        const rows = armarFilasParaGuardar(filasConMontoDebounced, new Date().toISOString());
        horasExtrasManualService.guardarFilas(rows)
            .then(() => setHuboAutoguardado(true))
            .catch((err: unknown) => Logger.error('Error en autoguardado de horas extras manuales', { quincenaId, ubicacionId }, err));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filasConMontoDebounced]);

    /** "Confirmar Horas Extras" (antes "Guardar Planta") — ahora es la unica accion que bloquea
     * la ubicacion. Vuelve a guardar el snapshot MAS RECIENTE (no el debounced) antes de confirmar,
     * para no depender del timing del autoguardado silencioso si el usuario edita y confirma rapido. */
    const handleConfirmar = async () => {
        if (!profile?.id || !profile.tenant_id || !quincenaSeleccionada) return;
        setIsGuardando(true);
        setError(null);
        try {
            const ahora = new Date().toISOString();
            await horasExtrasManualService.guardarFilas(armarFilasParaGuardar(filasConMonto, ahora));
            await modulosQuincenaService.completarUbicacion(quincenaSeleccionada.id, ubicacionId, 'horas_extras', profile.id);
            setUbicacionEstado((prev) => (prev ? { ...prev, estado: 'completado', completado_por: profile.id, completado_at: ahora } : prev));
            setShowConfirmModal(false);
        } catch (err: unknown) {
            Logger.error('Error al confirmar horas extras manuales', { quincenaId, ubicacionId }, err);
            setError(t('horasExtras.manual_error_guardar'));
        } finally {
            setIsGuardando(false);
        }
    };

    if (isLoadingModulo || isLoadingFilas) {
        return <div className="h-32 bg-surface rounded-lg animate-pulse" />;
    }

    // IMPL-149 (hallazgo UAT) — antes, confirmado el modulo, esto era un `return` que reemplazaba
    // TODO el contenido por el candado — sin ver los registros que quedaron guardados, el
    // Preparador no podia auditar nada, solo confiar a ciegas o reabrir sin saber si hacia falta.
    // Ahora el candado es un banner mas, y la tabla (con los mismos datos que ya se cargaban antes,
    // ver useEffect de arriba) se sigue mostrando debajo en modo solo lectura.
    const estaConfirmado = ubicacionEstado?.estado === 'completado';
    // Gap real (observación UAT, 2026-10-05) — ver comentario del prop `quincenaCerrada`. Todo lo
    // que controla edición/visibilidad de la tabla usa `bloqueado`, no `estaConfirmado` directo;
    // `estaConfirmado` se sigue usando solo donde importa saber si fue ESTE módulo el que se
    // confirmó (el mensaje del candado, y `puedeReabrir`, que ya excluye quincena cerrada porque
    // exige `estado === 'en_proceso'`).
    const bloqueado = estaConfirmado || quincenaCerrada;

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">

            {bloqueado && (
                <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-3 bg-surface rounded-lg p-md">
                        <Lock size={16} className="text-text-secondary shrink-0 mt-0.5" />
                        <p className="text-caption text-text-secondary">
                            {estaConfirmado
                                ? (ubicacionEstado?.via_sin_registros ? t('horasExtras.badge_sin_horas_extra') : t('horasExtras.manual_modulo_confirmado'))
                                : t('horasExtras.manual_quincena_cerrada')}
                        </p>
                    </div>

                    {puedeReabrir && !mostrarFormReapertura && (
                        <Button variant="outline-danger" onClick={() => setMostrarFormReapertura(true)} className="flex items-center gap-2 self-end">
                            <RotateCcw size={16} /> {t('horasExtras.action_reabrir')}
                        </Button>
                    )}

                    {puedeReabrir && mostrarFormReapertura && (
                        <div className="flex flex-col gap-2 bg-amber-50/60 border border-amber-200 rounded-lg p-md">
                            <label className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('horasExtras.field_motivo_reapertura')} <span className="text-error">*</span></label>
                            <textarea
                                value={motivoReapertura}
                                onChange={(e) => setMotivoReapertura(e.target.value)}
                                rows={3}
                                placeholder={t('horasExtras.motivo_reapertura_placeholder')}
                                className="w-full rounded-md border border-border bg-white p-sm text-body text-heading"
                            />
                            {errorReabrir && <p className="text-caption text-error">{errorReabrir}</p>}
                            <div className="flex justify-end gap-2">
                                <Button variant="ghost" onClick={() => { setMostrarFormReapertura(false); setMotivoReapertura(''); setErrorReabrir(null); }}>
                                    {t('quincenas.action_cancelar')}
                                </Button>
                                <Button variant="warning" disabled={!motivoReapertura.trim()} isLoading={isReabriendo} onClick={handleReabrir} className="flex items-center gap-2">
                                    <RotateCcw size={16} /> {t('horasExtras.action_confirmar_reapertura')}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {!bloqueado && empleadosSinUbicacion > 0 && (
                <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-md">
                    <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                    <p className="text-caption text-heading">{t('horasExtras.manual_advertencia_sin_ubicacion', { cantidad: empleadosSinUbicacion })}</p>
                </div>
            )}

            {error && <p className="text-caption text-error">{error}</p>}

            {filas.length === 0 && (
                <p className="text-body text-text-secondary text-center py-lg">{t('horasExtras.manual_sin_empleados', { ubicacion: ubicacionNombre })}</p>
            )}

            {filas.length > 0 && (
                <>
                    <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="text-[10px] font-bold uppercase tracking-widest text-text-secondary border-b border-border/50">
                                    <th className="py-2 pr-2">{t('horasExtras.col_nombre_completo')}</th>
                                    <th className="py-2 px-2">{t('horasExtras.col_horas_regulares')}</th>
                                    <th className="py-2 px-2">{t('horasExtras.col_hed')}</th>
                                    <th className="py-2 px-2">{t('horasExtras.col_hen')}</th>
                                    <th className="py-2 px-2">{t('horasExtras.col_nocturnidad')}</th>
                                    <th className="py-2 px-2">{t('horasExtras.col_feriado')}</th>
                                    <th className="py-2 px-2" title={t('horasExtras.saldo_horas_negativas_ayuda')}>{t('horasExtras.col_saldo_horas_negativas')}</th>
                                    <th className="py-2 pl-2 text-right">{t('horasExtras.col_monto')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filasConMonto.map((f) => (
                                    <tr key={f.empleadoId} className="border-b border-border/30 last:border-b-0">
                                        <td className="py-2 pr-2">
                                            <p className="font-medium text-heading">{f.nombreCompleto}</p>
                                            <div className="flex flex-wrap gap-1 mt-1">
                                                {f.agregadoManualmente && (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full bg-primary text-white">
                                                        <UserPlus size={9} /> {t('horasExtras.badge_agregado_manualmente')}
                                                    </span>
                                                )}
                                                {f.sobre120h && (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full bg-amber-100 text-amber-700">
                                                        <AlertTriangle size={9} /> {t('horasExtras.badge_sobre_120h')}
                                                    </span>
                                                )}
                                                {f.sinSueldo && (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full bg-error/10 text-error">
                                                        {t('horasExtras.badge_sin_sueldo')}
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        {CAMPOS_EDITABLES.map((campo) => (
                                            <td className="py-2 px-2" key={campo}>
                                                {bloqueado ? (
                                                    <span className="inline-block w-20 text-[13px] text-heading text-center">{f[campo]}</span>
                                                ) : (
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        step="0.5"
                                                        value={f[campo]}
                                                        onChange={(e) => actualizarHora(f.empleadoId, campo, e.target.value)}
                                                        className="w-20 rounded-md border border-border bg-white px-2 py-1 text-[13px]"
                                                    />
                                                )}
                                            </td>
                                        ))}
                                        <td className="py-2 px-2">
                                            {bloqueado ? (
                                                <span className="inline-block w-20 text-[13px] text-heading text-center">{f.saldoHorasNegativas}</span>
                                            ) : (
                                                <input
                                                    type="number"
                                                    min={0}
                                                    step="0.5"
                                                    value={f.saldoHorasNegativas}
                                                    onChange={(e) => actualizarSaldoNegativo(f.empleadoId, e.target.value)}
                                                    onBlur={() => guardarSaldoNegativo(f.empleadoId, f.saldoHorasNegativas)}
                                                    title={t('horasExtras.saldo_horas_negativas_ayuda')}
                                                    className="w-20 rounded-md border border-border bg-white px-2 py-1 text-[13px]"
                                                />
                                            )}
                                        </td>
                                        <td className="py-2 pl-2 text-right font-semibold text-heading">{f.sinSueldo ? '—' : `$${f.montoTotal.toFixed(2)}`}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr>
                                    <td colSpan={7} className="py-2 pr-2 text-right text-[11px] font-bold uppercase tracking-widest text-text-secondary">{t('horasExtras.manual_total_general')}</td>
                                    <td className="py-2 pl-2 text-right font-bold text-heading">${montoGeneral.toFixed(2)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <div className="flex flex-col gap-sm sm:hidden">
                        {filasConMonto.map((f) => (
                            <EmpleadoHorasCard
                                key={f.empleadoId}
                                fila={f}
                                onChange={actualizarHora}
                                onChangeSaldo={actualizarSaldoNegativo}
                                onBlurSaldo={guardarSaldoNegativo}
                                readOnly={bloqueado}
                            />
                        ))}
                        <div className="flex items-center justify-between px-md py-sm bg-surface rounded-lg">
                            <span className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">{t('horasExtras.manual_total_general')}</span>
                            <span className="text-body font-bold text-heading">${montoGeneral.toFixed(2)}</span>
                        </div>
                    </div>
                </>
            )}

            {/* US-HEX-07 (mismo patrón que ImportacionMarcacionesSection) — buscador tenant-wide
                para cargar horas de un empleado no asignado a esta ubicación. Se muestra siempre
                (incluso con la lista vacía), porque es justamente el caso donde más hace falta. */}
            {!bloqueado && (
                <div className="flex flex-col gap-2 bg-primary-light/10 border border-primary/20 rounded-lg p-md">
                    <div className="flex items-center gap-2">
                        <UserPlus size={16} className="text-primary" />
                        <p className="text-caption font-semibold text-heading">{t('horasExtras.agregar_empleado_title')}</p>
                    </div>
                    <div className="relative flex flex-col gap-1 max-w-[24rem]">
                        <input
                            type="text"
                            value={busquedaTexto}
                            onChange={(e) => setBusquedaTexto(e.target.value)}
                            onFocus={() => setBusquedaAbierta(true)}
                            onBlur={() => setTimeout(() => setBusquedaAbierta(false), 150)}
                            placeholder={t('horasExtras.agregar_empleado_buscar_placeholder')}
                            className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                        />
                        {busquedaAbierta && (
                            <div className="absolute top-full mt-1 w-full bg-white border border-border rounded-md shadow-cards z-10 max-h-52 overflow-y-auto">
                                {isBuscando ? (
                                    <p className="px-3 py-2 text-[12px] text-text-secondary">…</p>
                                ) : resultadosBusqueda.length === 0 ? (
                                    <p className="px-3 py-2 text-[12px] text-text-secondary">{t('horasExtras.agregar_empleado_sin_resultados')}</p>
                                ) : (
                                    resultadosBusqueda.map((e) => (
                                        <button
                                            key={e.id}
                                            type="button"
                                            onClick={() => handleSeleccionarParaAgregar(e)}
                                            className="w-full text-left px-3 py-2 text-[13px] hover:bg-surface"
                                        >
                                            {e.nombre_completo}{e.estado === 'inactivo' ? ` (${t('horasExtras.badge_inactivo')})` : ''}
                                        </button>
                                    ))
                                )}
                            </div>
                        )}
                    </div>
                    {errorAgregar && <p className="text-[11px] text-error">{errorAgregar}</p>}
                </div>
            )}

            {!bloqueado && filas.length > 0 && (
                <div className="flex items-center justify-end gap-sm self-end">
                    <Button onClick={() => setShowConfirmModal(true)} isLoading={isGuardando} className="flex items-center gap-2">
                        <CheckCircle2 size={16} /> {t('horasExtras.manual_action_confirmar', { ubicacion: ubicacionNombre })}
                    </Button>
                    {huboAutoguardado && (
                        <span className="text-[11px] text-text-secondary italic">{t('horasExtras.manual_autoguardado_indicador')}</span>
                    )}
                </div>
            )}

            {!bloqueado && (filas.length === 0 || todasLasFilasSinHoras) && (
                <BotonSinHorasExtraUbicacion
                    quincenaId={quincenaId}
                    ubicacionId={ubicacionId}
                    onConfirmado={() => setUbicacionEstado((prev) => (prev ? { ...prev, estado: 'completado', via_sin_registros: true, completado_por: profile?.id ?? null, completado_at: new Date().toISOString() } : prev))}
                />
            )}

            <ConfirmModal
                isOpen={showConfirmModal}
                onClose={() => setShowConfirmModal(false)}
                onConfirm={handleConfirmar}
                isLoading={isGuardando}
                title={t('horasExtras.manual_confirmar_modal_title')}
                message={t('horasExtras.manual_confirmar_modal_message', { ubicacion: ubicacionNombre })}
                confirmLabel={t('horasExtras.manual_action_confirmar', { ubicacion: ubicacionNombre })}
                cancelLabel={t('quincenas.action_cancelar')}
                variant="warning"
                Icon={CheckCircle2}
            />
        </section>
    );
};
