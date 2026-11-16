import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Search, ChevronDown, X, Upload } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { useToast } from '../../../context/ToastContext';
import { useQuincenasStore } from '../../../store/quincenasStore';
import { planillaEmpleadosService, type Empleado } from '../../../services/planillaEmpleadosService';
import { descuentoCategoriasService, type DescuentoCategoria } from '../../../services/descuentoCategoriasService';
import { descuentosService, type Descuento, type DescuentoEvento } from '../../../services/descuentosService';
import { modulosQuincenaService } from '../../../services/modulosQuincenaService';
import { auditService } from '../../../services/auditService';
import { esPenultimaCuota, type TipoDescuento } from '../../../utils/descuentosUtils';
import { encontrarQuincenaActiva } from '../../../utils/quincenaUtils';
import { usePlanillaContext } from './PlanillaLayout';
import { ImportarDescuentosModal } from './components/ImportarDescuentosModal';
import { Avatar } from '../../components/Avatar';
import { InputField } from '../../components/InputField';
import { Button } from '../../components/Button';
import { Logger } from '../../../utils/logger';
import { getCodigoEmpleado } from '../../../utils/empleadoCodigoUtils';

type EmpleadoActivo = Pick<Empleado, 'id' | 'nombre_completo' | 'cargo' | 'codigo' | 'codigo_empleado_manual' | 'foto_url'>;
type EstadoVisualDescuento = Descuento['estado'] | 'suspendido';

const BADGE_ESTADO: Record<EstadoVisualDescuento, string> = {
    activo: 'bg-surface text-text-secondary border border-border',
    pausado: 'bg-amber-50 text-amber-700 border border-amber-200',
    completado: 'bg-primary-light text-primary border border-primary/20',
    suspendido: 'bg-amber-50 text-amber-700 border border-amber-200',
    cancelado: 'bg-error/10 text-error border border-error/20',
};

const DOT_ESTADO: Record<EstadoVisualDescuento, string> = {
    activo: 'bg-text-secondary',
    pausado: 'bg-amber-400',
    completado: 'bg-primary',
    suspendido: 'bg-amber-400',
    cancelado: 'bg-error',
};

/**
 * Panel Consolidado de Descuentos por Quincena (US-DESC-00 / IMPL-57) + Suspensión por
 * Quincena (US-DESC-02 / IMPL-59, CA3: "mismo patrón que Anticipos US-ANT-04"). "Suspendido" es
 * un estado visual DERIVADO (no persistido) de un evento de suspensión para la quincena activa —
 * "Suspendidos Esta Quincena" (CA1) y el botón de cada fila (CA5) ya reflejan datos reales.
 */
export const DescuentosView: React.FC = () => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { quincenas, fetchQuincenas } = useQuincenasStore();
    const { quincenaId } = usePlanillaContext();

    const [empleados, setEmpleados] = useState<EmpleadoActivo[]>([]);
    const [categorias, setCategorias] = useState<DescuentoCategoria[]>([]);
    const [descuentos, setDescuentos] = useState<Descuento[]>([]);
    const [eventosQuincenaVista, setEventosQuincenaVista] = useState<DescuentoEvento[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const [filtroBusqueda, setFiltroBusqueda] = useState('');
    const [filtroTipo, setFiltroTipo] = useState<TipoDescuento | 'todos'>('todos');
    const [filtroEstado, setFiltroEstado] = useState<Descuento['estado'] | 'todos'>('todos');

    const [suspendiendoId, setSuspendiendoId] = useState<string | null>(null);
    const [motivoSuspension, setMotivoSuspension] = useState('');
    const [isSuspendiendo, setIsSuspendiendo] = useState(false);
    const [isProcesandoCuotas, setIsProcesandoCuotas] = useState(false);
    const [ajustandoMontoId, setAjustandoMontoId] = useState<string | null>(null);
    const [nuevoMontoAjuste, setNuevoMontoAjuste] = useState('');
    const [isAjustandoMonto, setIsAjustandoMonto] = useState(false);
    const [validandoId, setValidandoId] = useState<string | null>(null);
    const [mostrarImportar, setMostrarImportar] = useState(false);

    useEffect(() => { fetchQuincenas(); }, [fetchQuincenas]);

    // IMPL-156 (US-QNA-10) CA4 — "Procesar Cuotas"/"Suspender" ahora operan SIEMPRE sobre la
    // quincena explícitamente elegida en el selector compartido (`quincenaVista`), nunca sobre
    // una "activa" inferida por separado (causa raíz de IMPL-152: cuota en la quincena
    // equivocada). Ya no hace falta un segundo tracking de eventos para "la activa" — la vista
    // ES la que importa para todo, mostrar y actuar. `quincenaActivaFallback` solo cubre el
    // instante inicial antes de que PlanillaLayout termine de fijar su selección por defecto.
    const quincenaActivaFallback = useMemo(() => encontrarQuincenaActiva(quincenas) ?? null, [quincenas]);
    const quincenaVista = useMemo(() => quincenas.find((q) => q.id === quincenaId) ?? quincenaActivaFallback, [quincenas, quincenaId, quincenaActivaFallback]);

    useEffect(() => {
        setIsLoading(true);
        Promise.all([
            planillaEmpleadosService.getEmpleadosActivos(),
            descuentoCategoriasService.getTodos(),
            descuentosService.getTodos(),
        ])
            .then(([emps, cats, descs]) => { setEmpleados(emps); setCategorias(cats); setDescuentos(descs); })
            .catch((err: unknown) => Logger.error('Error al cargar el panel de descuentos', {}, err))
            .finally(() => setIsLoading(false));
    }, []);

    useEffect(() => {
        if (!quincenaVista) { setEventosQuincenaVista([]); return; }
        descuentosService.getEventosPorQuincena(quincenaVista.id)
            .then(setEventosQuincenaVista)
            .catch((err: unknown) => Logger.error('Error al cargar eventos de la quincena vista', { quincenaId: quincenaVista.id }, err));
    }, [quincenaVista]);

    const empleadoPorId = useMemo(() => new Map(empleados.map((e) => [e.id, e])), [empleados]);
    const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);

    const estadoVisual = (d: Descuento): EstadoVisualDescuento => {
        if (d.estado !== 'activo') return d.estado;
        const evento = eventosQuincenaVista.find((e) => e.descuento_id === d.id);
        return evento?.tipo === 'suspension' ? 'suspendido' : 'activo';
    };

    /** Revisión épica por épica (mismo fix ya aplicado en Anticipos/IMPL-49): "Por Descontar
     * Esta Quincena" excluye los descuentos que ya tienen un evento (pago o suspensión)
     * registrado para la quincena que se está viendo en `planilla_descuento_eventos` — un
     * descuento suspendido o ya procesado esa quincena no debería seguir contando como pendiente. */
    const indicadores = useMemo(() => {
        const idsConEvento = new Set(eventosQuincenaVista.map((e) => e.descuento_id));
        return {
            porDescontarQuincena: descuentos
                .filter((d) => d.estado === 'activo' && !idsConEvento.has(d.id))
                .reduce((sum, d) => sum + d.monto_quincenal, 0),
            suspendidosQuincena: descuentos.filter((d) => estadoVisual(d) === 'suspendido').length,
            completados: descuentos.filter((d) => d.estado === 'completado').length,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [descuentos, eventosQuincenaVista]);

    const descuentosFiltrados = useMemo(() => {
        const termino = filtroBusqueda.trim().toLowerCase();
        return descuentos.filter((d) => {
            const categoria = categoriaPorId.get(d.categoria_id);
            if (filtroTipo !== 'todos' && categoria?.tipo !== filtroTipo) return false;
            if (filtroEstado !== 'todos' && d.estado !== filtroEstado) return false;
            if (termino) {
                const emp = empleadoPorId.get(d.empleado_id);
                const coincide = emp?.nombre_completo.toLowerCase().includes(termino) || (!!emp && getCodigoEmpleado(emp).toLowerCase().includes(termino));
                if (!coincide) return false;
            }
            return true;
        });
    }, [descuentos, categoriaPorId, empleadoPorId, filtroTipo, filtroEstado, filtroBusqueda]);

    /** CA3 — agrupado por empleado, cada descuento como fila propia dentro de su grupo.
     * IMPL-135 (Observación General UAT) — los grupos se ordenan por el descuento más reciente
     * de cada empleado (no alfabético): `descuentosFiltrados` ya viene `created_at` descendente
     * desde `descuentosService.getTodos()`, así que el primer ítem de cada grupo es el más
     * reciente de ese empleado — se usa ese valor para ordenar los grupos entre sí. */
    const gruposPorEmpleado = useMemo(() => {
        const grupos = new Map<string, Descuento[]>();
        for (const d of descuentosFiltrados) {
            const lista = grupos.get(d.empleado_id) ?? [];
            lista.push(d);
            grupos.set(d.empleado_id, lista);
        }
        return [...grupos.entries()]
            .map(([empleadoId, items]) => ({ empleado: empleadoPorId.get(empleadoId), items }))
            .filter((g) => g.empleado)
            .sort((a, b) => b.items[0].created_at.localeCompare(a.items[0].created_at));
    }, [descuentosFiltrados, empleadoPorId]);

    const hayFiltrosActivos = filtroBusqueda.trim() !== '' || filtroTipo !== 'todos' || filtroEstado !== 'todos';
    const handleLimpiarFiltros = () => {
        setFiltroBusqueda('');
        setFiltroTipo('todos');
        setFiltroEstado('todos');
    };

    /** US-DESC-04 (IMPL-61) CA1 — procesa en bloque todos los descuentos con monto total
     * definido pendientes de esta quincena; la finalización a 'completado' ocurre server-side
     * dentro del RPC, sin acción manual adicional. */
    const handleProcesarCuotas = async () => {
        if (!quincenaVista || !profile?.id) return;
        setIsProcesandoCuotas(true);
        try {
            const procesados = await descuentosService.procesarCuotasQuincena(quincenaVista.id, profile.id);
            const [descs, eventos] = await Promise.all([
                descuentosService.getTodos(),
                descuentosService.getEventosPorQuincena(quincenaVista.id),
            ]);
            setDescuentos(descs);
            setEventosQuincenaVista(eventos);
            if (profile?.tenant_id) {
                await modulosQuincenaService.confirmarModuloConDatos(profile.tenant_id, quincenaVista.id, 'descuentos', profile.id);
            }
            showToast(t('descuentos.toast_cuotas_procesadas', { count: procesados }), 'success');
        } catch (err: unknown) {
            Logger.error('Error al procesar cuotas de descuentos', { quincenaId: quincenaVista.id }, err);
            showToast(t('descuentos.error_procesar_cuotas'), 'error');
        } finally {
            setIsProcesandoCuotas(false);
        }
    };

    const handleConfirmarSuspension = async (descuentoId: string) => {
        if (!quincenaVista || !profile?.tenant_id || !profile.id) return;
        if (!motivoSuspension.trim()) {
            showToast(t('descuentos.error_motivo_suspension_requerido'), 'error');
            return;
        }
        setIsSuspendiendo(true);
        try {
            await descuentosService.suspenderCuota(profile.tenant_id, descuentoId, quincenaVista.id, motivoSuspension.trim(), profile.id);
            await auditService.logAction('SUSPENSION_DESCUENTO', 'planilla_descuentos', descuentoId, { quincenaId: quincenaVista.id, motivo: motivoSuspension.trim() });
            const eventos = await descuentosService.getEventosPorQuincena(quincenaVista.id);
            setEventosQuincenaVista(eventos);
            showToast(t('descuentos.toast_suspendido'), 'success');
            setSuspendiendoId(null);
            setMotivoSuspension('');
        } catch (err: unknown) {
            Logger.error('Error al suspender cuota de descuento', { descuentoId, quincenaId: quincenaVista.id }, err);
            showToast(t('descuentos.error_suspender'), 'error');
        } finally {
            setIsSuspendiendo(false);
        }
    };

    /** US-DESC-03 (IMPL-60) CA2 — el Preparador confirma/ajusta el monto de la última cuota a
     * partir del badge "Penúltima cuota"; no hay sistema de notificaciones push en el proyecto,
     * así que la "notificación" es esta acción siempre visible junto al badge. */
    const handleConfirmarAjusteMonto = async (descuentoId: string) => {
        const nuevoMonto = Number(nuevoMontoAjuste);
        if (!nuevoMontoAjuste || nuevoMonto <= 0) {
            showToast(t('descuentos.error_monto_ajuste_invalido'), 'error');
            return;
        }
        setIsAjustandoMonto(true);
        try {
            const actualizado = await descuentosService.ajustarMontoQuincenal(descuentoId, nuevoMonto);
            setDescuentos((prev) => prev.map((d) => (d.id === descuentoId ? actualizado : d)));
            showToast(t('descuentos.toast_monto_ajustado'), 'success');
            setAjustandoMontoId(null);
            setNuevoMontoAjuste('');
        } catch (err: unknown) {
            Logger.error('Error al ajustar monto de descuento', { descuentoId }, err);
            showToast(t('descuentos.error_ajustar_monto'), 'error');
        } finally {
            setIsAjustandoMonto(false);
        }
    };

    /** Refresca el listado tras confirmar la carga masiva — mismo criterio que handleProcesarCuotas
     * (recarga completa en vez de merge local, no vale la pena optimizar un flujo esporádico). El
     * modal decide por sí mismo si se cierra (solo si no quedaron filas con error pendientes de
     * revisar) — acá solo refrescamos los datos reales. */
    const handleImportado = async (creados: number) => {
        if (creados === 0) return;
        try {
            const descs = await descuentosService.getTodos();
            setDescuentos(descs);
        } catch (err: unknown) {
            Logger.error('Error al recargar descuentos tras la importación', {}, err);
        }
    };

    /** US-DESC-05 (IMPL-62) CA1 — valida el descuento fijo antes de su primera aplicación. */
    const handleValidar = async (descuentoId: string) => {
        setValidandoId(descuentoId);
        try {
            const actualizado = await descuentosService.validar(descuentoId);
            setDescuentos((prev) => prev.map((d) => (d.id === descuentoId ? actualizado : d)));
            showToast(t('descuentos.toast_validado'), 'success');
        } catch (err: unknown) {
            Logger.error('Error al validar descuento', { descuentoId }, err);
            showToast(t('descuentos.error_validar'), 'error');
        } finally {
            setValidandoId(null);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {isLoading ? (
                <div className="h-32 bg-surface rounded-lg animate-pulse" />
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-md">
                        <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('descuentos.stat_por_descontar')}</p>
                            <p className="text-[1.75rem] font-bold mt-xs text-primary">${indicadores.porDescontarQuincena.toFixed(2)}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('descuentos.stat_suspendidos')}</p>
                            <p className="text-[1.75rem] font-bold mt-xs text-heading">{indicadores.suspendidosQuincena}</p>
                        </div>
                        <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('descuentos.stat_completados')}</p>
                            <p className="text-[1.75rem] font-bold mt-xs text-heading">{indicadores.completados}</p>
                        </div>
                    </div>

                    <div className="flex flex-col lg:flex-row gap-2 lg:items-center lg:justify-between">
                        <div className="flex flex-col sm:flex-row gap-2">
                            <div className="relative flex-1">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
                                <input
                                    type="text"
                                    value={filtroBusqueda}
                                    onChange={(e) => setFiltroBusqueda(e.target.value)}
                                    placeholder={t('descuentos.filtro_busqueda_placeholder')}
                                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-border bg-white text-sm shadow-cards focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-colors"
                                />
                                {filtroBusqueda && (
                                    <button type="button" onClick={() => setFiltroBusqueda('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary hover:text-heading transition-colors">
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            <div className="relative">
                                <select
                                    value={filtroTipo}
                                    onChange={(e) => setFiltroTipo(e.target.value as TipoDescuento | 'todos')}
                                    className="pl-3 pr-8 py-2 rounded-xl border border-border bg-white text-[12px] font-semibold text-heading shadow-cards focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-colors cursor-pointer appearance-none"
                                >
                                    <option value="todos">{t('descuentos.filtro_tipo_todos')}</option>
                                    <option value="fijo">{t('empleados.descuentos_subtab_fijos')}</option>
                                    <option value="variable">{t('empleados.descuentos_subtab_variables')}</option>
                                </select>
                                <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
                            </div>
                            <div className="relative">
                                <select
                                    value={filtroEstado}
                                    onChange={(e) => setFiltroEstado(e.target.value as Descuento['estado'] | 'todos')}
                                    className="pl-3 pr-8 py-2 rounded-xl border border-border bg-white text-[12px] font-semibold text-heading shadow-cards focus:border-primary focus:ring-2 focus:ring-primary/10 outline-none transition-colors cursor-pointer appearance-none"
                                >
                                    <option value="todos">{t('descuentos.filtro_estado_todos')}</option>
                                    <option value="activo">{t('empleados.descuentos_estado_activo')}</option>
                                    <option value="pausado">{t('empleados.descuentos_estado_pausado')}</option>
                                    <option value="completado">{t('empleados.descuentos_estado_completado')}</option>
                                    <option value="cancelado">{t('empleados.descuentos_estado_cancelado')}</option>
                                </select>
                                <ChevronDown size={12} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
                            </div>
                            {hayFiltrosActivos && (
                                <button
                                    type="button"
                                    onClick={handleLimpiarFiltros}
                                    className="flex items-center gap-xs px-md py-2 text-[13px] font-semibold text-text-secondary hover:text-heading transition-colors shrink-0"
                                >
                                    <X size={14} /> {t('descuentos.action_limpiar_filtros')}
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => setMostrarImportar(true)}
                                className="flex items-center gap-1.5"
                            >
                                <Upload size={16} /> {t('descuentos.importacion_action_abrir')}
                            </Button>
                            {quincenaVista?.estado === 'en_proceso' && (
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={handleProcesarCuotas}
                                    isLoading={isProcesandoCuotas}
                                    className="flex items-center gap-1.5"
                                >
                                    <RefreshCw size={16} /> {t('descuentos.action_procesar_cuotas')}
                                </Button>
                            )}
                        </div>
                    </div>

                    {descuentos.length === 0 ? (
                        <p className="text-caption text-text-secondary italic bg-white rounded-lg shadow-cards border border-border p-lg">{t('descuentos.listado_empty')}</p>
                    ) : (
                        <div className="flex flex-col gap-sm">
                            <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">
                                {t('descuentos.listado_contador', { count: descuentosFiltrados.length, empleados: gruposPorEmpleado.length })}
                            </p>
                            {gruposPorEmpleado.length === 0 ? (
                                <div className="bg-white rounded-xl border border-border shadow-cards p-xl flex flex-col items-center gap-2 text-center">
                                    <Search size={22} className="text-text-secondary" />
                                    <p className="text-body font-bold text-heading">{t('descuentos.listado_sin_resultados_title')}</p>
                                    <p className="text-[12px] text-text-secondary">{t('descuentos.listado_sin_resultados')}</p>
                                </div>
                            ) : (
                        <div className="flex flex-col gap-3">
                            {gruposPorEmpleado.map(({ empleado, items }) => (
                                <section key={empleado!.id} className="bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-3">
                                    <div className="flex items-center gap-2 pb-2 border-b border-border/50">
                                        <Avatar nombre={empleado!.nombre_completo} fotoUrl={empleado!.foto_url} size={28} />
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-heading text-sm">{empleado!.nombre_completo}</span>
                                            <span className="text-[11px] text-text-secondary">{getCodigoEmpleado(empleado!)}</span>
                                        </div>
                                        {items.length > 1 && (
                                            <span className="ml-auto text-[11px] font-semibold text-text-secondary">
                                                {t('descuentos.n_descuentos', { count: items.length })}
                                            </span>
                                        )}
                                    </div>

                                    <ul className="flex flex-col gap-2">
                                        {items.map((d) => {
                                            const categoria = categoriaPorId.get(d.categoria_id);
                                            const pendiente = d.monto_total !== null ? d.monto_total - d.monto_pagado : null;
                                            const penultima = esPenultimaCuota(d.numero_cuotas, d.cuotas_pagadas);
                                            const estado = estadoVisual(d);
                                            // IMPL-156 CA4 — "Suspender" actúa sobre la quincena VISTA (la explícitamente
                                            // elegida), igual que el badge visual de arriba — ya no hay una "activa" aparte
                                            // contra la que comparar.
                                            const yaSuspendidoEnVista = eventosQuincenaVista.some((e) => e.descuento_id === d.id);
                                            const puedeSuspender = d.estado === 'activo' && quincenaVista?.estado === 'en_proceso' && !yaSuspendidoEnVista;
                                            const requiereValidacion = categoria?.tipo === 'fijo' && !d.validado_at;
                                            return (
                                                <li key={d.id} className="flex flex-col gap-2 text-sm border-b border-border/30 last:border-b-0 pb-2 last:pb-0">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div className="flex flex-col">
                                                            <span className="font-medium text-heading">
                                                                {categoria?.nombre ?? '—'}{d.institucion ? ` — ${d.institucion}` : ''}
                                                                <span className="text-[11px] text-text-secondary font-normal ml-2">{d.codigo}</span>
                                                                {requiereValidacion && (
                                                                    <span className="ml-2 inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full bg-error/10 text-error">
                                                                        {t('descuentos.badge_requiere_validacion')}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className="text-caption text-text-secondary">
                                                                ${d.monto_quincenal.toFixed(2)}
                                                                {d.numero_cuotas !== null && ` · ${t('empleados.descuentos_cuota_x_de_y', { actual: d.cuotas_pagadas + 1, total: d.numero_cuotas })}`}
                                                                {pendiente !== null && ` · ${t('empleados.descuentos_pendiente', { monto: pendiente.toFixed(2) })}`}
                                                                {penultima && (
                                                                    <>
                                                                        <span className="ml-2 inline-flex items-center px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-100 text-amber-700">
                                                                            {t('descuentos.badge_penultima_cuota')}
                                                                        </span>
                                                                        {ajustandoMontoId !== d.id && (
                                                                            <button
                                                                                type="button"
                                                                                onClick={() => { setAjustandoMontoId(d.id); setNuevoMontoAjuste(String(d.monto_quincenal)); }}
                                                                                className="ml-2 text-[11px] font-semibold text-primary hover:underline"
                                                                            >
                                                                                {t('descuentos.action_ajustar_monto')}
                                                                            </button>
                                                                        )}
                                                                    </>
                                                                )}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0">
                                                            {requiereValidacion && (
                                                                <Button type="button" size="sm" variant="outline-danger" isLoading={validandoId === d.id} onClick={() => handleValidar(d.id)}>
                                                                    {t('descuentos.action_validar')}
                                                                </Button>
                                                            )}
                                                            {puedeSuspender && suspendiendoId !== d.id && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { setSuspendiendoId(d.id); setMotivoSuspension(''); }}
                                                                    className="text-[11px] font-semibold text-amber-700 hover:underline"
                                                                >
                                                                    {t('descuentos.action_suspender_quincena')}
                                                                </button>
                                                            )}
                                                            <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full ${BADGE_ESTADO[estado]}`}>
                                                                <span className={`w-1.5 h-1.5 rounded-full ${DOT_ESTADO[estado]}`} />
                                                                {t(`empleados.descuentos_estado_${estado}`)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    {suspendiendoId === d.id && (
                                                        <div className="flex flex-col gap-2 bg-amber-50/60 border border-amber-200 rounded-lg p-md max-w-[28rem]">
                                                            <InputField
                                                                label={t('descuentos.field_motivo_suspension')}
                                                                value={motivoSuspension}
                                                                onChange={(e) => setMotivoSuspension(e.target.value)}
                                                                required
                                                            />
                                                            <div className="flex gap-2">
                                                                <Button type="button" variant="warning" isLoading={isSuspendiendo} onClick={() => handleConfirmarSuspension(d.id)}>
                                                                    {t('descuentos.action_confirmar_suspension')}
                                                                </Button>
                                                                <Button type="button" variant="ghost" onClick={() => setSuspendiendoId(null)}>
                                                                    {t('descuentos.action_cancelar')}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )}
                                                    {ajustandoMontoId === d.id && (
                                                        <div className="flex flex-col gap-2 bg-primary-light/20 border border-primary/20 rounded-lg p-md max-w-[28rem]">
                                                            <InputField
                                                                label={t('descuentos.field_nuevo_monto')}
                                                                type="number"
                                                                min={0}
                                                                step="0.01"
                                                                value={nuevoMontoAjuste}
                                                                onChange={(e) => setNuevoMontoAjuste(e.target.value)}
                                                                required
                                                            />
                                                            <div className="flex gap-2">
                                                                <Button type="button" isLoading={isAjustandoMonto} onClick={() => handleConfirmarAjusteMonto(d.id)}>
                                                                    {t('descuentos.action_confirmar_ajuste')}
                                                                </Button>
                                                                <Button type="button" variant="ghost" onClick={() => setAjustandoMontoId(null)}>
                                                                    {t('descuentos.action_cancelar')}
                                                                </Button>
                                                            </div>
                                                        </div>
                                                    )}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                </section>
                            ))}
                        </div>
                            )}
                        </div>
                    )}
                </>
            )}

            {mostrarImportar && (
                <ImportarDescuentosModal
                    onClose={() => setMostrarImportar(false)}
                    onImportado={handleImportado}
                />
            )}
        </div>
    );
};
