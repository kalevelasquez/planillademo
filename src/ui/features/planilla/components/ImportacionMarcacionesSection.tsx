import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UploadCloud, FileSpreadsheet, Download, X, Info, CheckCircle2, AlertTriangle, XCircle, Lock, Pencil, UserPlus, RotateCcw } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useUbicacionesStore } from '../../../../store/ubicacionesStore';
import { MARCACION_PLANTILLA_COMPLETA_HEADERS, ROLES } from '../../../../config/constants';
import { validateMarcacionHeaders, mapExcelRowToMarcacion, type MarcacionCruda } from '../../../../utils/excelUtils';
import { agruparPorEmpleadoYDia, validarAcumulados, revalidarFila, aplicarAusencias, detectarEmpleadosDuplicados, detectarAusenciasInjustificadas, compensarCortosPorEmpleado, construirFilasDesdeConfirmadas, type FilaValidacion, type EmpleadoMatch, type AusenciaActiva, type PermisoRegistrado, type AusenciaInjustificada, type ContextoCalculoHoras, type TramoMarcacionConfirmada } from '../../../../utils/marcacionesValidacionUtils';
import { jornadasService } from '../../../../services/jornadasService';
import { feriadosService } from '../../../../services/feriadosService';
import { calcularMontoHorasExtras } from '../../../../utils/horasExtrasUtils';
import { planillaEmpleadosService, type Empleado } from '../../../../services/planillaEmpleadosService';
import { marcacionesService, type NuevaMarcacionRPC, type NuevoAgregadoManual, type NuevaAusenciaInjustificadaRPC, type MarcacionConfirmada } from '../../../../services/marcacionesService';
import { horasExtrasManualService, type AgregadoManualConfirmado } from '../../../../services/horasExtrasManualService';
import type { Quincena } from '../../../../services/quincenasService';
import { incapacidadesService } from '../../../../services/incapacidadesService';
import { vacacionesService } from '../../../../services/vacacionesService';
import { permisosService } from '../../../../services/permisosService';
import { modulosQuincenaService, type QuincenaModuloUbicacionEstado } from '../../../../services/modulosQuincenaService';
import { auditService } from '../../../../services/auditService';
import { Button } from '../../../components/Button';
import { InputField } from '../../../components/InputField';
import { BotonSinHorasExtraUbicacion } from './BotonSinHorasExtraUbicacion';
import { Logger } from '../../../../utils/logger';

const CAMPOS_HORAS = ['hed', 'hen', 'nocturnidad', 'feriado'] as const;
type CampoHoras = typeof CAMPOS_HORAS[number];

/**
 * Bugfix (2026-08-12): la reasignación manual de una fila era un <select> nativo poblado
 * SOLO con empleados que ya tienen codigo_empleado_manual asignado (getEmpleadosConCodigoManual)
 * — un empleado sin código, o cuando el usuario esperaba buscar por nombre entre todos los
 * activos, simplemente no aparecía ahí. Se reemplaza por el mismo buscador tenant-wide (debounce
 * + planillaEmpleadosService.getEmpleados) ya usado en "Agregar Empleado No Detectado" más abajo
 * en esta misma pantalla — mismo patrón, no una abstracción nueva.
 */
const BuscadorEmpleadoFila: React.FC<{
    valorActual: string | null;
    onSeleccionar: (empleado: Pick<Empleado, 'id' | 'nombre_completo' | 'estado' | 'cargo' | 'departamento' | 'ubicacion_id'>) => void;
}> = ({ valorActual, onSeleccionar }) => {
    const { t } = useTranslation();
    const [texto, setTexto] = useState(valorActual ?? '');
    const [abierto, setAbierto] = useState(false);
    const [resultados, setResultados] = useState<Empleado[]>([]);
    const [isBuscando, setIsBuscando] = useState(false);

    useEffect(() => {
        if (!abierto) return;
        const termino = texto.trim();
        let cancelado = false;
        setIsBuscando(true);
        const timeoutId = window.setTimeout(() => {
            planillaEmpleadosService.getEmpleados(1, termino, undefined, 8)
                .then((res) => { if (!cancelado) setResultados(res.data); })
                .catch((err: unknown) => Logger.error('Error al buscar empleado para reasignar fila de marcación', {}, err))
                .finally(() => { if (!cancelado) setIsBuscando(false); });
        }, 300);
        return () => { cancelado = true; window.clearTimeout(timeoutId); };
    }, [texto, abierto]);

    return (
        <div className="relative flex flex-col gap-1 min-w-45">
            <input
                type="text"
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                onFocus={() => setAbierto(true)}
                onBlur={() => setTimeout(() => setAbierto(false), 150)}
                placeholder={t('horasExtras.agregar_empleado_buscar_placeholder')}
                className="w-full rounded-md border border-border bg-white px-2 py-1 text-[13px]"
            />
            {abierto && (
                <div className="absolute top-full mt-1 w-full min-w-45 bg-white border border-border rounded-md shadow-cards z-10 max-h-52 overflow-y-auto">
                    {isBuscando ? (
                        <p className="px-3 py-2 text-[12px] text-text-secondary">…</p>
                    ) : resultados.length === 0 ? (
                        <p className="px-3 py-2 text-[12px] text-text-secondary">{t('horasExtras.agregar_empleado_sin_resultados')}</p>
                    ) : (
                        resultados.map((e) => (
                            <button
                                key={e.id}
                                type="button"
                                onClick={() => { onSeleccionar(e); setTexto(e.nombre_completo); setAbierto(false); }}
                                className="w-full text-left px-3 py-2 text-[13px] hover:bg-surface"
                            >
                                {e.nombre_completo}{e.estado === 'inactivo' ? ` (${t('horasExtras.badge_inactivo')})` : ''}
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

interface FilaAgregada {
    empleadoId: string;
    nombreCompleto: string;
    sueldoMensual: number | null;
    ubicacionHabitualId: string | null;
    hed: number;
    hen: number;
    nocturnidad: number;
    feriado: number;
}

const EXTENSIONES_VALIDAS = ['.xls', '.xlsx'];
const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10MB (CA1)

interface ImportacionMarcacionesSectionProps {
    ubicacionId: string;
    ubicacionNombre: string;
    quincena: Quincena | null;
    /** Gap real (observación UAT, 2026-10-05) — el único gate que existía acá era
     * `ubicacionEstado?.estado === 'completado'` (por ubicación), nunca el estado de la
     * quincena. Si la quincena quedaba `aprobada_cerrada` sin que esta ubicación hubiera
     * confirmado Horas Extras, el dropzone de importación seguía totalmente editable. */
    quincenaCerrada: boolean;
}

type EstadoFila = 'error' | 'advertencia' | 'ok';

function estadoDeFila(fila: FilaValidacion): EstadoFila {
    if (!fila.descartada && fila.errores.length > 0) return 'error';
    if (!fila.descartada && fila.advertencias.length > 0) return 'advertencia';
    return 'ok';
}

/**
 * Importación de Archivo del Reloj Marcador (US-HEX-02) + Validaciones de la Importación
 * (US-HEX-04). CA7 (ausencias vs. incapacidades/vacaciones, revisión épica por épica
 * post-IMPL-41/63) advierte si un empleado marcó asistencia con una incapacidad o vacación
 * activa ese día — no bloquea, solo informa (el Preparador puede confirmar igual si es
 * correcto, ej. trabajó parte del día). CA2/CA5 solo llegan hasta la detección (advertencia)
 * — el motor de perdón de saldo negativo (US-HEX-09) y la liquidación/arrastre a la siguiente
 * quincena (IMPL-85) no existen todavía. `detectarEmpleadosDuplicados` (IMPL-24, revisión
 * épica por épica) advierte si una reasignación manual deja al mismo empleado con 2+ filas
 * el mismo día — evita que `validarAcumulados` sume ese doble conteo sin avisar.
 */
export const ImportacionMarcacionesSection: React.FC<ImportacionMarcacionesSectionProps> = ({ ubicacionId, ubicacionNombre, quincena, quincenaCerrada }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const inputRef = useRef<HTMLInputElement>(null);

    const { ubicaciones } = useUbicacionesStore();
    const quincenaId = quincena?.id ?? '';
    const quincenaSeleccionada = quincena;
    const [ubicacionEstado, setUbicacionEstado] = useState<QuincenaModuloUbicacionEstado | null>(null);
    const [isLoadingModulo, setIsLoadingModulo] = useState(true);

    // IMPL-22 CA4/CA5 — wiring de IMPL-80 (jornada ordinaria) y feriados para calcular
    // HED/HEN/Nocturnidad/Feriado por fila. Se carga una sola vez al montar (catálogos chicos,
    // mismo criterio que el resto de catálogos de configuración de este módulo).
    const [jornadaOverrides, setJornadaOverrides] = useState<Awaited<ReturnType<typeof jornadasService.getJornadas>>>([]);
    const [feriadosSet, setFeriadosSet] = useState<Set<string>>(new Set());
    useEffect(() => {
        Promise.all([jornadasService.getJornadas(), feriadosService.getFeriados()])
            .then(([jornadas, feriados]) => {
                setJornadaOverrides(jornadas);
                setFeriadosSet(new Set(feriados.map((f) => f.fecha)));
            })
            .catch((err: unknown) => Logger.error('Error al cargar jornadas/feriados para el cálculo de horas', {}, err));
    }, []);
    const contextoCalculoHoras: ContextoCalculoHoras = useMemo(() => ({ overrides: jornadaOverrides, feriados: feriadosSet }), [jornadaOverrides, feriadosSet]);

    // IMPL-124 — reabrir esta ubicación mientras la quincena sigue en_proceso, sin pasar por
    // reabrir_quincena (desproporcionado para corregir un solo dato).
    const [mostrarFormReapertura, setMostrarFormReapertura] = useState(false);
    const [motivoReapertura, setMotivoReapertura] = useState('');
    const [isReabriendo, setIsReabriendo] = useState(false);
    const [errorReabrir, setErrorReabrir] = useState<string | null>(null);

    // IMPL-149 — vista de solo lectura de lo ya confirmado, en vez de solo el candado.
    const [marcacionesConfirmadas, setMarcacionesConfirmadas] = useState<MarcacionConfirmada[]>([]);
    const [agregadosConfirmados, setAgregadosConfirmados] = useState<AgregadoManualConfirmado[]>([]);
    const [isLoadingConfirmado, setIsLoadingConfirmado] = useState(false);
    /** Defecto real (2026-09-24) — la vista de solo lectura mostraba únicamente entrada/salida
     * en bruto por tramo, sin HED/HEN/Nocturnidad/Feriado/Horas Regulares — el Preparador no
     * podía ver el detalle real de lo confirmado sin reabrir el módulo. Se reconstruyen las
     * mismas columnas que la tabla editable, con la misma función usada para `cargarParaEdicion`. */
    const filasConfirmadasCalculadas = useMemo(() => {
        const tramos: TramoMarcacionConfirmada[] = marcacionesConfirmadas
            .filter((m) => m.empleado)
            .map((m) => ({
                empleadoId: m.empleado_id,
                entrada: m.entrada,
                salida: m.salida,
                idUsuarioArchivo: m.id_usuario_archivo,
                editadoManualmente: m.editado_manualmente,
                empleadoNombre: m.empleado!.nombre_completo,
                empleadoEstado: m.empleado!.estado,
                empleadoCargo: m.empleado!.cargo,
                empleadoDepartamento: m.empleado!.departamento,
            }));
        return construirFilasDesdeConfirmadas(tramos, contextoCalculoHoras);
    }, [marcacionesConfirmadas, contextoCalculoHoras]);

    const [isDragging, setIsDragging] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [archivo, setArchivo] = useState<File | null>(null);
    const [filas, setFilas] = useState<FilaValidacion[] | null>(null);
    /** Pedido real del jefe (2026-09-23, parte 2) — tras Reabrir, se reconstruyen `filas`/`agregados`
     * a partir de lo ya confirmado (ver `cargarParaEdicion`) en vez de forzar re-subir el Excel
     * completo. Esta bandera distingue ese origen de un `archivo` recién subido, para mostrar la
     * misma tabla editable sin necesitar un File real. */
    const [editandoConfirmados, setEditandoConfirmados] = useState(false);
    /** Defecto real (2026-09-23) — necesario en `handleConfirmar` para calcular `monto_total`
     * de los empleados matcheados automáticamente por el reloj; `procesarArchivo` solo tenía
     * esta lista en una variable local que no sobrevivía hasta la confirmación. */
    const [empleadosMatch, setEmpleadosMatch] = useState<EmpleadoMatch[]>([]);
    const [marcacionesExistentes, setMarcacionesExistentes] = useState<{ empleado_id: string; entrada: string; salida: string }[]>([]);
    const [ausenciasActivas, setAusenciasActivas] = useState<AusenciaActiva[]>([]);
    /** IMPL-82 (US-HEX-08) — insumos para `detectarAusenciasInjustificadas`: roster COMPLETO de
     * activos de esta ubicación (no solo los matcheados en el archivo) y permisos registrados
     * de la quincena. Se recalcula vía `ausenciasInjustificadas` (useMemo) en vez de empujarse
     * a `filas` como las demás advertencias, porque puede haber empleados sin NINGUNA fila. */
    const [rosterUbicacion, setRosterUbicacion] = useState<EmpleadoMatch[]>([]);
    const [permisosQuincena, setPermisosQuincena] = useState<PermisoRegistrado[]>([]);
    const [mostrarDetalleAusencias, setMostrarDetalleAusencias] = useState(false);
    const [confirmacion120h, setConfirmacion120h] = useState(false);
    const [isConfirmando, setIsConfirmando] = useState(false);

    // US-HEX-07 — agregar empleado no detectado por el reloj
    const [agregados, setAgregados] = useState<FilaAgregada[]>([]);
    const [busquedaTexto, setBusquedaTexto] = useState('');
    const [busquedaAbierta, setBusquedaAbierta] = useState(false);
    const [resultadosBusqueda, setResultadosBusqueda] = useState<Empleado[]>([]);
    const [isBuscando, setIsBuscando] = useState(false);
    const [errorAgregar, setErrorAgregar] = useState<string | null>(null);

    // IMPL-124 — mismos roles que pueden confirmar el módulo (completarUbicacion), mismo
    // criterio que la RLS de UPDATE en quincena_modulo_ubicacion_estado.
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

    useEffect(() => {
        if (ubicacionEstado?.estado !== 'completado' || !quincenaId) return;
        setMarcacionesConfirmadas([]);
        setAgregadosConfirmados([]);
        setIsLoadingConfirmado(true);
        Promise.all([
            marcacionesService.getMarcacionesPorUbicacion(quincenaId, ubicacionId),
            horasExtrasManualService.getAgregadosConfirmados(quincenaId, ubicacionId),
        ])
            .then(([tramos, agregados]) => { setMarcacionesConfirmadas(tramos); setAgregadosConfirmados(agregados); })
            .catch((err: unknown) => Logger.error('Error al cargar marcaciones confirmadas', { quincenaId, ubicacionId }, err))
            .finally(() => setIsLoadingConfirmado(false));
    }, [ubicacionEstado?.estado, quincenaId, ubicacionId]);

    /**
     * IMPL-82 (US-HEX-08 CA1/CA3) — se recalcula como derivado de `filas` en vez de empujarse a
     * las `advertencias` de cada fila (como `aplicarAusencias`/`aplicarAcumulados`), porque un
     * empleado sin NINGUNA marcación en el lote tampoco tiene ninguna fila a la cual engancharle
     * la advertencia. Puramente informativo — ver nota en `detectarAusenciasInjustificadas`
     * sobre por qué todavía no calcula ningún monto.
     */
    const ausenciasInjustificadas: AusenciaInjustificada[] = useMemo(() => {
        if (!filas || !quincenaSeleccionada) return [];
        return detectarAusenciasInjustificadas(
            rosterUbicacion,
            filas,
            ausenciasActivas,
            permisosQuincena,
            quincenaSeleccionada.fecha_inicio,
            quincenaSeleccionada.fecha_fin,
            contextoCalculoHoras
        );
    }, [filas, rosterUbicacion, ausenciasActivas, permisosQuincena, quincenaSeleccionada, contextoCalculoHoras]);

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
            // Pedido real del jefe (2026-09-23, parte 2) — antes esto forzaba re-subir el Excel
            // completo desde cero (`reemplazar()`); ahora reconstruye las filas editables a
            // partir de lo ya confirmado, para poder corregir un registro puntual sin perder ni
            // tener que re-adjuntar todo el archivo. Al confirmar de nuevo, `confirmar_importacion_reloj_marcador`
            // sigue reemplazando (no duplicando) los tramos de esta ubicación (migración 20260923100000).
            await cargarParaEdicion(quincenaSeleccionada);
        } catch (err: unknown) {
            Logger.error('Error al reabrir el módulo de Horas Extras', { quincenaId: quincenaSeleccionada.id, ubicacionId }, err);
            setErrorReabrir(t('horasExtras.reabrir_error'));
        } finally {
            setIsReabriendo(false);
        }
    };

    /**
     * Recalcula las advertencias de acumulado (120h/domingo) sobre el lote completo — hay
     * que volver a llamar esto después de CUALQUIER edición manual, no solo al parsear,
     * porque cambiar un tramo o reasignar un empleado cambia los totales.
     */
    const aplicarAcumulados = (filasBase: FilaValidacion[], marcacionesExistentes: { empleado_id: string; entrada: string; salida: string }[]): FilaValidacion[] => {
        const acumulados = validarAcumulados(filasBase, marcacionesExistentes);
        const nombresSobre120h = new Set(acumulados.empleadosSobre120h);
        const domingoPorNombre = new Map(acumulados.empleadosDomingoTrabajado.map((d) => [d.nombre, d]));

        return filasBase.map((fila) => {
            const advertencias = [...fila.advertencias];
            if (fila.empleadoNombre && nombresSobre120h.has(fila.empleadoNombre)) {
                advertencias.push(t('horasExtras.validacion_advertencia_120h'));
            }
            const domingo = fila.empleadoNombre ? domingoPorNombre.get(fila.empleadoNombre) : undefined;
            if (domingo && new Date(`${fila.fecha}T00:00:00`).getDay() === 0) {
                advertencias.push(t(domingo.superoUmbral44h ? 'horasExtras.validacion_advertencia_domingo_supero44' : 'horasExtras.validacion_advertencia_domingo_bajo44', { horas: domingo.horasLunesASabado }));
            }
            return { ...fila, advertencias };
        });
    };

    /**
     * Pedido real del jefe (2026-09-23, parte 2 de [[horas-extras-feedback-jefe-2026-09-23]]) —
     * al Reabrir, reconstruye `filas`/`agregados` EDITABLES a partir de lo ya confirmado en vez
     * de forzar re-subir el Excel completo. Mismo pipeline de validación que `procesarArchivo`
     * (acumulados/ausencias/duplicados), solo cambia el origen de los datos.
     */
    const cargarParaEdicion = async (quincenaActual: Quincena) => {
        setError(null);
        setIsParsing(true);
        setArchivo(null);
        setFilas(null);
        setAgregados([]);
        setConfirmacion120h(false);
        try {
            const [marcaciones, agregadosConfirmados, empleados, existentes, rosterActivo, permisos] = await Promise.all([
                marcacionesService.getMarcacionesPorUbicacion(quincenaActual.id, ubicacionId),
                horasExtrasManualService.getAgregadosConfirmados(quincenaActual.id, ubicacionId),
                planillaEmpleadosService.getEmpleadosConCodigoManual(),
                marcacionesService.getMarcacionesPorQuincena(quincenaActual.id, ubicacionId),
                planillaEmpleadosService.getEmpleadosActivosPorUbicacion(ubicacionId),
                permisosService.getPorQuincena(quincenaActual.id),
            ]);

            setEmpleadosMatch(empleados as EmpleadoMatch[]);
            setRosterUbicacion(rosterActivo as EmpleadoMatch[]);
            setPermisosQuincena(permisos.map((p) => ({ empleado_id: p.empleado_id, fecha: p.fecha })));

            const tramos: TramoMarcacionConfirmada[] = marcaciones
                .filter((m) => m.empleado)
                .map((m) => ({
                    empleadoId: m.empleado_id,
                    entrada: m.entrada,
                    salida: m.salida,
                    idUsuarioArchivo: m.id_usuario_archivo,
                    editadoManualmente: m.editado_manualmente,
                    empleadoNombre: m.empleado!.nombre_completo,
                    empleadoEstado: m.empleado!.estado,
                    empleadoCargo: m.empleado!.cargo,
                    empleadoDepartamento: m.empleado!.departamento,
                }));
            const filasReconstruidas = construirFilasDesdeConfirmadas(tramos, contextoCalculoHoras);

            const empleadoIds = Array.from(new Set(filasReconstruidas.map((f) => f.empleadoId).filter((id): id is string => !!id)));
            const [incapacidades, vacaciones] = await Promise.all([
                incapacidadesService.getActivasPorEmpleados(empleadoIds, quincenaActual.fecha_inicio, quincenaActual.fecha_fin),
                vacacionesService.getActivasPorEmpleados(empleadoIds, quincenaActual.fecha_inicio, quincenaActual.fecha_fin),
            ]);
            const ausencias: AusenciaActiva[] = [
                ...incapacidades.map((i) => ({ empleado_id: i.empleado_id, fecha_inicio: i.fecha_inicio, fecha_fin: i.fecha_fin, tipo: 'incapacidad' as const })),
                ...vacaciones.filter((v) => !v.no_gozada).map((v) => ({ empleado_id: v.empleado_id, fecha_inicio: v.fecha_inicio, fecha_fin: v.fecha_fin, tipo: 'vacacion' as const })),
            ];

            setMarcacionesExistentes(existentes);
            setAusenciasActivas(ausencias);
            setFilas(detectarEmpleadosDuplicados(aplicarAusencias(aplicarAcumulados(filasReconstruidas, existentes), ausencias)));

            setAgregados(
                agregadosConfirmados
                    .filter((a) => a.empleado)
                    .map((a) => ({
                        empleadoId: a.empleado_id,
                        nombreCompleto: a.empleado!.nombre_completo,
                        sueldoMensual: a.empleado!.sueldo_mensual,
                        ubicacionHabitualId: a.empleado!.ubicacion_id,
                        hed: a.hed,
                        hen: a.hen,
                        nocturnidad: a.nocturnidad,
                        feriado: a.feriado,
                    }))
            );

            setEditandoConfirmados(true);
        } catch (err: unknown) {
            Logger.error('Error al cargar los registros confirmados para edición', { quincenaId: quincenaActual.id, ubicacionId }, err);
            setError(t('horasExtras.importacion_error_cargar_confirmados'));
        } finally {
            setIsParsing(false);
        }
    };

    /**
     * Bug real encontrado en vivo (reporte UAT, 2026-09-25) — `handleReabrir` reconstruye la
     * tabla editable con `cargarParaEdicion` solo en el estado local del componente. Si el
     * usuario navega a otra pantalla y vuelve, el componente se remonta: `ubicacionEstado` se
     * vuelve a pedir a la base (ya no 'completado'), pero `filas`/`editandoConfirmados` arrancan
     * de nuevo en null/false — cae al dropzone vacío como si no hubiera datos, aunque siguen
     * intactos en `planilla_marcaciones`. `reabierta_at` (lo setea solo `reabrirUbicacion`,
     * nunca una ubicación nueva sin tocar) distingue "reabierta con datos para editar" de
     * "nunca confirmada" — sin esta distinción, una ubicación nueva también dispararía esto.
     */
    useEffect(() => {
        if (!quincenaSeleccionada || !ubicacionEstado) return;
        if (ubicacionEstado.estado !== 'pendiente' || !ubicacionEstado.reabierta_at) return;
        if (filas || archivo || editandoConfirmados) return;
        cargarParaEdicion(quincenaSeleccionada);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ubicacionEstado, quincenaSeleccionada]);

    const validarArchivo = (file: File): string | null => {
        const nombreLower = file.name.toLowerCase();
        if (!EXTENSIONES_VALIDAS.some((ext) => nombreLower.endsWith(ext))) return t('horasExtras.importacion_error_formato');
        if (file.size > TAMANO_MAXIMO_BYTES) return t('horasExtras.importacion_error_tamano');
        return null;
    };

    const procesarArchivo = async (file: File) => {
        const errorValidacion = validarArchivo(file);
        if (errorValidacion) { setError(errorValidacion); return; }
        if (!quincenaSeleccionada) { setError(t('horasExtras.importacion_error_sin_quincena')); return; }

        setError(null);
        setIsParsing(true);
        setArchivo(file);
        setFilas(null);
        setConfirmacion120h(false);

        try {
            const { read, utils } = await import('xlsx');
            const buffer = await file.arrayBuffer();
            const workbook = read(buffer, { type: 'array', cellDates: true });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];

            const matriz = utils.sheet_to_json(worksheet, { header: 1 }) as unknown[][];
            const encabezados = matriz.length > 0 ? (matriz[0] || []).map(String) : [];
            if (encabezados.length === 0) { setError(t('horasExtras.importacion_error_vacio')); return; }

            const { isValid, missingHeaders } = validateMarcacionHeaders(encabezados);
            if (!isValid) { setError(t('horasExtras.importacion_error_headers', { columnas: missingHeaders.join(', ') })); return; }

            const filasArchivo = utils.sheet_to_json(worksheet, { defval: '' }) as Record<string, unknown>[];
            if (filasArchivo.length === 0) { setError(t('horasExtras.importacion_error_vacio')); return; }

            const marcaciones: MarcacionCruda[] = filasArchivo.map(mapExcelRowToMarcacion);
            const [empleados, existentes, rosterActivo, permisos] = await Promise.all([
                planillaEmpleadosService.getEmpleadosConCodigoManual(),
                marcacionesService.getMarcacionesPorQuincena(quincenaSeleccionada.id),
                planillaEmpleadosService.getEmpleadosActivosPorUbicacion(ubicacionId),
                permisosService.getPorQuincena(quincenaSeleccionada.id),
            ]);

            setEmpleadosMatch(empleados as EmpleadoMatch[]);
            setRosterUbicacion(rosterActivo as EmpleadoMatch[]);
            setPermisosQuincena(permisos.map((p) => ({ empleado_id: p.empleado_id, fecha: p.fecha })));
            const filasAgrupadas = agruparPorEmpleadoYDia(
                marcaciones,
                empleados as EmpleadoMatch[],
                quincenaSeleccionada.fecha_inicio,
                quincenaSeleccionada.fecha_fin,
                contextoCalculoHoras,
                ubicacionId
            );

            // CA7 (US-HEX-04, revisión épica por épica) — recién acá se conocen los
            // empleado_id resueltos (vía matching por codigo_empleado_manual), así que el
            // fetch de ausencias no puede ir en el Promise.all de arriba.
            const empleadoIds = Array.from(new Set(filasAgrupadas.map((f) => f.empleadoId).filter((id): id is string => !!id)));
            const [incapacidades, vacaciones] = await Promise.all([
                incapacidadesService.getActivasPorEmpleados(empleadoIds, quincenaSeleccionada.fecha_inicio, quincenaSeleccionada.fecha_fin),
                vacacionesService.getActivasPorEmpleados(empleadoIds, quincenaSeleccionada.fecha_inicio, quincenaSeleccionada.fecha_fin),
            ]);
            const ausencias: AusenciaActiva[] = [
                ...incapacidades.map((i) => ({ empleado_id: i.empleado_id, fecha_inicio: i.fecha_inicio, fecha_fin: i.fecha_fin, tipo: 'incapacidad' as const })),
                ...vacaciones.filter((v) => !v.no_gozada).map((v) => ({ empleado_id: v.empleado_id, fecha_inicio: v.fecha_inicio, fecha_fin: v.fecha_fin, tipo: 'vacacion' as const })),
            ];

            setMarcacionesExistentes(existentes);
            setAusenciasActivas(ausencias);
            setFilas(detectarEmpleadosDuplicados(aplicarAusencias(aplicarAcumulados(filasAgrupadas, existentes), ausencias)));
        } catch (err: unknown) {
            Logger.error('Error al leer archivo de marcaciones', { ubicacionNombre }, err);
            setError(t('horasExtras.importacion_error_lectura'));
        } finally {
            setIsParsing(false);
        }
    };

    const handleDescargarPlantilla = async () => {
        const { utils, writeFile } = await import('xlsx');
        const encabezados = [...MARCACION_PLANTILLA_COMPLETA_HEADERS];
        // Fila de ejemplo: solo los 5 campos que el sistema realmente lee (ID de usuario, Nombre,
        // Fecha, Entrada, Salir) quedan con datos de muestra; el resto de columnas (cálculos que
        // genera el reloj marcador — OT, Corto, sumhr, leavetype, etc.) quedan vacías a propósito,
        // para no insinuar que hay que completarlas a mano.
        const filaEjemplo = encabezados.map((encabezado) => {
            switch (encabezado) {
                case 'ID de usuario': return '1035';
                case 'Nombre': return 'Juan Pérez';
                case 'Fecha': return '2026-07-20';
                case 'Entrada': return '08:00';
                case 'Salir': return '17:00';
                default: return '';
            }
        });
        const hoja = utils.aoa_to_sheet([encabezados, filaEjemplo]);
        const libro = utils.book_new();
        utils.book_append_sheet(libro, hoja, 'Marcaciones');
        writeFile(libro, 'plantilla_marcaciones.xlsx');
    };

    // Bugfix (auditoría): descartar dejaba las advertencias de duplicado/120h de las filas
    // hermanas obsoletas para siempre (solo marcaba `descartada`, sin recalcular) — misma
    // cadena de recálculo que ya corre `editarFila` tras cualquier otro cambio.
    const handleDescartarFila = (idUsuarioArchivo: string, fecha: string) => {
        setFilas((prev) => {
            if (!prev) return prev;
            const actualizadas = prev.map((f) => (f.idUsuarioArchivo === idUsuarioArchivo && f.fecha === fecha ? { ...f, descartada: true } : f));
            return detectarEmpleadosDuplicados(aplicarAusencias(aplicarAcumulados(actualizadas, marcacionesExistentes), ausenciasActivas));
        });
    };

    /**
     * Aplica una corrección manual (US-HEX-05 CA1) a una fila: revalida esa fila (CA2 marca
     * `editadoManualmente`), recalcula los acumulados de todo el lote, y audita el cambio
     * (CA3) — mismo patrón de `auditService.logAction` usado para el revelado de campos
     * sensibles en el perfil de empleado (IMPL-3), sin necesitar un nuevo valor de
     * `audit_action` porque 'UPDATE' ya existe.
     */
    const editarFila = (idUsuarioArchivo: string, fecha: string, cambios: Partial<FilaValidacion>, campo: string, valorAnterior: unknown, valorNuevo: unknown) => {
        if (!quincenaSeleccionada) return;
        setFilas((prev) => {
            if (!prev) return prev;
            const actualizadas = prev.map((f) => {
                if (f.idUsuarioArchivo !== idUsuarioArchivo || f.fecha !== fecha) return f;
                return revalidarFila({ ...f, ...cambios }, quincenaSeleccionada.fecha_inicio, quincenaSeleccionada.fecha_fin, contextoCalculoHoras);
            });
            return detectarEmpleadosDuplicados(aplicarAusencias(aplicarAcumulados(actualizadas, marcacionesExistentes), ausenciasActivas));
        });

        auditService.logAction('UPDATE', 'planilla_marcaciones_edicion_manual', undefined, {
            quincena_id: quincenaSeleccionada.id,
            id_usuario_archivo: idUsuarioArchivo,
            fecha,
            campo,
            valor_anterior: valorAnterior,
            valor_nuevo: valorNuevo,
        });
    };

    const handleAsignarEmpleado = (idUsuarioArchivo: string, fecha: string, empleado: Pick<Empleado, 'id' | 'nombre_completo' | 'estado' | 'cargo' | 'departamento' | 'ubicacion_id'>) => {
        editarFila(idUsuarioArchivo, fecha, {
            empleadoId: empleado.id,
            empleadoNombre: empleado.nombre_completo,
            empleadoEstado: empleado.estado,
            empleadoCargo: empleado.cargo,
            empleadoDepartamento: empleado.departamento,
            // IMPL-28 — una reasignación manual también puede traer un empleado de otra
            // ubicación; se re-deriva acá igual que en el matching automático.
            empleadoUbicacionId: empleado.ubicacion_id,
        }, 'empleado_id', idUsuarioArchivo, empleado.nombre_completo);
    };

    const handleEditarHora = (fila: FilaValidacion, campo: 'entrada' | 'salida', valor: string) => {
        const tramoActual = fila.tramos[0];
        if (!tramoActual) return;
        const valorAnterior = campo === 'entrada' ? tramoActual.entrada : tramoActual.salida;
        const nuevoTramo = { ...tramoActual, [campo]: `${fila.fecha}T${valor}:00` };
        editarFila(fila.idUsuarioArchivo, fila.fecha, { tramos: [nuevoTramo] }, `hora_${campo}`, valorAnterior, nuevoTramo[campo]);
    };

    /** IMPL-22 CA5 — Fecha editable: mueve todos los tramos del día al nuevo día calendario
     * (misma hora, fecha nueva), disparando el mismo recálculo de horas que Hora Inicio/Fin. */
    const handleEditarFecha = (fila: FilaValidacion, nuevaFecha: string) => {
        const nuevosTramos = fila.tramos.map((tr) => ({
            entrada: `${nuevaFecha}T${tr.entrada.slice(11)}`,
            salida: `${nuevaFecha}T${tr.salida.slice(11)}`,
        }));
        editarFila(fila.idUsuarioArchivo, fila.fecha, { fecha: nuevaFecha, tramos: nuevosTramos }, 'fecha', fila.fecha, nuevaFecha);
    };

    const reemplazar = () => {
        setArchivo(null);
        setFilas(null);
        setError(null);
        setConfirmacion120h(false);
        setAgregados([]);
        setBusquedaTexto('');
        setResultadosBusqueda([]);
        setErrorAgregar(null);
        setAusenciasActivas([]);
        setRosterUbicacion([]);
        setPermisosQuincena([]);
        setMostrarDetalleAusencias(false);
        setEditandoConfirmados(false);
        if (inputRef.current) inputRef.current.value = '';
    };

    // El selector de quincena vive en el header compartido (PlanillaLayout) — al cambiar de
    // quincena ahí, se limpia cualquier archivo/filas sin confirmar de la quincena anterior.
    useEffect(() => {
        reemplazar();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [quincenaId]);

    // US-HEX-07 CA1/CA4 — búsqueda de empleado tenant-wide (no restringida a codigo_empleado_manual
    // ni a esta ubicación, porque el empleado agregado puede ser habitualmente de otra ubicación).
    // US-UX-02 (fidelidad al prototipo del PM) — sin mínimo de caracteres: al enfocar ya se ve
    // una primera página de empleados (termino vacío), escribir la filtra contra el servidor.
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

    const handleSeleccionarParaAgregar = (empleado: Empleado) => {
        setErrorAgregar(null);
        if (agregados.some((a) => a.empleadoId === empleado.id)) {
            setErrorAgregar(t('horasExtras.agregar_empleado_ya_en_lote'));
            return;
        }
        const yaMatcheado = filas?.some((f) => !f.descartada && f.empleadoId === empleado.id);
        if (yaMatcheado) {
            setErrorAgregar(t('horasExtras.agregar_empleado_ya_matcheado'));
            return;
        }
        setAgregados((prev) => [...prev, {
            empleadoId: empleado.id,
            nombreCompleto: empleado.nombre_completo,
            sueldoMensual: empleado.sueldo_mensual,
            ubicacionHabitualId: empleado.ubicacion_id,
            hed: 0, hen: 0, nocturnidad: 0, feriado: 0,
        }]);
        setBusquedaTexto('');
        setResultadosBusqueda([]);
        setBusquedaAbierta(false);
    };

    const handleActualizarHoraAgregado = (empleadoId: string, campo: CampoHoras, valor: string) => {
        const numero = Math.max(0, Number(valor) || 0);
        setAgregados((prev) => prev.map((a) => (a.empleadoId === empleadoId ? { ...a, [campo]: numero } : a)));
    };

    const handleQuitarAgregado = (empleadoId: string) => {
        setAgregados((prev) => prev.filter((a) => a.empleadoId !== empleadoId));
    };

    const nombreUbicacion = (ubicacionHabitualId: string | null): string | null => {
        if (!ubicacionHabitualId || ubicacionHabitualId === ubicacionId) return null;
        return ubicaciones.find((u) => u.id === ubicacionHabitualId)?.nombre ?? null;
    };

    const { conteoOk, conteoAdvertencia, conteoError, requiere120h } = useMemo(() => {
        if (!filas) return { conteoOk: 0, conteoAdvertencia: 0, conteoError: 0, requiere120h: false };
        let ok = 0, adv = 0, err = 0, req120 = false;
        for (const f of filas) {
            if (f.descartada) continue;
            const estado = estadoDeFila(f);
            if (estado === 'error') err++;
            else if (estado === 'advertencia') { adv++; if (f.advertencias.some((a) => a === t('horasExtras.validacion_advertencia_120h'))) req120 = true; }
            else ok++;
        }
        return { conteoOk: ok, conteoAdvertencia: adv, conteoError: err, requiere120h: req120 };
    }, [filas, t]);

    const puedeConfirmar = filas !== null && conteoError === 0 && (!requiere120h || confirmacion120h);

    const handleConfirmar = async () => {
        if (!filas || !profile?.id || !quincenaSeleccionada) return;
        setIsConfirmando(true);
        try {
            // Gap real IMPL-28 (US-HEX-10 CA1/CA2) — cada fila se atribuye a la ubicación del
            // PERFIL del empleado matcheado, no a la pantalla actual, cuando trabajó físicamente
            // acá pero pertenece a otra sede. `?? ubicacionId` cubre tanto al empleado sin
            // ubicación asignada en su perfil como al caso normal (misma ubicación).
            const marcacionesRows: NuevaMarcacionRPC[] = filas
                .filter((f) => !f.descartada && f.empleadoId)
                .flatMap((f) => f.tramos.map((tramo) => ({
                    empleado_id: f.empleadoId as string,
                    entrada: tramo.entrada,
                    salida: tramo.salida,
                    id_usuario_archivo: f.idUsuarioArchivo,
                    editado_manualmente: f.editadoManualmente,
                    ubicacion_id: f.empleadoUbicacionId ?? ubicacionId,
                })));

            // Defecto real (2026-09-23) — antes `f.hed`/`f.hen`/etc. de los empleados
            // matcheados automáticamente por el reloj se mostraban en pantalla pero NUNCA se
            // persistían como dinero real: solo iban a `planilla_marcaciones` (tramos crudos),
            // tabla que `calcular_planilla_empleado` (el motor real) jamás lee. `compensarCortosPorEmpleado`
            // agrupa por empleado (sumando todos sus días de la quincena) Y aplica IMPL-27
            // (Perdón de Saldo Negativo: los "cortos" del período se restan primero de HEN,
            // luego de HED, sin quedar nunca negativo) antes de calcular el monto real.
            const horasCompensadas = compensarCortosPorEmpleado(filas);
            const relojRows: NuevoAgregadoManual[] = Array.from(horasCompensadas.entries()).map(([empleadoId, horas]) => {
                const empleadoMatch = empleadosMatch.find((e) => e.id === empleadoId);
                const sueldoMensual = empleadoMatch?.sueldo_mensual ?? 0;
                return {
                    empleado_id: empleadoId,
                    hed: horas.hed,
                    hen: horas.hen,
                    nocturnidad: horas.nocturnidad,
                    feriado: horas.feriado,
                    monto_total: calcularMontoHorasExtras(sueldoMensual, horas).montoTotal,
                    agregado_manualmente: false,
                    ubicacion_id: empleadoMatch?.ubicacion_id ?? ubicacionId,
                };
            });

            const agregadosRows: NuevoAgregadoManual[] = agregados.map((a) => ({
                empleado_id: a.empleadoId,
                hed: a.hed,
                hen: a.hen,
                nocturnidad: a.nocturnidad,
                feriado: a.feriado,
                monto_total: calcularMontoHorasExtras(a.sueldoMensual ?? 0, { hed: a.hed, hen: a.hen, nocturnidad: a.nocturnidad, feriado: a.feriado }).montoTotal,
                agregado_manualmente: true,
                ubicacion_id: a.ubicacionHabitualId ?? ubicacionId,
            }));

            const ausenciasInjustificadasRows: NuevaAusenciaInjustificadaRPC[] = ausenciasInjustificadas.map((a) => ({
                empleado_id: a.empleadoId,
                fecha: a.fecha,
            }));

            await marcacionesService.confirmarImportacion(
                quincenaSeleccionada.id,
                ubicacionId,
                marcacionesRows,
                [...relojRows, ...agregadosRows],
                ausenciasInjustificadasRows,
                profile.id
            );
            setUbicacionEstado((prev) => (prev ? { ...prev, estado: 'completado', completado_por: profile.id, completado_at: new Date().toISOString() } : prev));
        } catch (err: unknown) {
            Logger.error('Error al confirmar importación de marcaciones', { quincenaId }, err);
            setError(t('horasExtras.importacion_error_confirmar'));
        } finally {
            setIsConfirmando(false);
        }
    };

    if (isLoadingModulo) {
        return <div className="h-32 bg-surface rounded-lg animate-pulse" />;
    }

    if (ubicacionEstado?.estado === 'completado' || quincenaCerrada) {
        const viaSinRegistros = ubicacionEstado?.estado === 'completado' && ubicacionEstado.via_sin_registros;
        return (
            <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
                <div className="flex items-start gap-3 bg-surface rounded-lg p-md">
                    <Lock size={16} className="text-text-secondary shrink-0 mt-0.5" />
                    <p className="text-caption text-text-secondary">
                        {ubicacionEstado?.estado === 'completado'
                            ? (ubicacionEstado.via_sin_registros ? t('horasExtras.badge_sin_horas_extra') : t('horasExtras.importacion_modulo_confirmado'))
                            : t('horasExtras.importacion_quincena_cerrada')}
                    </p>
                </div>

                {!viaSinRegistros && isLoadingConfirmado && <div className="h-24 bg-surface rounded animate-pulse" />}

                {!viaSinRegistros && !isLoadingConfirmado && filasConfirmadasCalculadas.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('horasExtras.importacion_confirmado_tramos_title')}</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="text-[10px] font-bold uppercase tracking-widest text-text-secondary border-b border-border/50">
                                        <th className="py-2 pr-2" />
                                        <th className="py-2 px-2">{t('horasExtras.col_nombre_completo')}</th>
                                        <th className="py-2 px-2">{t('horasExtras.col_fecha')}</th>
                                        <th className="py-2 px-2" colSpan={2}>{t('horasExtras.col_hora_inicio')}/{t('horasExtras.col_hora_fin')}</th>
                                        <th className="py-2 px-2 text-right">{t('horasExtras.col_horas_regulares')}</th>
                                        <th className="py-2 px-2 text-right">{t('horasExtras.col_hed')}</th>
                                        <th className="py-2 px-2 text-right">{t('horasExtras.col_hen')}</th>
                                        <th className="py-2 px-2 text-right">{t('horasExtras.col_nocturnidad')}</th>
                                        <th className="py-2 px-2 text-right">{t('horasExtras.col_feriado')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filasConfirmadasCalculadas.map((f) => {
                                        const estado = estadoDeFila(f);
                                        const notas = [...f.errores, ...f.advertencias, ...f.informativos];
                                        return (
                                            <React.Fragment key={`${f.empleadoId}|${f.fecha}`}>
                                                <tr className={`${notas.length > 0 ? '' : 'border-b border-border/30 last:border-b-0'} ${estado === 'advertencia' ? 'bg-amber-50/30' : ''}`}>
                                                    <td className="py-2 pr-2">
                                                        {estado === 'advertencia' ? <AlertTriangle size={16} className="text-amber-600" /> : <CheckCircle2 size={16} className="text-emerald-600" />}
                                                    </td>
                                                    <td className="py-2 px-2">{f.empleadoNombre}</td>
                                                    <td className="py-2 px-2">{f.fecha}</td>
                                                    <td className="py-2 px-2" colSpan={2}>
                                                        {f.tramos.map((t) => `${t.entrada.slice(11, 16)}-${t.salida.slice(11, 16)}`).join(', ')}
                                                    </td>
                                                    <td className="py-2 px-2 text-right tabular-nums">{f.horasRegulares.toFixed(2)}</td>
                                                    <td className="py-2 px-2 text-right tabular-nums">{f.hed.toFixed(2)}</td>
                                                    <td className="py-2 px-2 text-right tabular-nums">{f.hen.toFixed(2)}</td>
                                                    <td className="py-2 px-2 text-right tabular-nums">{f.nocturnidad.toFixed(2)}</td>
                                                    <td className="py-2 px-2 text-right tabular-nums">{f.feriado.toFixed(2)}</td>
                                                </tr>
                                                {notas.length > 0 && (
                                                    <tr className={`border-b border-border/30 last:border-b-0 ${estado === 'advertencia' ? 'bg-amber-50/30' : ''}`}>
                                                        <td className="py-1.5 pl-9 pr-2" colSpan={10}>
                                                            <ul className="flex flex-col gap-0.5 text-[11px] text-text-secondary">
                                                                {notas.map((nota, i) => <li key={i}>· {nota}</li>)}
                                                            </ul>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {!isLoadingConfirmado && agregadosConfirmados.length > 0 && (
                    <div className="flex flex-col gap-2">
                        <p className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('horasExtras.importacion_confirmado_agregados_title')}</p>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="text-[10px] font-bold uppercase tracking-widest text-text-secondary border-b border-border/50">
                                        <th className="py-2 pr-2">{t('horasExtras.col_nombre_completo')}</th>
                                        <th className="py-2 px-2">{t('horasExtras.col_hed')}</th>
                                        <th className="py-2 px-2">{t('horasExtras.col_hen')}</th>
                                        <th className="py-2 px-2">{t('horasExtras.col_nocturnidad')}</th>
                                        <th className="py-2 px-2">{t('horasExtras.col_feriado')}</th>
                                        <th className="py-2 px-2 text-right">{t('horasExtras.col_monto')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {agregadosConfirmados.map((a) => (
                                        <tr key={a.empleado_id} className="border-b border-border/30 last:border-b-0">
                                            <td className="py-2 pr-2">{a.empleado?.nombre_completo ?? t('horasExtras.sin_match')}</td>
                                            <td className="py-2 px-2">{a.hed}</td>
                                            <td className="py-2 px-2">{a.hen}</td>
                                            <td className="py-2 px-2">{a.nocturnidad}</td>
                                            <td className="py-2 px-2">{a.feriado}</td>
                                            <td className="py-2 px-2 text-right font-semibold text-heading">${a.monto_total.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

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
            </section>
        );
    }

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
            <div className="bg-primary-light/30 border border-primary/20 rounded-lg p-md flex items-start gap-3">
                <Info size={16} className="text-primary shrink-0 mt-0.5" />
                <div className="flex flex-col gap-2">
                    <div>
                        <p className="text-caption font-semibold text-heading">{t('horasExtras.importacion_instrucciones_title')}</p>
                        <p className="text-caption text-text-secondary">{t('horasExtras.importacion_instrucciones_desc')}</p>
                    </div>
                    <button type="button" onClick={handleDescargarPlantilla} className="self-start flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline">
                        <Download size={14} /> {t('horasExtras.importacion_descargar_plantilla')}
                    </button>
                </div>
            </div>

            {!filas && (
                <div
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onDrop={(e) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) procesarArchivo(file); }}
                    onClick={() => inputRef.current?.click()}
                    className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-lg p-xl text-center cursor-pointer transition-colors ${isDragging ? 'border-primary bg-primary-light/20' : 'border-border hover:bg-surface/50'}`}
                >
                    <UploadCloud size={28} className={isDragging ? 'text-primary' : 'text-text-secondary/50'} />
                    <p className="text-body font-semibold text-heading">{t('horasExtras.importacion_dropzone_title')}</p>
                    <p className="text-caption text-text-secondary">{t('horasExtras.importacion_dropzone_desc')}</p>
                    <input ref={inputRef} type="file" accept=".xls,.xlsx" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) procesarArchivo(file); }} />
                </div>
            )}

            {!filas && (
                <div className="self-end" onClick={(e) => e.stopPropagation()}>
                    <BotonSinHorasExtraUbicacion
                        quincenaId={quincenaId}
                        ubicacionId={ubicacionId}
                        onConfirmado={() => setUbicacionEstado((prev) => (prev ? { ...prev, estado: 'completado', via_sin_registros: true, completado_por: profile?.id ?? null, completado_at: new Date().toISOString() } : prev))}
                    />
                </div>
            )}

            {isParsing && <div className="h-16 bg-surface rounded animate-pulse" />}
            {error && <p className="text-caption text-error">{error}</p>}

            {(archivo || editandoConfirmados) && filas && (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-3 bg-surface rounded-lg p-md flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                            {archivo ? (
                                <>
                                    <FileSpreadsheet size={18} className="text-primary shrink-0" />
                                    <p className="text-caption font-semibold text-heading truncate">{archivo.name}</p>
                                </>
                            ) : (
                                <>
                                    <Pencil size={18} className="text-primary shrink-0" />
                                    <p className="text-caption font-semibold text-heading truncate">{t('horasExtras.editando_confirmados_titulo')}</p>
                                </>
                            )}
                        </div>
                        <div className="flex items-center gap-3 text-[11px] font-bold">
                            <span className="flex items-center gap-1 text-emerald-600"><CheckCircle2 size={12} /> {conteoOk} OK</span>
                            <span className="flex items-center gap-1 text-amber-600"><AlertTriangle size={12} /> {conteoAdvertencia}</span>
                            <span className="flex items-center gap-1 text-error"><XCircle size={12} /> {conteoError}</span>
                        </div>
                        <Button variant="ghost" size="sm" onClick={reemplazar} className="flex items-center gap-1">
                            <X size={14} /> {archivo ? t('horasExtras.action_reemplazar') : t('horasExtras.action_cancelar_edicion')}
                        </Button>
                    </div>

                    {ausenciasInjustificadas.length > 0 && (() => {
                        const porEmpleado = new Map<string, { nombre: string; fechas: string[] }>();
                        for (const a of ausenciasInjustificadas) {
                            const entrada = porEmpleado.get(a.empleadoId) ?? { nombre: a.empleadoNombre, fechas: [] };
                            entrada.fechas.push(a.fecha);
                            porEmpleado.set(a.empleadoId, entrada);
                        }
                        const detalle = Array.from(porEmpleado.values());
                        return (
                            <div className="flex items-start gap-2 bg-amber-50/60 border border-amber-200 rounded-lg p-md">
                                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                <div className="flex flex-col gap-1">
                                    <p className="text-caption font-semibold text-heading">
                                        {t('horasExtras.ausencias_injustificadas_resumen', { empleados: detalle.length, dias: ausenciasInjustificadas.length })}
                                    </p>
                                    <p className="text-caption text-text-secondary">{t('horasExtras.ausencias_injustificadas_aviso')}</p>
                                    <button
                                        type="button"
                                        onClick={() => setMostrarDetalleAusencias((v) => !v)}
                                        className="self-start text-[13px] font-semibold text-primary hover:underline"
                                    >
                                        {mostrarDetalleAusencias ? t('horasExtras.action_ocultar_detalle') : t('horasExtras.action_ver_detalle')}
                                    </button>
                                    {mostrarDetalleAusencias && (
                                        <ul className="flex flex-col gap-1 mt-1">
                                            {detalle.map((e) => (
                                                <li key={e.nombre} className="text-caption text-heading">
                                                    <span className="font-semibold">{e.nombre}</span>: {e.fechas.join(', ')}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>
                        );
                    })()}

                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead>
                                <tr className="text-[10px] font-bold uppercase tracking-widest text-text-secondary border-b border-border/50">
                                    <th className="py-2 pr-2">{t('horasExtras.col_estado')}</th>
                                    <th className="py-2 px-2">{t('horasExtras.col_nombre_completo')}</th>
                                    <th className="py-2 px-2">{t('horasExtras.col_fecha')}</th>
                                    <th className="py-2 px-2">{t('horasExtras.col_hora_inicio')}</th>
                                    <th className="py-2 px-2">{t('horasExtras.col_hora_fin')}</th>
                                    <th className="py-2 px-2 text-right">{t('horasExtras.col_horas_regulares')}</th>
                                    <th className="py-2 px-2 text-right">{t('horasExtras.col_hed')}</th>
                                    <th className="py-2 px-2 text-right">{t('horasExtras.col_hen')}</th>
                                    <th className="py-2 px-2 text-right">{t('horasExtras.col_nocturnidad')}</th>
                                    <th className="py-2 px-2 text-right">{t('horasExtras.col_feriado')}</th>
                                    <th className="py-2 pl-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {filas.map((f) => {
                                    const estado = f.descartada ? null : estadoDeFila(f);
                                    // Defecto real (2026-09-23) — IMPL-22 CA5 dice explícitamente que el Preparador
                                    // puede editar Fecha/Hora Inicio/Hora Fin de CUALQUIER fila ya importada, no
                                    // solo las que tienen error o advertencia. Antes una fila que matcheaba limpio
                                    // quedaba de solo lectura sin ninguna forma de corregirla.
                                    const esEditable = !f.descartada;
                                    const tramoUnico = f.tramos.length === 1 ? f.tramos[0] : null;
                                    // Defecto real (2026-09-23) — antes esta lista vivía apretada en una columna
                                    // "Notas" al final de una fila ya de por sí muy ancha, obligando a scrollear
                                    // hasta el final para leerla. Ahora se muestra en una fila propia debajo,
                                    // con el ancho completo de la tabla, solo cuando hay algo que mostrar.
                                    const notas = [...f.errores, ...f.advertencias, ...f.informativos];

                                    return (
                                        <React.Fragment key={`${f.idUsuarioArchivo}|${f.fecha}`}>
                                        <tr
                                            className={`${notas.length > 0 ? '' : 'border-b border-border/30 last:border-b-0'} align-top ${f.descartada ? 'opacity-40' : ''} ${
                                                estado === 'error' ? 'bg-red-50/40' : estado === 'advertencia' ? 'bg-amber-50/30' : ''
                                            }`}
                                        >
                                            <td className="py-2 pr-2">
                                                {f.descartada ? (
                                                    <span className="text-[10px] text-text-secondary italic">{t('horasExtras.fila_descartada')}</span>
                                                ) : estado === 'error' ? (
                                                    <XCircle size={16} className="text-error" />
                                                ) : estado === 'advertencia' ? (
                                                    <AlertTriangle size={16} className="text-amber-600" />
                                                ) : (
                                                    <CheckCircle2 size={16} className="text-emerald-600" />
                                                )}
                                            </td>
                                            <td className="py-2 px-2 min-w-45">
                                                {esEditable ? (
                                                    <BuscadorEmpleadoFila
                                                        valorActual={f.empleadoNombre}
                                                        onSeleccionar={(empleado) => handleAsignarEmpleado(f.idUsuarioArchivo, f.fecha, empleado)}
                                                    />
                                                ) : (
                                                    f.empleadoNombre ?? `${t('horasExtras.sin_match')} (${f.idUsuarioArchivo})`
                                                )}
                                                {f.editadoManualmente && (
                                                    <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full bg-primary-light text-primary">
                                                        <Pencil size={9} /> {t('horasExtras.badge_editado_manualmente')}
                                                    </span>
                                                )}
                                            </td>
                                            <td className="py-2 px-2">
                                                {esEditable ? (
                                                    // IMPL-137 — input nativo <type="date"> mostraba MM/DD/YYYY según el
                                                    // navegador/SO del usuario; InputField mask="date" siempre muestra
                                                    // DD/MM/AAAA sin importar la configuración regional del cliente.
                                                    <InputField
                                                        type="date"
                                                        mask="date"
                                                        value={f.fecha}
                                                        onChange={(e) => handleEditarFecha(f, e.target.value)}
                                                        className="w-36"
                                                    />
                                                ) : (
                                                    f.fecha
                                                )}
                                            </td>
                                            {esEditable && tramoUnico ? (
                                                <>
                                                    <td className="py-2 px-2">
                                                        <input
                                                            type="time"
                                                            value={tramoUnico.entrada.slice(11, 16)}
                                                            onChange={(e) => handleEditarHora(f, 'entrada', e.target.value)}
                                                            className="rounded-md border border-border bg-white px-1.5 py-1 text-[12px] w-26"
                                                        />
                                                    </td>
                                                    <td className="py-2 px-2">
                                                        <input
                                                            type="time"
                                                            value={tramoUnico.salida.slice(11, 16)}
                                                            onChange={(e) => handleEditarHora(f, 'salida', e.target.value)}
                                                            className="rounded-md border border-border bg-white px-1.5 py-1 text-[12px] w-26"
                                                        />
                                                    </td>
                                                </>
                                            ) : (
                                                <td className="py-2 px-2" colSpan={2}>
                                                    {f.tramos.map((t) => `${t.entrada.slice(11, 16)}-${t.salida.slice(11, 16)}`).join(', ')}
                                                </td>
                                            )}
                                            {/* IMPL-22 CA5 — siempre calculadas, nunca captura manual en este flujo. */}
                                            <td className="py-2 px-2 text-right tabular-nums">{f.horasRegulares.toFixed(2)}</td>
                                            <td className="py-2 px-2 text-right tabular-nums">{f.hed.toFixed(2)}</td>
                                            <td className="py-2 px-2 text-right tabular-nums">{f.hen.toFixed(2)}</td>
                                            <td className="py-2 px-2 text-right tabular-nums">{f.nocturnidad.toFixed(2)}</td>
                                            <td className="py-2 px-2 text-right tabular-nums">{f.feriado.toFixed(2)}</td>
                                            <td className="py-2 pl-2 text-right">
                                                {!f.descartada && f.errores.length > 0 && (
                                                    <button type="button" onClick={() => handleDescartarFila(f.idUsuarioArchivo, f.fecha)} className="text-[11px] font-semibold text-error hover:underline">
                                                        {t('horasExtras.action_descartar_fila')}
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                        {notas.length > 0 && (
                                            <tr className={`border-b border-border/30 last:border-b-0 ${estado === 'error' ? 'bg-red-50/40' : estado === 'advertencia' ? 'bg-amber-50/30' : ''}`}>
                                                <td className="py-1.5 pl-9 pr-2" colSpan={11}>
                                                    <ul className="flex flex-col gap-0.5 text-[11px] text-text-secondary">
                                                        {notas.map((nota, i) => <li key={i}>· {nota}</li>)}
                                                    </ul>
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    {filas.some((f) => f.tramos.length > 1 && !f.descartada && estadoDeFila(f) !== 'ok') && (
                        <p className="text-[11px] text-text-secondary italic">{t('horasExtras.importacion_nota_multi_tramo_no_editable')}</p>
                    )}

                    {/* US-HEX-07 — Agregar Empleado No Detectado: sección visualmente separada de la
                        tabla de resultados del archivo (CA2), no filas mezcladas en la misma tabla,
                        porque su forma de datos (horas por tipo) es distinta de los tramos del reloj. */}
                    <div className="flex flex-col gap-3 bg-primary-light/10 border border-primary/20 rounded-lg p-md">
                        <div className="flex items-center gap-2">
                            <UserPlus size={16} className="text-primary" />
                            <p className="text-caption font-semibold text-heading">{t('horasExtras.agregar_empleado_title')}</p>
                        </div>

                        {agregados.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="text-[10px] font-bold uppercase tracking-widest text-text-secondary border-b border-border/50">
                                            <th className="py-2 pr-2">{t('horasExtras.col_nombre_completo')}</th>
                                            <th className="py-2 px-2">{t('horasExtras.col_hed')}</th>
                                            <th className="py-2 px-2">{t('horasExtras.col_hen')}</th>
                                            <th className="py-2 px-2">{t('horasExtras.col_nocturnidad')}</th>
                                            <th className="py-2 px-2">{t('horasExtras.col_feriado')}</th>
                                            <th className="py-2 px-2 text-right">{t('horasExtras.col_monto')}</th>
                                            <th className="py-2 pl-2" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {agregados.map((a) => {
                                            const sinSueldo = a.sueldoMensual === null;
                                            const montoTotal = sinSueldo ? 0 : calcularMontoHorasExtras(a.sueldoMensual as number, { hed: a.hed, hen: a.hen, nocturnidad: a.nocturnidad, feriado: a.feriado }).montoTotal;
                                            const ubicacionHabitual = nombreUbicacion(a.ubicacionHabitualId);
                                            return (
                                                <tr key={a.empleadoId} className="border-b border-border/30 last:border-b-0 align-top">
                                                    <td className="py-2 pr-2">
                                                        <p className="font-medium text-heading">{a.nombreCompleto}</p>
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full bg-primary text-white">
                                                                <UserPlus size={9} /> {t('horasExtras.badge_agregado_manualmente')}
                                                            </span>
                                                            {sinSueldo && (
                                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide rounded-full bg-error/10 text-error">
                                                                    {t('horasExtras.badge_sin_sueldo')}
                                                                </span>
                                                            )}
                                                        </div>
                                                        {ubicacionHabitual && (
                                                            <p className="text-[11px] text-text-secondary italic mt-1">{t('horasExtras.agregar_empleado_otra_ubicacion_nota', { ubicacion: ubicacionHabitual })}</p>
                                                        )}
                                                    </td>
                                                    {CAMPOS_HORAS.map((campo) => (
                                                        <td className="py-2 px-2" key={campo}>
                                                            <input
                                                                type="number"
                                                                min={0}
                                                                step="0.5"
                                                                value={a[campo]}
                                                                onChange={(e) => handleActualizarHoraAgregado(a.empleadoId, campo, e.target.value)}
                                                                className="w-20 rounded-md border border-border bg-white px-2 py-1 text-[13px]"
                                                            />
                                                        </td>
                                                    ))}
                                                    <td className="py-2 px-2 text-right font-semibold text-heading">{sinSueldo ? '—' : `$${montoTotal.toFixed(2)}`}</td>
                                                    <td className="py-2 pl-2 text-right">
                                                        <button type="button" onClick={() => handleQuitarAgregado(a.empleadoId)} className="text-[11px] font-semibold text-error hover:underline">
                                                            {t('horasExtras.action_quitar')}
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}

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

                    {requiere120h && (
                        <label className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-md text-caption text-heading">
                            <input type="checkbox" checked={confirmacion120h} onChange={(e) => setConfirmacion120h(e.target.checked)} className="mt-0.5" />
                            {t('horasExtras.confirmacion_120h')}
                        </label>
                    )}

                    <div className="flex items-center justify-end gap-3">
                        <BotonSinHorasExtraUbicacion
                            quincenaId={quincenaId}
                            ubicacionId={ubicacionId}
                            onConfirmado={() => setUbicacionEstado((prev) => (prev ? { ...prev, estado: 'completado', via_sin_registros: true, completado_por: profile?.id ?? null, completado_at: new Date().toISOString() } : prev))}
                        />
                        <Button onClick={handleConfirmar} disabled={!puedeConfirmar} isLoading={isConfirmando} className="flex items-center gap-2">
                            {t('horasExtras.action_confirmar_importacion')}
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
};
