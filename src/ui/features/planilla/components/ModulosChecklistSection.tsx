import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ListChecks, CheckCircle2, Clock, Circle, Clock8, Wallet, HeartPulse, HandCoins, Landmark, CalendarRange, CalendarOff, Gift, type LucideIcon } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import {
    modulosQuincenaService, MODULOS_OBLIGATORIOS, MODULOS_CON_ESCAPE_SIN_REGISTROS,
    type QuincenaModuloEstado, type ModuloPlanilla,
} from '../../../../services/modulosQuincenaService';
import { useToast } from '../../../../context/ToastContext';
import { auditService } from '../../../../services/auditService';
import type { TipoQuincena } from '../../../../utils/quincenaUtils';
import { Button } from '../../../components/Button';
import { Logger } from '../../../../utils/logger';

/** Mismos íconos que ya usa el sidebar para cada módulo (`MainLayout.tsx`) — se reusa la
 * asociación existente en vez de elegir íconos nuevos para el mismo concepto. */
const MODULO_ICON: Record<ModuloPlanilla, LucideIcon> = {
    horas_extras: Clock8,
    viaticos: Wallet,
    incapacidades: HeartPulse,
    anticipos: HandCoins,
    descuentos: Landmark,
    vacaciones: CalendarRange,
    bonificaciones: Gift,
    permisos: CalendarOff,
};

interface ModulosChecklistSectionProps {
    quincenaId: string;
    tipoQuincena: TipoQuincena;
    isReadOnly: boolean;
    onCompletionChange?: (completo: boolean, faltantes: ModuloPlanilla[]) => void;
}

/**
 * Checklist "Estado de Módulos" (US-QNA-00 CA3 / US-QNA-06). Los 4 módulos con escape de
 * "Sin registros este período" (Viáticos, Incapacidades, Vacaciones, Bonificaciones) se
 * confirman como "no hubo actividad este período". Horas Extras, Anticipos y Descuentos
 * requieren datos reales por diseño (sin escape) — confirman vía acción real del módulo
 * (Horas Extras: `completarUbicacion` al terminar cada ubicación; Anticipos/Descuentos:
 * `confirmarModuloConDatos` al procesar cuotas de la quincena), revisión épica por épica.
 *
 * IMPL-16 CA1 (septiembre 2026) — el estado "con datos" (amarillo) NO se persiste en
 * `estado` (el salto en la fila sigue siendo directo de `pendiente` a `confirmado`, vía RPC).
 * Se calcula al vuelo con `tieneRegistrosReales` para los 8 módulos obligatorios y se muestra
 * como badge/ícono ámbar — evita tener que enganchar un side-effect de escritura en cada uno
 * de los 8 flujos de guardado distintos para lograr el mismo resultado visual.
 */
export const ModulosChecklistSection: React.FC<ModulosChecklistSectionProps> = ({ quincenaId, tipoQuincena, isReadOnly, onCompletionChange }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const [estados, setEstados] = useState<QuincenaModuloEstado[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [confirmandoModulo, setConfirmandoModulo] = useState<ModuloPlanilla | null>(null);
    // Bugfix (auditoría, hallazgo crítico #6): por módulo con escape de "sin registros", si ya
    // hay datos reales cargados se ofrece "Confirmar con Datos" en vez de "Sin registros este
    // período" — evita que el checklist quede etiquetado como "sin actividad" cuando no es así.
    const [tieneRegistros, setTieneRegistros] = useState<Partial<Record<ModuloPlanilla, boolean>>>({});

    const esQuincena25 = tipoQuincena === 'quincena_25';

    const cargar = useCallback(async () => {
        if (!profile?.tenant_id || esQuincena25) { setIsLoading(false); return; }
        setIsLoading(true);
        try {
            const data = await modulosQuincenaService.inicializarEstados(profile.tenant_id, quincenaId);
            setEstados(data);
            const chequeos = await Promise.all(
                MODULOS_OBLIGATORIOS.map(async (modulo) => [modulo, await modulosQuincenaService.tieneRegistrosReales(quincenaId, modulo)] as const)
            );
            setTieneRegistros(Object.fromEntries(chequeos));
        } catch (err: unknown) {
            Logger.error('Error al cargar estado de módulos', { quincenaId }, err);
            showToast(t('quincenas.modulo_error_cargar'), 'error');
        } finally {
            setIsLoading(false);
        }
    }, [profile?.tenant_id, quincenaId, esQuincena25, showToast, t]);

    useEffect(() => { cargar(); }, [cargar]);

    useEffect(() => {
        if (esQuincena25) { onCompletionChange?.(true, []); return; }
        const faltantes = MODULOS_OBLIGATORIOS.filter((m) => estados.find((e) => e.modulo === m)?.estado !== 'confirmado');
        onCompletionChange?.(faltantes.length === 0, faltantes);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [estados, esQuincena25]);

    const handleSinRegistros = async (estado: QuincenaModuloEstado) => {
        if (!profile?.id) return;
        // Red de seguridad (hallazgo crítico #6): si por cualquier motivo este módulo ya tiene
        // datos reales cargados, no lo dejamos confirmar como "sin registros" — el botón
        // correcto para ese caso es "Confirmar con Datos".
        if (tieneRegistros[estado.modulo]) {
            showToast(t('quincenas.modulo_error_sin_registros_con_datos'), 'error');
            return;
        }
        setConfirmandoModulo(estado.modulo);
        try {
            const actualizado = await modulosQuincenaService.marcarSinRegistros(estado.id, profile.id);
            // US-AUD-06 CA1: confirmar un módulo (aunque sea vía "sin registros") es la
            // acción CONFIRMACION_MODULO que pide auditar.
            await auditService.logAction('CONFIRMACION_MODULO', 'quincena_modulo_estado', estado.id, { modulo: estado.modulo, quincenaId, via: 'sin_registros' });
            setEstados((prev) => prev.map((e) => (e.id === actualizado.id ? actualizado : e)));
        } catch (err: unknown) {
            Logger.error('Error al marcar módulo sin registros', { moduloId: estado.id }, err);
            showToast(t('quincenas.modulo_error_accion'), 'error');
        } finally {
            setConfirmandoModulo(null);
        }
    };

    const handleConfirmarConDatos = async (estado: QuincenaModuloEstado) => {
        if (!profile?.id) return;
        setConfirmandoModulo(estado.modulo);
        try {
            const actualizado = await modulosQuincenaService.confirmarConDatos(estado.id, profile.id);
            await auditService.logAction('CONFIRMACION_MODULO', 'quincena_modulo_estado', estado.id, { modulo: estado.modulo, quincenaId, via: 'con_datos' });
            setEstados((prev) => prev.map((e) => (e.id === actualizado.id ? actualizado : e)));
        } catch (err: unknown) {
            Logger.error('Error al confirmar módulo con datos', { moduloId: estado.id }, err);
            showToast(t('quincenas.modulo_error_accion'), 'error');
        } finally {
            setConfirmandoModulo(null);
        }
    };

    if (esQuincena25) {
        return (
            <section className="flex flex-col gap-2 bg-white rounded-lg shadow-cards border border-border p-lg">
                <div className="flex items-center gap-2">
                    <ListChecks size={14} className="text-primary" />
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('quincenas.section_modulos')}</h3>
                </div>
                <p className="text-caption text-text-secondary">{t('quincenas.modulos_quincena25_note')}</p>
            </section>
        );
    }

    const confirmados = estados.filter((e) => e.estado === 'confirmado').length;

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
            <div className="flex items-center justify-between pb-1 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <ListChecks size={14} className="text-primary" />
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('quincenas.section_modulos')}</h3>
                </div>
                <span className="text-[11px] font-bold text-text-secondary">{confirmados}/{MODULOS_OBLIGATORIOS.length}</span>
            </div>

            <div className="h-2 bg-surface rounded-full overflow-hidden">
                <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{ width: `${MODULOS_OBLIGATORIOS.length > 0 ? (confirmados / MODULOS_OBLIGATORIOS.length) * 100 : 0}%` }}
                />
            </div>

            {isLoading ? (
                <div className="h-16 bg-surface rounded animate-pulse" />
            ) : (
                <ul className="flex flex-col gap-2">
                    {MODULOS_OBLIGATORIOS.map((modulo) => {
                        const estado = estados.find((e) => e.modulo === modulo);
                        const confirmado = estado?.estado === 'confirmado';
                        const tieneEscape = MODULOS_CON_ESCAPE_SIN_REGISTROS.includes(modulo);
                        // IMPL-16 CA1: "con datos" es un estado calculado, no persistido — ver
                        // comentario de la función de arriba.
                        const conDatosSinConfirmar = !confirmado && !!tieneRegistros[modulo];
                        const Icon = MODULO_ICON[modulo];

                        return (
                            <li key={modulo} className="flex items-center gap-3 text-sm border-b border-border/40 pb-2 last:border-b-0 last:pb-0">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${confirmado ? 'bg-primary-light text-primary' : conDatosSinConfirmar ? 'bg-amber-50 text-amber-600 border border-amber-200' : 'bg-white border border-border text-text-secondary'}`}>
                                    <Icon size={16} />
                                </div>
                                <span className="font-medium text-heading flex-1">{t(`quincenas.modulo_${modulo}`)}</span>
                                {confirmado ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide rounded-full bg-emerald-600 text-white">
                                        <CheckCircle2 size={12} />
                                        {estado?.via_sin_registros ? t('quincenas.modulo_sin_registros_badge') : t('quincenas.modulo_confirmado_badge')}
                                    </span>
                                ) : tieneEscape && !isReadOnly && tieneRegistros[modulo] ? (
                                    // IMPL-16 CA1 (hallazgo UAT 2026-09-17) — `outline-warning` en vez de
                                    // `ghost` para que este botón se vea igual de "con datos" (ámbar) que
                                    // el badge pasivo de los módulos sin botón (Horas Extras/Anticipos/
                                    // Descuentos). Antes quedaba con estilo neutro pese a representar el
                                    // mismo estado — inconsistente con el ícono a su izquierda, que sí ya
                                    // se pintaba ámbar.
                                    <Button
                                        variant="outline-warning"
                                        size="sm"
                                        isLoading={confirmandoModulo === modulo}
                                        onClick={() => estado && handleConfirmarConDatos(estado)}
                                        className="text-[11px]"
                                    >
                                        {t('quincenas.modulo_confirmar_con_datos')}
                                    </Button>
                                ) : tieneEscape && !isReadOnly ? (
                                    (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            isLoading={confirmandoModulo === modulo}
                                            onClick={() => estado && handleSinRegistros(estado)}
                                            className="text-[11px]"
                                        >
                                            {t('quincenas.modulo_marcar_sin_registros')}
                                        </Button>
                                    )
                                ) : conDatosSinConfirmar ? (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide rounded-full bg-amber-100 text-amber-700" title={t('quincenas.modulo_con_datos_tooltip')}>
                                        <Clock size={11} />
                                        {t('quincenas.modulo_con_datos_badge')}
                                    </span>
                                ) : (
                                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[11px] font-semibold tracking-wide rounded-full bg-surface text-text-secondary" title={t('quincenas.modulo_requiere_datos_tooltip')}>
                                        <Clock size={11} />
                                        {t('quincenas.modulo_requiere_datos_badge')}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            <p className="text-[11px] text-text-secondary italic flex items-center gap-1">
                <Circle size={10} /> {t('quincenas.modulos_disclaimer')}
            </p>
        </section>
    );
};
