import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Landmark, Plus, Pencil, X, ShieldCheck, AlertCircle, Trash2, Ban } from 'lucide-react';

import { useAuthStore } from '../../../../store/authStore';
import { useToast } from '../../../../context/ToastContext';
import { useQuincenasStore } from '../../../../store/quincenasStore';
import { useBancosStore } from '../../../../store/bancosStore';
import { useInstitucionesViviendaStore } from '../../../../store/institucionesViviendaStore';
import { descuentoCategoriasService, type DescuentoCategoria } from '../../../../services/descuentoCategoriasService';
import { descuentosService, type Descuento, type DescuentoEvento } from '../../../../services/descuentosService';
import { calcularMontoCuota, type TipoDescuento } from '../../../../utils/descuentosUtils';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { ConfirmModal } from '../../../components/ConfirmModal';
import { Logger } from '../../../../utils/logger';

interface DescuentosSectionProps {
    empleadoId: string;
    isReadOnly: boolean;
}

type SubTab = 'fijos' | 'variables' | 'historial';

function formatearFecha(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

type ModoCuota = 'numero' | 'exacta';

const FORM_VACIO = {
    categoriaId: '', institucion: '', montoQuincenal: '',
    tieneCuotas: false, montoTotal: '', numeroCuotas: '',
    // Hallazgo UAT 2026-10-15 (observación de Gilda) — 3 campos independientes entre sí:
    modoCuota: 'numero' as ModoCuota, cuotaExacta: '', // alternativa a numeroCuotas
    fechaFin: '', // opcional, aplica a cualquier descuento (finito o indefinido)
    yaPagaba: false, montoPagadoInicial: '', cuotasPagadasInicial: '', // solo al dar de alta
};

/**
 * Gestión de Descuentos en el Perfil del Empleado (US-DESC-01 / IMPL-58) — sub-tabs
 * Fijos/Variables/Historial (CA1). "Fijo" vs "Variable" es solo la clasificación heredada de
 * la categoría elegida — cualquier descuento puede independientemente tener monto total +
 * cuotas (finito) o quedar indefinido (CA2), ver comentario en la migración.
 */
export const DescuentosSection: React.FC<DescuentosSectionProps> = ({ empleadoId, isReadOnly }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const { quincenas, fetchQuincenas } = useQuincenasStore();
    const { bancos, fetchBancos } = useBancosStore();
    const { instituciones: institucionesVivienda, fetchInstituciones: fetchInstitucionesVivienda } = useInstitucionesViviendaStore();

    const [subTab, setSubTab] = useState<SubTab>('fijos');
    const [categorias, setCategorias] = useState<DescuentoCategoria[]>([]);
    const [descuentos, setDescuentos] = useState<Descuento[]>([]);
    const [eventos, setEventos] = useState<DescuentoEvento[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [mostrarFormulario, setMostrarFormulario] = useState(false);
    const [editTarget, setEditTarget] = useState<Descuento | null>(null);
    const [form, setForm] = useState(FORM_VACIO);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // IMPL-153 — eliminar (sin cuotas pagadas) o cancelar permanentemente (con historial de
    // pagos), mismo patrón ya resuelto en Anticipos (US-ANT-05/IMPL-54).
    const [eliminarObjetivo, setEliminarObjetivo] = useState<Descuento | null>(null);
    const [isEliminando, setIsEliminando] = useState(false);
    const [cancelarObjetivo, setCancelarObjetivo] = useState<Descuento | null>(null);
    const [isCancelando, setIsCancelando] = useState(false);

    const loadDatos = async () => {
        setIsLoading(true);
        try {
            // getTodos (no getActivas, desde el defecto UAT de US-DESC-01 CA3): la pantalla de
            // configuración permite desactivar categorías, y los descuentos existentes que las
            // referencian deben seguir mostrando nombre/tipo y contando en los totales. El
            // dropdown de alta nueva filtra solo activas (categoriasActivas abajo).
            const [cats, descs] = await Promise.all([
                descuentoCategoriasService.getTodos(),
                descuentosService.getPorEmpleado(empleadoId),
            ]);
            setCategorias(cats);
            setDescuentos(descs);
            setEventos(await descuentosService.getEventosPorDescuentos(descs.map((d) => d.id)));
        } catch (err: unknown) {
            Logger.error('Error al cargar descuentos', { empleadoId }, err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadDatos();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [empleadoId]);

    useEffect(() => { fetchQuincenas(); }, [fetchQuincenas]);
    useEffect(() => { fetchBancos(); }, [fetchBancos]);
    useEffect(() => { fetchInstitucionesVivienda(); }, [fetchInstitucionesVivienda]);

    const categoriaPorId = useMemo(() => new Map(categorias.map((c) => [c.id, c])), [categorias]);
    const categoriasActivas = useMemo(() => categorias.filter((c) => c.activo), [categorias]);
    const quincenaPorId = useMemo(() => new Map(quincenas.map((q) => [q.id, q])), [quincenas]);
    const descuentoPorId = useMemo(() => new Map(descuentos.map((d) => [d.id, d])), [descuentos]);
    const eventosOrdenados = useMemo(
        () => [...eventos].sort((a, b) => b.registrado_at.localeCompare(a.registrado_at)),
        [eventos]
    );

    const tipoActivo: TipoDescuento | null = subTab === 'fijos' ? 'fijo' : subTab === 'variables' ? 'variable' : null;
    // Solo las categorías ACTIVAS se ofrecen al dar de alta un descuento nuevo; las inactivas
    // siguen visibles en el display de registros existentes vía categoriaPorId (map completo).
    const categoriasDelTab = useMemo(() => categoriasActivas.filter((c) => c.tipo === tipoActivo), [categoriasActivas, tipoActivo]);
    // Al editar un descuento cuya categoría quedó desactivada después (US-DESC-01 CA4), esa
    // categoría debe seguir apareciendo en el select — si no, guardar sin tocarla la borraría.
    const categoriasParaSelect = useMemo(() => {
        if (!editTarget || categoriasDelTab.some((c) => c.id === editTarget.categoria_id)) return categoriasDelTab;
        const actual = categoriaPorId.get(editTarget.categoria_id);
        return actual ? [...categoriasDelTab, actual] : categoriasDelTab;
    }, [categoriasDelTab, editTarget, categoriaPorId]);
    const descuentosDelTab = useMemo(
        () => descuentos.filter((d) => categoriaPorId.get(d.categoria_id)?.tipo === tipoActivo),
        [descuentos, categoriaPorId, tipoActivo]
    );

    const totalFijosQuincena = useMemo(
        () => descuentos
            .filter((d) => categoriaPorId.get(d.categoria_id)?.tipo === 'fijo' && d.estado !== 'completado' && d.estado !== 'cancelado')
            .reduce((sum, d) => sum + d.monto_quincenal, 0),
        [descuentos, categoriaPorId]
    );

    const categoriaSeleccionada = categoriaPorId.get(form.categoriaId);
    // US-DESC-01 CA2 (confirmado por Imporfrut, revisión historia por historia): "Préstamo
    // bancario" nunca es indefinido — el monto total siempre se conoce, así que se fuerza
    // "tiene cuotas" y se bloquea el checkbox para esta categoría específica.
    const esPrestamoBancario = categoriaSeleccionada?.nombre === 'Préstamo bancario';
    // Hallazgo UAT 2026-10-15: un descuento de "Vivienda" puede ser con el FSV/Hábitat para la
    // Humanidad directamente, o con un banco comercial (hipoteca) — se ofrecen ambos catálogos
    // juntos solo para esta categoría; el resto sigue viendo únicamente Bancos (sin cambios).
    const opcionesInstitucion = useMemo(() => {
        if (categoriaSeleccionada?.nombre !== 'Vivienda') return bancos;
        return [...bancos, ...institucionesVivienda];
    }, [categoriaSeleccionada, bancos, institucionesVivienda]);

    const montoTotalNum = Number(form.montoTotal);
    const numeroCuotasNum = Number(form.numeroCuotas);
    const cuotaExactaNum = Number(form.cuotaExacta);
    const montoPagadoInicialNum = Number(form.montoPagadoInicial);
    const cuotasPagadasInicialNum = Number(form.cuotasPagadasInicial);

    // Hallazgo UAT 2026-10-15 (modo "cuota exacta"): número de cuotas derivado de monto_total /
    // cuota — la ÚLTIMA cuota puede salir más chica, el motor real ya lo maneja (LEAST contra el
    // saldo pendiente en procesar_cuotas_descuentos_quincena, ver migración 20261015130000).
    const numeroCuotasDerivado = form.modoCuota === 'exacta' && montoTotalNum > 0 && cuotaExactaNum > 0
        ? Math.ceil(montoTotalNum / cuotaExactaNum)
        : null;
    const totalCuotasEsperado = form.modoCuota === 'exacta' ? numeroCuotasDerivado : (numeroCuotasNum > 0 ? numeroCuotasNum : null);

    // Defecto UAT IMPL-152: si ya hay cuotas pagadas, la cuota recalculada aplica sobre el
    // saldo pendiente y las cuotas restantes (igual que actualizar_descuento), no sobre el
    // total/cuotas brutos — para que el preview coincida con lo que realmente se va a guardar.
    // Solo aplica al modo "número de cuotas" — en "cuota exacta" el monto es un dato fijo que el
    // usuario ya conoce, no se recalcula (ver RPC).
    const cuotaPreview = !form.tieneCuotas || !form.montoTotal || montoTotalNum <= 0
        ? null
        : form.modoCuota === 'exacta'
            ? (cuotaExactaNum > 0 ? cuotaExactaNum : null)
            : (form.numeroCuotas && numeroCuotasNum > 0
                ? (editTarget && editTarget.cuotas_pagadas > 0
                    ? calcularMontoCuota(montoTotalNum - editTarget.monto_pagado, Math.max(numeroCuotasNum - editTarget.cuotas_pagadas, 1))
                    : calcularMontoCuota(montoTotalNum, numeroCuotasNum))
                : null);

    const resetForm = () => {
        setForm(FORM_VACIO);
        setError(null);
    };

    const cerrarFormulario = () => {
        resetForm();
        setEditTarget(null);
        setMostrarFormulario(false);
    };

    const abrirAlta = () => {
        setEditTarget(null);
        setForm(FORM_VACIO);
        setError(null);
        setMostrarFormulario(true);
    };

    // US-DESC-01 CA4 (bug real de UAT) — no existía ninguna forma de corregir un descuento ya
    // creado, solo darlo de alta o pausarlo. Reusa el mismo formulario de alta, precargado.
    const abrirEdicion = (d: Descuento) => {
        setEditTarget(d);
        setForm({
            categoriaId: d.categoria_id,
            institucion: d.institucion ?? '',
            montoQuincenal: d.numero_cuotas === null ? String(d.monto_quincenal) : '',
            tieneCuotas: d.numero_cuotas !== null,
            montoTotal: d.monto_total !== null ? String(d.monto_total) : '',
            numeroCuotas: d.numero_cuotas !== null ? String(d.numero_cuotas) : '',
            // Precarga en modo "cuota exacta" con la cuota YA vigente — así un guardado sin
            // cambios no recalcula silenciosamente el monto (ver migración 20261015130000). Si
            // el usuario quiere volver al modo "número de cuotas" para forzar un recálculo, puede
            // cambiarlo a mano.
            modoCuota: 'exacta',
            cuotaExacta: d.numero_cuotas !== null ? String(d.monto_quincenal) : '',
            fechaFin: d.fecha_fin ?? '',
            yaPagaba: false, montoPagadoInicial: '', cuotasPagadasInicial: '',
        });
        setError(null);
        setMostrarFormulario(true);
    };

    /** Postgres código 23514 = check_violation — acá salta cuando se intenta bajar el monto
     * total por debajo de lo ya pagado (CHECK de planilla_descuentos), la única forma en que
     * la edición puede fallar por datos inconsistentes en vez de un error genérico. */
    const esErrorMontoMenorAPagado = (err: unknown): boolean => (err as { code?: string } | null)?.code === '23514';

    /** Bugfix (hallazgo UAT, tope 20% — 2026-11-03): `crear_descuento`/`actualizar_descuento`
     * SÍ rechazan una cuota que supera el 20% legal con un RAISE EXCEPTION claro (migración
     * 20261027090000), pero la UI mostraba siempre el mensaje genérico "No se pudo guardar el
     * descuento." — el texto real quedaba solo en la consola. Ese mensaje ya está escrito para
     * que lo lea el usuario (no es un detalle interno de Postgres), así que se muestra tal cual. */
    const esErrorTope20Prestamo = (err: unknown): string | null => {
        const mensaje = (err as { message?: string } | null)?.message;
        return mensaje?.includes('supera el 20') ? mensaje : null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.id) return;

        const cuotasOk = form.modoCuota === 'exacta' ? cuotaExactaNum > 0 : (!!form.numeroCuotas && numeroCuotasNum > 0);
        if (
            !form.categoriaId
            || (!form.tieneCuotas && (!form.montoQuincenal || Number(form.montoQuincenal) <= 0))
            || (form.tieneCuotas && (!form.montoTotal || montoTotalNum <= 0 || !cuotasOk))
        ) {
            setError(t('empleados.descuentos_error_campos_requeridos'));
            return;
        }
        if (esPrestamoBancario && !form.tieneCuotas) {
            setError(t('empleados.descuentos_error_prestamo_bancario_requiere_cuotas'));
            return;
        }
        // Saldo inicial (hallazgo UAT 2026-10-15) — solo al dar de alta, solo tiene sentido con
        // monto_total definido (validado arriba por cuotasOk/tieneCuotas).
        if (!editTarget && form.tieneCuotas && form.yaPagaba) {
            if (!form.montoPagadoInicial || montoPagadoInicialNum < 0 || montoPagadoInicialNum > montoTotalNum) {
                setError(t('empleados.descuentos_error_monto_pagado_inicial_invalido'));
                return;
            }
            if (!form.cuotasPagadasInicial || cuotasPagadasInicialNum < 0
                || (totalCuotasEsperado !== null && cuotasPagadasInicialNum >= totalCuotasEsperado)) {
                setError(t('empleados.descuentos_error_cuotas_pagadas_inicial_invalido'));
                return;
            }
        }

        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                const actualizado = await descuentosService.actualizar(editTarget.id, {
                    categoriaId: form.categoriaId,
                    institucion: form.institucion.trim() || null,
                    montoQuincenal: form.tieneCuotas ? 0 : Number(form.montoQuincenal),
                    montoTotal: form.tieneCuotas ? montoTotalNum : null,
                    numeroCuotas: form.tieneCuotas && form.modoCuota === 'numero' ? numeroCuotasNum : null,
                    cuotaExacta: form.tieneCuotas && form.modoCuota === 'exacta' ? cuotaExactaNum : null,
                    fechaFin: form.fechaFin || null,
                });
                setDescuentos((prev) => prev.map((x) => (x.id === actualizado.id ? actualizado : x)));
                showToast(t('empleados.descuentos_toast_actualizado'), 'success');
            } else {
                const creado = await descuentosService.crear({
                    empleadoId,
                    categoriaId: form.categoriaId,
                    institucion: form.institucion.trim() || null,
                    montoQuincenal: form.tieneCuotas ? 0 : Number(form.montoQuincenal),
                    montoTotal: form.tieneCuotas ? montoTotalNum : null,
                    numeroCuotas: form.tieneCuotas && form.modoCuota === 'numero' ? numeroCuotasNum : null,
                    cuotaExacta: form.tieneCuotas && form.modoCuota === 'exacta' ? cuotaExactaNum : null,
                    fechaFin: form.fechaFin || null,
                    montoPagadoInicial: form.tieneCuotas && form.yaPagaba ? montoPagadoInicialNum : 0,
                    cuotasPagadasInicial: form.tieneCuotas && form.yaPagaba ? cuotasPagadasInicialNum : 0,
                    userId: profile.id,
                });
                setDescuentos((prev) => [creado, ...prev]);
                showToast(t('empleados.descuentos_toast_guardado'), 'success');
            }
            cerrarFormulario();
        } catch (err: unknown) {
            Logger.error('Error al guardar descuento', { empleadoId, editandoId: editTarget?.id }, err);
            const mensajeTope20 = esErrorTope20Prestamo(err);
            if (editTarget && esErrorMontoMenorAPagado(err)) {
                setError(t('empleados.descuentos_error_monto_menor_a_pagado'));
            } else if (mensajeTope20) {
                setError(mensajeTope20);
            } else {
                setError(t(editTarget ? 'empleados.descuentos_error_actualizar' : 'empleados.descuentos_error_guardar'));
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleTogglePausado = async (d: Descuento) => {
        try {
            const actualizado = await descuentosService.cambiarEstadoPausado(d.id, d.estado !== 'pausado');
            setDescuentos((prev) => prev.map((x) => (x.id === d.id ? actualizado : x)));
        } catch (err: unknown) {
            Logger.error('Error al cambiar estado del descuento', { id: d.id }, err);
            showToast(t('empleados.descuentos_error_pausar'), 'error');
        }
    };

    /** IMPL-153 CA1: la policy de DELETE (`monto_pagado = 0`) es la autoridad final — el botón
     * ya solo se renderiza si `d.monto_pagado === 0` (ver JSX). */
    const handleConfirmarEliminar = async () => {
        if (!eliminarObjetivo) return;
        setIsEliminando(true);
        try {
            await descuentosService.eliminar(eliminarObjetivo.id);
            setDescuentos((prev) => prev.filter((x) => x.id !== eliminarObjetivo.id));
            showToast(t('empleados.descuentos_toast_eliminado'), 'success');
            setEliminarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al eliminar descuento', { id: eliminarObjetivo.id }, err);
            showToast(t('empleados.descuentos_error_eliminar'), 'error');
        } finally {
            setIsEliminando(false);
        }
    };

    /** IMPL-153 CA2: cancelación permanente para descuentos con al menos una cuota ya cobrada
     * — no genera más cuotas futuras, pero conserva el historial de lo ya pagado. */
    const handleConfirmarCancelar = async () => {
        if (!cancelarObjetivo) return;
        setIsCancelando(true);
        try {
            const actualizado = await descuentosService.cancelar(cancelarObjetivo.id);
            setDescuentos((prev) => prev.map((x) => (x.id === actualizado.id ? actualizado : x)));
            showToast(t('empleados.descuentos_toast_cancelado'), 'success');
            setCancelarObjetivo(null);
        } catch (err: unknown) {
            Logger.error('Error al cancelar descuento', { id: cancelarObjetivo.id }, err);
            showToast(t('empleados.descuentos_error_cancelar'), 'error');
        } finally {
            setIsCancelando(false);
        }
    };

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
            <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                <Landmark size={14} className="text-primary" />
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_descuentos')}</h3>
            </div>

            <div className="flex gap-1 bg-surface rounded-xl p-1 w-fit">
                {(['fijos', 'variables', 'historial'] as SubTab[]).map((tab) => (
                    <button
                        key={tab}
                        type="button"
                        onClick={() => { setSubTab(tab); setMostrarFormulario(false); }}
                        className={`px-3 py-1.5 rounded-lg text-[13px] font-semibold transition-colors ${
                            subTab === tab ? 'bg-white text-primary shadow-cards' : 'text-text-secondary hover:text-heading'
                        }`}
                    >
                        {t(`empleados.descuentos_subtab_${tab}`)}
                    </button>
                ))}
            </div>

            {isLoading ? (
                <div className="h-16 bg-surface rounded-lg animate-pulse" />
            ) : subTab === 'historial' ? (
                eventosOrdenados.length === 0 ? (
                    <p className="text-caption text-text-secondary italic">{t('empleados.descuentos_historial_empty')}</p>
                ) : (
                    <ul className="flex flex-col gap-2">
                        {eventosOrdenados.map((ev) => {
                            const descuento = descuentoPorId.get(ev.descuento_id);
                            const categoria = descuento ? categoriaPorId.get(descuento.categoria_id) : undefined;
                            const quincena = quincenaPorId.get(ev.quincena_id);
                            return (
                                <li key={ev.id} className="flex items-center justify-between gap-3 text-sm border-b border-border/40 pb-2 last:border-b-0 last:pb-0">
                                    <div className="flex flex-col">
                                        <span className="font-semibold text-heading">{categoria?.nombre ?? '—'}{descuento?.institucion ? ` — ${descuento.institucion}` : ''}</span>
                                        <span className="text-caption text-text-secondary">
                                            {quincena?.etiqueta_estandar ?? ev.quincena_id}
                                            {ev.tipo === 'suspension' && ev.motivo_suspension ? ` · ${ev.motivo_suspension}` : ''}
                                        </span>
                                    </div>
                                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide shrink-0 ${ev.tipo === 'pago' ? 'bg-primary-light text-primary' : 'bg-amber-50 text-amber-700'}`}>
                                        {ev.tipo === 'pago' ? `$${(ev.monto ?? 0).toFixed(2)}` : t('empleados.descuentos_historial_suspendido')}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )
            ) : (
                <>
                    {!isReadOnly && !mostrarFormulario && (
                        <button
                            type="button"
                            onClick={abrirAlta}
                            className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline self-start"
                        >
                            <Plus size={12} /> {t('empleados.descuentos_action_agregar')}
                        </button>
                    )}

                    {mostrarFormulario && (
                        <div className="flex flex-col gap-3 bg-surface/50 rounded-lg p-md border border-border">
                            <div className="flex items-center justify-between">
                                <p className="text-caption font-semibold text-heading">
                                    {editTarget ? t('empleados.descuentos_form_title_editar') : t('empleados.descuentos_form_title')}
                                </p>
                                <button type="button" onClick={cerrarFormulario} className="text-text-secondary hover:text-heading">
                                    <X size={14} />
                                </button>
                            </div>
                            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div className="flex flex-col gap-1">
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.descuentos_field_categoria')} <span className="text-error">*</span></label>
                                        <select
                                            value={form.categoriaId}
                                            onChange={(e) => {
                                                const nuevaCategoriaId = e.target.value;
                                                const esNuevaPrestamoBancario = categoriaPorId.get(nuevaCategoriaId)?.nombre === 'Préstamo bancario';
                                                setForm((prev) => ({
                                                    ...prev,
                                                    categoriaId: nuevaCategoriaId,
                                                    tieneCuotas: esNuevaPrestamoBancario ? true : prev.tieneCuotas,
                                                }));
                                            }}
                                            className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                                        >
                                            <option value="">{t('empleados.descuentos_field_categoria_placeholder')}</option>
                                            {categoriasParaSelect.map((c) => (
                                                <option key={c.id} value={c.id}>{c.nombre}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        {/* IMPL-172 (hallazgo UAT) — antes era texto libre; texto libre generaba
                                            variantes inconsistentes del mismo banco ("Cuscatlán"/"cuscatlan"/
                                            "Banco Cuscatlán S.A.") que rompían el agrupado por institución del
                                            reporte de Descuentos (IMPL-167). Ahora reusa el mismo catálogo de
                                            Bancos que ya usa el perfil del empleado (EmpleadoDetailView.tsx),
                                            sin duplicar el catálogo. Para la categoría "Vivienda" (hallazgo UAT
                                            2026-10-15) se suma el catálogo de Instituciones de Vivienda (FSV,
                                            Hábitat para la Humanidad) vía `opcionesInstitucion` — un préstamo de
                                            vivienda también puede ser con un banco comercial. Si el registro ya
                                            tenía un valor de texto libre que no matchea ningún catálogo, se
                                            preserva como opción extra — no se pierde el dato histórico al editar. */}
                                        <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.descuentos_field_institucion')}</label>
                                        <select
                                            value={form.institucion}
                                            onChange={(e) => setForm((prev) => ({ ...prev, institucion: e.target.value }))}
                                            className="rounded-md border border-border bg-white px-3 py-2 text-sm"
                                        >
                                            <option value="">{t('empleados.descuentos_field_institucion_placeholder')}</option>
                                            {opcionesInstitucion
                                                .filter((b) => b.estado === 'activo' || b.nombre === form.institucion)
                                                .map((b) => (
                                                    <option key={b.id} value={b.nombre}>
                                                        {b.nombre}{b.estado === 'inactivo' ? ` (${t('horasExtras.estado_inactivo')})` : ''}
                                                    </option>
                                                ))}
                                            {form.institucion && !opcionesInstitucion.some((b) => b.nombre === form.institucion) && (
                                                <option value={form.institucion}>{form.institucion}</option>
                                            )}
                                        </select>
                                    </div>
                                </div>

                                <label className="flex items-center gap-2 text-caption text-heading">
                                    <input
                                        type="checkbox"
                                        checked={form.tieneCuotas}
                                        disabled={esPrestamoBancario}
                                        onChange={(e) => setForm((prev) => ({ ...prev, tieneCuotas: e.target.checked }))}
                                    />
                                    {t('empleados.descuentos_field_tiene_cuotas')}
                                </label>
                                {esPrestamoBancario && (
                                    <p className="text-caption text-text-secondary -mt-2">
                                        {t('empleados.descuentos_error_prestamo_bancario_requiere_cuotas')}
                                    </p>
                                )}

                                {form.tieneCuotas ? (
                                    <>
                                        {/* Hallazgo UAT 2026-10-15: alternativa a "número de cuotas" — el usuario ya
                                            conoce la cuota exacta (ej. viene de un contrato de préstamo) y el sistema
                                            deriva cuántas cuotas hacen falta, en vez de al revés. */}
                                        <div className="flex gap-xs bg-surface rounded-lg p-1 w-fit">
                                            {(['numero', 'exacta'] as ModoCuota[]).map((modo) => (
                                                <button
                                                    key={modo}
                                                    type="button"
                                                    onClick={() => setForm((prev) => ({ ...prev, modoCuota: modo }))}
                                                    className={`px-3 py-1.5 rounded-md text-[12px] font-semibold transition-colors
                                                        ${form.modoCuota === modo ? 'bg-white text-primary shadow-cards' : 'text-text-secondary hover:text-heading'}`}
                                                >
                                                    {t(`empleados.descuentos_modo_cuota_${modo}`)}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            <InputField
                                                label={t('empleados.descuentos_field_monto_total')}
                                                type="number"
                                                min={0}
                                                step="0.01"
                                                value={form.montoTotal}
                                                onChange={(e) => setForm((prev) => ({ ...prev, montoTotal: e.target.value }))}
                                                required
                                            />
                                            {form.modoCuota === 'exacta' ? (
                                                <InputField
                                                    label={t('empleados.descuentos_field_cuota_exacta')}
                                                    type="number"
                                                    min={0}
                                                    step="0.01"
                                                    value={form.cuotaExacta}
                                                    onChange={(e) => setForm((prev) => ({ ...prev, cuotaExacta: e.target.value }))}
                                                    required
                                                />
                                            ) : (
                                                <InputField
                                                    label={t('empleados.descuentos_field_numero_cuotas')}
                                                    type="number"
                                                    min={1}
                                                    value={form.numeroCuotas}
                                                    onChange={(e) => setForm((prev) => ({ ...prev, numeroCuotas: e.target.value }))}
                                                    required
                                                />
                                            )}
                                        </div>
                                        {numeroCuotasDerivado !== null && (
                                            <p className="text-caption text-text-secondary">
                                                {t('empleados.descuentos_cuotas_derivadas_preview', { cuotas: numeroCuotasDerivado })}
                                            </p>
                                        )}

                                        {!editTarget && (
                                            <div className="flex flex-col gap-2 bg-surface/60 rounded-lg p-sm border border-border/60">
                                                <label className="flex items-center gap-2 text-caption text-heading">
                                                    <input
                                                        type="checkbox"
                                                        checked={form.yaPagaba}
                                                        onChange={(e) => setForm((prev) => ({ ...prev, yaPagaba: e.target.checked }))}
                                                    />
                                                    {t('empleados.descuentos_field_ya_pagaba')}
                                                </label>
                                                {form.yaPagaba && (
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <InputField
                                                            label={t('empleados.descuentos_field_monto_pagado_inicial')}
                                                            type="number"
                                                            min={0}
                                                            step="0.01"
                                                            value={form.montoPagadoInicial}
                                                            onChange={(e) => setForm((prev) => ({ ...prev, montoPagadoInicial: e.target.value }))}
                                                            required
                                                        />
                                                        <InputField
                                                            label={t('empleados.descuentos_field_cuotas_pagadas_inicial')}
                                                            type="number"
                                                            min={0}
                                                            value={form.cuotasPagadasInicial}
                                                            onChange={(e) => setForm((prev) => ({ ...prev, cuotasPagadasInicial: e.target.value }))}
                                                            required
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <InputField
                                        label={t('empleados.descuentos_field_monto_quincenal')}
                                        type="number"
                                        min={0}
                                        step="0.01"
                                        value={form.montoQuincenal}
                                        onChange={(e) => setForm((prev) => ({ ...prev, montoQuincenal: e.target.value }))}
                                        className="max-w-[20rem]"
                                        required
                                    />
                                )}

                                {cuotaPreview !== null && (
                                    <p className="text-caption text-text-secondary">
                                        {t('empleados.descuentos_cuota_preview', { monto: cuotaPreview.toFixed(2) })}
                                    </p>
                                )}

                                {/* Hallazgo UAT 2026-10-15: aplica a cualquier descuento, finito o indefinido —
                                    al llegar esta fecha se completa automáticamente (ver migración 20261015130000). */}
                                <InputField
                                    label={t('empleados.descuentos_field_fecha_fin')}
                                    type="date" mask="date"
                                    value={form.fechaFin}
                                    onChange={(e) => setForm((prev) => ({ ...prev, fechaFin: e.target.value }))}
                                    className="max-w-80"
                                />

                                <Button type="submit" size="sm" isLoading={isSubmitting} className="self-start">
                                    {editTarget ? t('empleados.descuentos_action_actualizar') : t('empleados.descuentos_action_guardar')}
                                </Button>
                                {error && <p className="text-caption text-error">{error}</p>}
                            </form>
                        </div>
                    )}

                    {descuentosDelTab.length === 0 ? (
                        <p className="text-caption text-text-secondary italic">{t('empleados.descuentos_empty')}</p>
                    ) : (
                        <div className="flex flex-col gap-2">
                            {descuentosDelTab.map((d) => {
                                const categoria = categoriaPorId.get(d.categoria_id);
                                const pendiente = d.monto_total !== null ? d.monto_total - d.monto_pagado : null;
                                const Icon = tipoActivo === 'variable' ? AlertCircle : ShieldCheck;
                                return (
                                    <div key={d.id} className={`bg-white rounded-xl border border-border shadow-cards p-3 flex items-center gap-3 ${d.estado === 'pausado' ? 'opacity-60' : ''}`}>
                                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tipoActivo === 'variable' ? 'bg-amber-50' : d.estado === 'pausado' ? 'bg-surface' : 'bg-primary-light'}`}>
                                            <Icon size={16} className={tipoActivo === 'variable' ? 'text-amber-500' : d.estado === 'pausado' ? 'text-text-secondary' : 'text-primary'} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-semibold text-heading truncate">{categoria?.nombre ?? '—'}{d.institucion ? ` — ${d.institucion}` : ''}</p>
                                            <p className="text-[11px] text-text-secondary">
                                                ${d.monto_quincenal.toFixed(2)} / {t('empleados.descuentos_quincena')}
                                                {d.numero_cuotas !== null && ` · ${t('empleados.descuentos_cuota_x_de_y', { actual: d.cuotas_pagadas + 1, total: d.numero_cuotas })}`}
                                                {pendiente !== null && ` · ${t('empleados.descuentos_pendiente', { monto: pendiente.toFixed(2) })}`}
                                                {d.fecha_fin && ` · ${t('empleados.descuentos_fecha_fin_hasta', { fecha: formatearFecha(d.fecha_fin) })}`}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {!isReadOnly && (
                                                <button
                                                    type="button"
                                                    onClick={() => abrirEdicion(d)}
                                                    title={t('empleados.descuentos_action_editar')}
                                                    className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                            )}
                                            {!isReadOnly && d.estado !== 'completado' && d.estado !== 'cancelado' && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleTogglePausado(d)}
                                                    className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide ${
                                                        d.estado === 'pausado' ? 'bg-surface text-text-secondary' : 'bg-primary-light text-primary'
                                                    }`}
                                                >
                                                    {t(`empleados.descuentos_estado_${d.estado}`)}
                                                </button>
                                            )}
                                            {d.estado === 'completado' && (
                                                <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-primary-light text-primary">
                                                    {t('empleados.descuentos_estado_completado')}
                                                </span>
                                            )}
                                            {d.estado === 'cancelado' && (
                                                <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide bg-error/10 text-error">
                                                    {t('empleados.descuentos_estado_cancelado')}
                                                </span>
                                            )}
                                            {/* IMPL-153 — mismo criterio que Anticipos (US-ANT-05): eliminar solo sin cuotas
                                                pagadas; con historial de pagos, la única acción permanente es cancelar. */}
                                            {!isReadOnly && d.estado !== 'completado' && d.estado !== 'cancelado' && d.monto_pagado === 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setEliminarObjetivo(d)}
                                                    title={t('empleados.descuentos_action_eliminar')}
                                                    className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/10"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                            {!isReadOnly && d.estado !== 'completado' && d.estado !== 'cancelado' && d.monto_pagado > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setCancelarObjetivo(d)}
                                                    title={t('empleados.descuentos_action_cancelar_permanente')}
                                                    className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/10"
                                                >
                                                    <Ban size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {subTab === 'fijos' && (
                        <p className="text-caption text-text-secondary pt-2 border-t border-border/40">
                            {t('empleados.descuentos_total_fijos_quincena', { monto: totalFijosQuincena.toFixed(2) })}
                        </p>
                    )}
                </>
            )}

            <ConfirmModal
                isOpen={eliminarObjetivo !== null}
                onClose={() => setEliminarObjetivo(null)}
                onConfirm={handleConfirmarEliminar}
                title={t('empleados.descuentos_eliminar_confirm_title')}
                message={eliminarObjetivo ? t('empleados.descuentos_eliminar_confirm_message', { codigo: eliminarObjetivo.codigo }) : ''}
                confirmLabel={t('empleados.descuentos_eliminar_confirm_action')}
                variant="danger"
                Icon={Trash2}
                isLoading={isEliminando}
            />

            <ConfirmModal
                isOpen={cancelarObjetivo !== null}
                onClose={() => setCancelarObjetivo(null)}
                onConfirm={handleConfirmarCancelar}
                title={t('empleados.descuentos_cancelar_confirm_title')}
                message={cancelarObjetivo ? t('empleados.descuentos_cancelar_confirm_message', { codigo: cancelarObjetivo.codigo }) : ''}
                confirmLabel={t('empleados.descuentos_cancelar_confirm_action')}
                variant="danger"
                Icon={Ban}
                isLoading={isCancelando}
            />
        </section>
    );
};
