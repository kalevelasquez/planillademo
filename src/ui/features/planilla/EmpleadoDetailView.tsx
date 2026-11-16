import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, User, Phone, Briefcase, DollarSign, Landmark, AlertTriangle, AlertCircle, MoreVertical, UserCheck, UserX, FileCheck, Trash2 } from 'lucide-react';
import { Avatar } from '../../components/Avatar';

import { useEmpleadoManagement, type EmpleadoFormData } from './hooks/useEmpleadoManagement';
import { usePermission } from '../../../hooks/usePermission';
import { useAuthStore } from '../../../store/authStore';
import { useUbicacionesStore } from '../../../store/ubicacionesStore';
import { useDepartamentosStore } from '../../../store/departamentosStore';
import { useCargosStore } from '../../../store/cargosStore';
import { cargosService } from '../../../services/cargosService';
import { departamentosService, type ColorKey } from '../../../services/departamentosService';
import { useBancosStore } from '../../../store/bancosStore';
import { useTiposContratoStore } from '../../../store/tiposContratoStore';
import { useQuincenasStore } from '../../../store/quincenasStore';
import { anticiposService, type Anticipo } from '../../../services/anticiposService';
import { descuentosService, type Descuento } from '../../../services/descuentosService';
import { horasExtrasManualService, type HorasExtrasManualRow } from '../../../services/horasExtrasManualService';
import { planillaEmpleadosService } from '../../../services/planillaEmpleadosService';
import { encontrarQuincenaActiva } from '../../../utils/quincenaUtils';
import { fmtSueldo } from '../../../utils/sueldoUtils';
import { ROLES } from '../../../config/constants';
import { InputField } from '../../components/InputField';
import { Button } from '../../components/Button';
import { Banner } from '../../components/Banner';
import { SensitiveField } from '../../components/SensitiveField';
import { ReadOnlyField } from '../../components/ReadOnlyField';
import { ConfirmModal } from '../../components/ConfirmModal';
import { IndemnizacionesSection } from './components/IndemnizacionesSection';
import { DescuentosSection } from './components/DescuentosSection';
import { DocumentosSection } from './components/DocumentosSection';
import { VacacionesResumenSection } from './components/VacacionesResumenSection';
import { HistorialCambiosSection } from './components/HistorialCambiosSection';
import { CatalogSelectQuickAdd } from './components/CatalogSelectQuickAdd';
import { useToast } from '../../../context/ToastContext';
import { Logger } from '../../../utils/logger';

type TabEmpleado = 'personal' | 'cargo' | 'descuentos' | 'documentos' | 'historial';

// IMPL-124 — a qué tab pertenece cada campo obligatorio (los únicos que pueden aparecer en
// `fieldErrors`), para saltar automáticamente al tab correcto y marcarlo con un indicador.
const TAB_POR_CAMPO: Partial<Record<keyof EmpleadoFormData, TabEmpleado>> = {
    codigoEmpleadoManual: 'personal', nombreCompleto: 'personal', dui: 'personal', pasaporte: 'personal', fechaNacimiento: 'personal',
    ubicacionId: 'cargo', fechaIngreso: 'cargo', sueldoMensual: 'cargo',
};

export const EmpleadoDetailView: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { id } = useParams<{ id: string }>();
    const isCreating = !id || id === 'nuevo';
    const permission = usePermission('planilla_empleados');
    // Aprobador de Planilla puede ver el perfil (Blueprint §13.2) pero no editarlo — mientras
    // el permiso no cargó (null) asumimos solo-lectura por seguridad, no al revés.
    const isReadOnly = !isCreating && permission?.can_edit !== true;

    // Pestañas (US-EMP-01/02, fidelidad al prototipo del PM) — declarado antes del hook para
    // poder pasarle el callback de salto automático al primer tab con error (IMPL-124).
    const [activeTab, setActiveTab] = useState<TabEmpleado>('personal');
    const [colorDepartamentoNuevo, setColorDepartamentoNuevo] = useState<ColorKey>('blue');

    const {
        formData, isEditing, isLoading, isSubmitting, error, fieldErrors, fechaIngresoChanged,
        estadoActivoAInactivo, updateField, loadEmpleado, handleSubmit,
    } = useEmpleadoManagement(
        () => navigate('/planilla/empleados'),
        (camposFaltantes) => {
            const primerTab = camposFaltantes.map((campo) => TAB_POR_CAMPO[campo]).find(Boolean);
            if (primerTab && primerTab !== activeTab) setActiveTab(primerTab);
        },
    );
    const { ubicaciones, fetchUbicaciones } = useUbicacionesStore();
    const { departamentos, fetchDepartamentos, upsertDepartamento } = useDepartamentosStore();
    const { cargos, fetchCargos, upsertCargo } = useCargosStore();
    const { bancos, fetchBancos } = useBancosStore();
    const { tiposContrato, fetchTiposContrato } = useTiposContratoStore();
    const { quincenas, fetchQuincenas } = useQuincenasStore();
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const roles = Array.isArray(profile?.roles) ? profile.roles : profile?.role ? [profile.role] : [];
    const esAdmin = roles.includes(ROLES.ADMIN);

    // Menú "⋮" (US-UX-02, fidelidad al prototipo) — Activar/Inactivar persiste de inmediato
    // (con confirmación), a diferencia del switch de estado dentro del formulario (que solo
    // aplica al guardar todo el perfil). Eliminar (soft-delete, RPC eliminar_empleado) queda
    // restringido a admin en el propio RPC — se oculta acá también para no invitar a un click
    // que el backend va a rechazar.
    const [menuOpen, setMenuOpen] = useState(false);
    const [confirmAccion, setConfirmAccion] = useState<'activar' | 'inactivar' | 'liquidar' | 'eliminar' | null>(null);
    const [isProcesandoAccion, setIsProcesandoAccion] = useState(false);

    const ESTADO_POR_ACCION = { activar: 'activo', inactivar: 'inactivo', liquidar: 'liquidado' } as const;

    const handleConfirmarCambioEstado = async () => {
        if (!formData.id || !confirmAccion || confirmAccion === 'eliminar') return;
        setIsProcesandoAccion(true);
        try {
            await planillaEmpleadosService.updateEmpleado(formData.id, { estado: ESTADO_POR_ACCION[confirmAccion] });
            await loadEmpleado(formData.id);
            showToast(t('empleados.toast_estado_actualizado'), 'success');
            setConfirmAccion(null);
        } catch (err: unknown) {
            Logger.error('Error al cambiar el estado del empleado', { empleadoId: formData.id, accion: confirmAccion }, err);
            showToast(err instanceof Error ? err.message : t('empleados.error_cambiar_estado'), 'error');
        } finally {
            setIsProcesandoAccion(false);
        }
    };

    const handleConfirmarEliminar = async () => {
        if (!formData.id) return;
        setIsProcesandoAccion(true);
        try {
            await planillaEmpleadosService.eliminarEmpleado(formData.id);
            showToast(t('empleados.toast_eliminado'), 'success');
            setConfirmAccion(null);
            navigate('/planilla/empleados');
        } catch (err: unknown) {
            Logger.error('Error al eliminar el empleado', { empleadoId: formData.id }, err);
            showToast(err instanceof Error ? err.message : t('empleados.error_eliminar'), 'error');
        } finally {
            setIsProcesandoAccion(false);
        }
    };

    // Pestañas (US-EMP-01/02, fidelidad al prototipo del PM) — Descuentos/Documentos/Historial
    // dependen de un empleado ya guardado (relacionados por FK a empleadoId), así que solo
    // aparecen una vez que existe `formData.id`, mismo criterio que ya usaba el renderizado
    // condicional de esas secciones antes de esta reorganización.
    const puedeVerTabsRelacionadas = isEditing && Boolean(formData.id);
    const TABS: { key: TabEmpleado; label: string }[] = [
        { key: 'personal', label: t('empleados.tab_datos_personales') },
        { key: 'cargo', label: t('empleados.tab_cargo_remuneracion') },
        ...(puedeVerTabsRelacionadas
            ? ([
                { key: 'descuentos', label: t('empleados.tab_descuentos') },
                { key: 'documentos', label: t('empleados.tab_documentos') },
                { key: 'historial', label: t('empleados.tab_historial') },
            ] as const)
            : []),
    ];

    const quincenaActiva = useMemo(() => encontrarQuincenaActiva(quincenas), [quincenas]);

    // US-ANT-07/US-DESC-06 (IMPL-83/IMPL-84) CA1/CA3, extendido a Horas Extras (IMPL-23 CA5/
    // IMPL-25) — alerta informativa (no bloquea el guardado, mismo criterio que
    // fechaIngresoChanged) de anticipos, descuentos Y horas extra ya confirmadas de la
    // quincena activa al pasar el empleado a inactivo. Sin esta alerta, esas horas quedaban
    // confirmadas pero invisibles para el motor de cálculo (calcular_planilla_quincena solo
    // recorre empleados activos) — un solo Banner combinando las 3 listas, no tres banners.
    const [anticiposActivos, setAnticiposActivos] = useState<Anticipo[]>([]);
    const [descuentosActivos, setDescuentosActivos] = useState<Descuento[]>([]);
    const [horasExtrasPendientes, setHorasExtrasPendientes] = useState<HorasExtrasManualRow[]>([]);

    // IMPL-83 — el switch de estado dentro del formulario no es la única forma de inactivar:
    // el menú "⋮" > Inactivar (confirmAccion === 'inactivar') también debe disparar esta misma
    // verificación, o el usuario que usa esa vía nunca ve la alerta de compromisos activos.
    useEffect(() => {
        const necesitaVerificar = estadoActivoAInactivo || confirmAccion === 'inactivar' || confirmAccion === 'liquidar';
        if (!necesitaVerificar || !formData.id) {
            setAnticiposActivos([]); setDescuentosActivos([]); setHorasExtrasPendientes([]);
            return;
        }
        anticiposService.getActivosPorEmpleado(formData.id)
            .then(setAnticiposActivos)
            .catch((err: unknown) => Logger.error('Error al verificar anticipos activos del empleado', { empleadoId: formData.id }, err));
        descuentosService.getActivosPorEmpleado(formData.id)
            .then(setDescuentosActivos)
            .catch((err: unknown) => Logger.error('Error al verificar descuentos activos del empleado', { empleadoId: formData.id }, err));
        if (quincenaActiva) {
            horasExtrasManualService.getPorEmpleadoYQuincena(formData.id, quincenaActiva.id)
                .then(setHorasExtrasPendientes)
                .catch((err: unknown) => Logger.error('Error al verificar horas extra pendientes del empleado', { empleadoId: formData.id }, err));
        } else {
            setHorasExtrasPendientes([]);
        }
    }, [estadoActivoAInactivo, confirmAccion, formData.id, quincenaActiva]);

    const tieneCompromisosActivos = anticiposActivos.length > 0 || descuentosActivos.length > 0 || horasExtrasPendientes.length > 0;
    const compromisosDescripcion = [
        ...anticiposActivos.map((a) => t('empleados.warning_item_anticipo', { vale: a.numero_vale, monto: (a.monto_total - a.monto_pagado).toFixed(2) })),
        ...descuentosActivos.map((d) => d.monto_total !== null
            ? t('empleados.warning_item_descuento', { codigo: d.codigo, monto: (d.monto_total - d.monto_pagado).toFixed(2) })
            : t('empleados.warning_item_descuento_indefinido', { codigo: d.codigo })),
        ...(horasExtrasPendientes.length > 0
            ? [t('empleados.warning_item_horas_extra', { monto: horasExtrasPendientes.reduce((sum, h) => sum + h.monto_total, 0).toFixed(2) })]
            : []),
    ].join(' · ') + ' — ' + t('empleados.warning_compromisos_activos_disclaimer');

    useEffect(() => {
        if (!isCreating && id) loadEmpleado(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => { fetchUbicaciones(); }, [fetchUbicaciones]);
    useEffect(() => { fetchDepartamentos(); }, [fetchDepartamentos]);
    useEffect(() => { fetchCargos(); }, [fetchCargos]);
    useEffect(() => { fetchBancos(); }, [fetchBancos]);
    useEffect(() => { fetchTiposContrato(); }, [fetchTiposContrato]);
    useEffect(() => { fetchQuincenas(); }, [fetchQuincenas]);

    const fieldClass = (field: keyof typeof fieldErrors) => fieldErrors[field] ? 'ring-2 ring-error/40 rounded-lg' : '';
    // IMPL-124 — mensaje de error con texto (no solo el halo) usando el prop `error` que
    // InputField/SensitiveField ya soportan, y un indicador en el tab que contiene el error.
    const fieldError = (field: keyof typeof fieldErrors) => fieldErrors[field] ? t('empleados.error_campo_requerido') : undefined;
    const tabTieneError = (tabKey: TabEmpleado) =>
        Object.entries(fieldErrors).some(([campo, tieneError]) => tieneError && TAB_POR_CAMPO[campo as keyof EmpleadoFormData] === tabKey);

    // IMPL-3 gap #3 (RESUELTO, revisión historia por historia) — vista de solo lectura prolija
    // para el Aprobador (permission?.can_edit !== true), en vez de los mismos inputs deshabilitados.
    const TIPO_AFILIACION_LABELS: Record<string, string> = {
        afp_crecer: 'AFP Crecer', afp_confia: 'AFP Confía', upiss: 'UPISS', ipsfa: 'IPSFA',
        jubilado: t('empleados.tipo_afiliacion_jubilado'),
    };
    const ubicacionNombre = ubicaciones.find((u) => u.id === formData.ubicacionId)?.nombre;
    // QA-Empleados gap #6 — tope del date picker nativo para fecha de nacimiento/ingreso
    // (defensa en profundidad; el bloqueo real de guardado vive en validate()).
    const fechaMaxima = new Date().toISOString().slice(0, 10);

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-primary" />
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 bg-white border-b border-border shadow-sm">
                <div className="flex items-center gap-sm h-14">
                    <button
                        onClick={() => navigate('/planilla/empleados')}
                        className="p-sm -ml-sm rounded-lg hover:bg-surface text-text-secondary hover:text-heading transition-colors shrink-0"
                    >
                        <ArrowLeft size={20} />
                    </button>
                    <div className="flex items-center gap-sm flex-1 min-w-0">
                        {isEditing ? (
                            <Avatar nombre={formData.nombreCompleto} size={32} />
                        ) : (
                            <div className="w-8 h-8 rounded-full bg-primary-light flex items-center justify-center shrink-0">
                                <User size={16} className="text-primary" />
                            </div>
                        )}
                        <div className="flex-1 min-w-0">
                            <p className="text-body font-bold text-heading truncate leading-tight">
                                {isEditing ? formData.nombreCompleto : t('empleados.detail_new_title')}
                            </p>
                            <p className="text-[11px] text-text-secondary truncate">
                                {isEditing ? [formData.cargo, formData.codigoEmpleadoManual].filter(Boolean).join(' · ') : t('empleados.detail_new_desc')}
                            </p>
                        </div>
                        {isEditing && (
                            <span className={`shrink-0 text-[11px] font-bold px-sm py-1 rounded-full ${
                                formData.estado === 'activo' ? 'bg-primary-light text-primary'
                                    : formData.estado === 'liquidado' ? 'bg-surface text-text-secondary'
                                        : 'bg-red-50 text-red-500'
                            }`}>
                                {formData.estado === 'activo' ? t('empleados.filter_active')
                                    : formData.estado === 'liquidado' ? t('empleados.filter_liquidado')
                                        : t('empleados.filter_inactive')}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-xs shrink-0">
                        {isReadOnly ? (
                            <Button type="button" variant="ghost" onClick={() => navigate('/planilla/empleados')} className="h-9 px-md">
                                {t('common.back')}
                            </Button>
                        ) : (
                            <>
                                <Button type="button" variant="ghost" onClick={() => navigate('/planilla/empleados')} disabled={isSubmitting} className="h-9 px-md">
                                    {t('common.cancel')}
                                </Button>
                                <Button type="submit" form="empleado-form" isLoading={isSubmitting} className="h-9 px-md">
                                    {isEditing ? t('common.save') : t('empleados.action_register')}
                                </Button>
                            </>
                        )}
                        {isEditing && esAdmin && !isReadOnly && (
                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setMenuOpen((o) => !o)}
                                    className="p-sm rounded-lg border border-border text-text-secondary hover:text-heading hover:bg-surface transition-colors"
                                >
                                    <MoreVertical size={16} />
                                </button>
                                {menuOpen && (
                                    <>
                                        <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                                        <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-border rounded-xl shadow-modals w-56 py-xs overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150">
                                            {formData.estado !== 'activo' && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setMenuOpen(false); setConfirmAccion('activar'); }}
                                                    className="w-full flex items-center gap-sm px-md py-sm text-[13px] font-semibold text-amber-600 hover:bg-amber-50 transition-colors"
                                                >
                                                    <UserCheck size={15} /> {t('empleados.action_activar')}
                                                </button>
                                            )}
                                            {formData.estado !== 'inactivo' && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setMenuOpen(false); setConfirmAccion('inactivar'); }}
                                                    className="w-full flex items-center gap-sm px-md py-sm text-[13px] font-semibold text-amber-600 hover:bg-amber-50 transition-colors"
                                                >
                                                    <UserX size={15} /> {t('empleados.action_inactivar')}
                                                </button>
                                            )}
                                            {formData.estado !== 'liquidado' && (
                                                <button
                                                    type="button"
                                                    onClick={() => { setMenuOpen(false); setConfirmAccion('liquidar'); }}
                                                    className="w-full flex items-center gap-sm px-md py-sm text-[13px] font-semibold text-amber-600 hover:bg-amber-50 transition-colors"
                                                >
                                                    <FileCheck size={15} /> {t('empleados.action_liquidar')}
                                                </button>
                                            )}
                                            <div className="mx-md my-xs border-t border-border" />
                                            <button
                                                type="button"
                                                onClick={() => { setMenuOpen(false); setConfirmAccion('eliminar'); }}
                                                className="w-full flex items-center gap-sm px-md py-sm text-[13px] font-semibold text-red-600 hover:bg-red-50 transition-colors"
                                            >
                                                <Trash2 size={15} /> {t('empleados.action_eliminar')}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {isReadOnly && (
                <Banner
                    variant="info"
                    title={t('empleados.readonly_title')}
                    description={t('empleados.readonly_desc')}
                />
            )}

            <div className="flex gap-sm overflow-x-auto">
                {TABS.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveTab(tab.key)}
                        className={`flex items-center gap-1.5 px-md py-sm rounded-lg border shrink-0 text-[13px] font-bold transition-colors ${activeTab === tab.key ? 'bg-primary text-white border-primary shadow-cards' : 'bg-white text-heading border-border hover:bg-surface'}`}
                    >
                        {tab.label}
                        {tabTieneError(tab.key) && (
                            <span className={`w-1.5 h-1.5 rounded-full ${activeTab === tab.key ? 'bg-white' : 'bg-error'}`} />
                        )}
                    </button>
                ))}
            </div>

            {error && (
                <div className="p-4 bg-error/10 border border-error/20 rounded-xl text-error text-sm font-medium">
                    {error}
                </div>
            )}

            {/* IMPL-124 — noValidate: la validación nativa del navegador bloqueaba el submit sin
                ningún mensaje visible cuando el campo `required` inválido vivía en la sección
                del tab NO activo (oculta con `hidden`/display:none) — el navegador no puede
                enfocar un campo no renderizado para mostrar su tooltip, así que solo tira un
                error de consola ("An invalid form control... is not focusable") y cancela el
                submit en silencio, sin llegar siquiera a disparar `handleSubmit`. Delegamos
                100% en la validación de `validate()` (mensaje + salto de tab + badge), que sí
                funciona sin importar qué tab esté oculto. */}
            <form id="empleado-form" onSubmit={handleSubmit} noValidate className={`flex flex-col ${activeTab === 'personal' || activeTab === 'cargo' ? '' : 'hidden'}`}>
              <fieldset disabled={isReadOnly} className="flex flex-col gap-lg">

                {/* Datos Personales */}
                <section className={`bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-4 ${activeTab === 'personal' ? '' : 'hidden'}`}>
                    <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                        <User size={14} className="text-primary" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_personal')}</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_nombre')} value={formData.nombreCompleto} className="sm:col-span-2" />
                        ) : (
                            <InputField
                                label={t('empleados.field_nombre')}
                                value={formData.nombreCompleto}
                                onChange={(e) => updateField('nombreCompleto', e.target.value)}
                                className={`sm:col-span-2 ${fieldClass('nombreCompleto')}`}
                                error={fieldError('nombreCompleto')}
                                required
                            />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_codigo_empleado')} value={formData.codigoEmpleadoManual} />
                        ) : (
                            <InputField
                                label={t('empleados.field_codigo_empleado')}
                                value={formData.codigoEmpleadoManual}
                                onChange={(e) => updateField('codigoEmpleadoManual', e.target.value)}
                                className={fieldClass('codigoEmpleadoManual')}
                                error={fieldError('codigoEmpleadoManual')}
                                required
                            />
                        )}
                        {isReadOnly || isEditing ? (
                            <SensitiveField
                                label={t('empleados.field_dui')}
                                value={formData.dui}
                                resourceId={formData.id!}
                                fieldName="dui"
                                mask="dui"
                                onChange={isReadOnly ? undefined : (v) => updateField('dui', v)}
                                className={fieldClass('dui')}
                                error={fieldError('dui')}
                                required={!isReadOnly && !formData.pasaporte}
                            />
                        ) : (
                            <InputField
                                label={t('empleados.field_dui')}
                                mask="dui"
                                value={formData.dui}
                                onChange={(e) => updateField('dui', e.target.value)}
                                className={fieldClass('dui')}
                                error={fieldError('dui')}
                                required={!formData.pasaporte}
                            />
                        )}
                        {/* Pasaporte (2026-10-15) — alternativa al DUI para empleados extranjeros;
                            se exige al menos uno de los dos, ver validate(). */}
                        {isReadOnly || isEditing ? (
                            <SensitiveField
                                label={t('empleados.field_pasaporte')}
                                value={formData.pasaporte}
                                resourceId={formData.id!}
                                fieldName="pasaporte"
                                onChange={isReadOnly ? undefined : (v) => updateField('pasaporte', v)}
                                className={fieldClass('pasaporte')}
                                error={fieldError('pasaporte')}
                                required={!isReadOnly && !formData.dui}
                            />
                        ) : (
                            <InputField
                                label={t('empleados.field_pasaporte')}
                                value={formData.pasaporte}
                                onChange={(e) => updateField('pasaporte', e.target.value)}
                                className={fieldClass('pasaporte')}
                                error={fieldError('pasaporte')}
                                required={!formData.dui}
                            />
                        )}
                        {isReadOnly || isEditing ? (
                            <SensitiveField
                                label={t('empleados.field_nit')}
                                value={formData.nit}
                                resourceId={formData.id!}
                                fieldName="nit"
                                onChange={isReadOnly ? undefined : (v) => updateField('nit', v)}
                                className={fieldClass('nit')}
                            />
                        ) : (
                            <InputField
                                label={t('empleados.field_nit')}
                                value={formData.nit}
                                onChange={(e) => updateField('nit', e.target.value)}
                                className={fieldClass('nit')}
                            />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_nup')} value={formData.nup} />
                        ) : (
                            <InputField
                                label={t('empleados.field_nup')}
                                value={formData.nup}
                                onChange={(e) => updateField('nup', e.target.value)}
                                className={fieldClass('nup')}
                            />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_fecha_nacimiento')} value={formData.fechaNacimiento} />
                        ) : (
                            <InputField
                                label={t('empleados.field_fecha_nacimiento')}
                                type="date" mask="date"
                                max={fechaMaxima}
                                value={formData.fechaNacimiento}
                                onChange={(e) => updateField('fechaNacimiento', e.target.value)}
                                className={fieldClass('fechaNacimiento')}
                                error={fieldError('fechaNacimiento')}
                                required
                            />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_sexo')} value={formData.sexo === 'M' ? t('empleados.sexo_m') : formData.sexo === 'F' ? t('empleados.sexo_f') : ''} />
                        ) : (
                            <div className={`flex flex-col gap-1.5 ${fieldClass('sexo')}`}>
                                <label className="text-xs font-bold uppercase tracking-wider text-text-secondary ml-1">{t('empleados.field_sexo')}</label>
                                <div className="flex bg-surface p-1 rounded-xl border border-border h-[42px]">
                                    {(['M', 'F'] as const).map(s => (
                                        <button
                                            key={s}
                                            type="button"
                                            onClick={() => updateField('sexo', s)}
                                            className={`flex-1 flex items-center justify-center text-xs font-bold rounded-lg transition-all ${formData.sexo === s ? 'bg-primary text-white shadow-md' : 'text-text-secondary hover:text-heading hover:bg-white'}`}
                                        >
                                            {s === 'M' ? t('empleados.sexo_m') : t('empleados.sexo_f')}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </section>

                {/* Contacto */}
                <section className={`bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-4 ${activeTab === 'personal' ? '' : 'hidden'}`}>
                    <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                        <Phone size={14} className="text-primary" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_contact')}</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_telefono')} value={formData.telefono} />
                        ) : (
                            <InputField
                                label={t('empleados.field_telefono')}
                                mask="phone"
                                value={formData.telefono}
                                onChange={(e) => updateField('telefono', e.target.value)}
                                className={fieldClass('telefono')}
                            />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_correo')} value={formData.correo} />
                        ) : (
                            <InputField label={t('empleados.field_correo')} type="email" value={formData.correo} onChange={(e) => updateField('correo', e.target.value)} />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_direccion')} value={formData.direccion} className="sm:col-span-2" />
                        ) : (
                            <div className="flex flex-col gap-1.5 sm:col-span-2">
                                <label className="text-sm font-semibold text-heading ml-0.5">{t('empleados.field_direccion')}</label>
                                <textarea
                                    rows={2}
                                    className="w-full bg-white border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm resize-none"
                                    value={formData.direccion}
                                    onChange={(e) => updateField('direccion', e.target.value)}
                                />
                            </div>
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_contacto_emergencia_nombre')} value={formData.contactoEmergenciaNombre} />
                        ) : (
                            <InputField label={t('empleados.field_contacto_emergencia_nombre')} value={formData.contactoEmergenciaNombre} onChange={(e) => updateField('contactoEmergenciaNombre', e.target.value)} />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_contacto_emergencia_telefono')} value={formData.contactoEmergenciaTelefono} />
                        ) : (
                            <InputField label={t('empleados.field_contacto_emergencia_telefono')} mask="phone" value={formData.contactoEmergenciaTelefono} onChange={(e) => updateField('contactoEmergenciaTelefono', e.target.value)} />
                        )}
                    </div>
                </section>

                {/* Cargo y Empresa */}
                <section className={`bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-4 ${activeTab === 'cargo' ? '' : 'hidden'}`}>
                    <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                        <Briefcase size={14} className="text-primary" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_job')}</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_cargo')} value={formData.cargo} emptyLabel={t('empleados.cargo_none')} />
                        ) : (
                            <CatalogSelectQuickAdd
                                label={t('empleados.field_cargo')}
                                value={formData.cargo}
                                onChange={(nombre) => updateField('cargo', nombre)}
                                items={cargos}
                                onCrear={(nombre) => {
                                    if (!profile?.tenant_id) return Promise.reject(new Error('Sin tenant'));
                                    return cargosService.createCargo(profile.tenant_id, nombre).then((c) => { upsertCargo(c); return c; });
                                }}
                                emptyOptionLabel={t('empleados.cargo_none')}
                                quickAddTitle={t('empleados.action_agregar_cargo')}
                                quickAddFieldLabel={t('empleados.field_nombre_cargo')}
                                duplicadoErrorMessage={t('empleados.error_cargo_duplicado')}
                                genericErrorMessage={t('empleados.error_crear_cargo')}
                            />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_departamento')} value={formData.departamento} emptyLabel={t('empleados.departamento_none')} />
                        ) : (
                            <CatalogSelectQuickAdd
                                label={t('empleados.field_departamento')}
                                value={formData.departamento}
                                onChange={(nombre) => updateField('departamento', nombre)}
                                items={departamentos}
                                onCrear={(nombre) => {
                                    if (!profile?.tenant_id) return Promise.reject(new Error('Sin tenant'));
                                    return departamentosService.createDepartamento(profile.tenant_id, nombre, colorDepartamentoNuevo)
                                        .then((d) => { upsertDepartamento(d); setColorDepartamentoNuevo('blue'); return d; });
                                }}
                                emptyOptionLabel={t('empleados.departamento_none')}
                                hint={t('empleados.departamento_hint')}
                                quickAddTitle={t('empleados.action_agregar_departamento')}
                                quickAddFieldLabel={t('empleados.field_nombre_departamento')}
                                duplicadoErrorMessage={t('empleados.error_departamento_duplicado')}
                                genericErrorMessage={t('empleados.error_crear_departamento')}
                                colorPicker={{ value: colorDepartamentoNuevo, onChange: setColorDepartamentoNuevo }}
                            />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_centro_costos')} value={formData.centroCostos} />
                        ) : (
                            <InputField label={t('empleados.field_centro_costos')} value={formData.centroCostos} onChange={(e) => updateField('centroCostos', e.target.value)} />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_ubicacion')} value={ubicacionNombre} emptyLabel={t('empleados.ubicacion_none')} />
                        ) : (
                            <div className={`flex flex-col gap-1.5 ${fieldClass('ubicacionId')}`}>
                                <label className="text-sm font-semibold text-heading ml-0.5">{t('empleados.field_ubicacion')} <span className="text-error">*</span></label>
                                <select
                                    value={formData.ubicacionId}
                                    onChange={(e) => updateField('ubicacionId', e.target.value)}
                                    className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm appearance-none cursor-pointer"
                                    required
                                >
                                    <option value="">{t('empleados.ubicacion_none')}</option>
                                    {ubicaciones.map((u) => (
                                        <option key={u.id} value={u.id}>{u.nombre}</option>
                                    ))}
                                </select>
                                {fieldError('ubicacionId') ? (
                                    <div className="flex items-center gap-1 mt-1 ml-1 animate-in fade-in slide-in-from-top-1">
                                        <AlertCircle size={12} className="text-error" />
                                        <span className="text-[11px] text-error font-medium">{fieldError('ubicacionId')}</span>
                                    </div>
                                ) : (
                                    <p className="text-[11px] text-text-secondary italic ml-0.5">{t('empleados.ubicacion_hint')}</p>
                                )}
                            </div>
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_fecha_ingreso')} value={formData.fechaIngreso} className="sm:col-span-2" />
                        ) : (
                            <InputField
                                label={t('empleados.field_fecha_ingreso')}
                                type="date" mask="date"
                                max={fechaMaxima}
                                value={formData.fechaIngreso}
                                onChange={(e) => updateField('fechaIngreso', e.target.value)}
                                className={`sm:col-span-2 ${fieldClass('fechaIngreso')}`}
                                error={fieldError('fechaIngreso')}
                                required
                            />
                        )}
                        {!isReadOnly && fechaIngresoChanged && (
                            <div className="sm:col-span-2">
                                <Banner
                                    variant="warning"
                                    title={t('empleados.warning_fecha_ingreso_title')}
                                    description={t('empleados.warning_fecha_ingreso_desc')}
                                    icon={<AlertTriangle size={18} />}
                                />
                            </div>
                        )}
                    </div>
                </section>

                {/* Remuneración y Afiliación */}
                <section className={`bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-4 ${activeTab === 'cargo' ? '' : 'hidden'}`}>
                    <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                        <DollarSign size={14} className="text-primary" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_remuneracion')}</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_sueldo')} value={formData.sueldoMensual ? fmtSueldo(Number(formData.sueldoMensual)) : ''} />
                        ) : (
                            <InputField
                                label={t('empleados.field_sueldo')}
                                mask="currency"
                                prefix="$"
                                value={formData.sueldoMensual}
                                onChange={(e) => updateField('sueldoMensual', e.target.value)}
                                className={fieldClass('sueldoMensual')}
                                error={fieldError('sueldoMensual')}
                                required
                            />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_tipo_afiliacion')} value={TIPO_AFILIACION_LABELS[formData.tipoAfiliacion]} emptyLabel={t('empleados.tipo_afiliacion_none')} />
                        ) : (
                            <div className={`flex flex-col gap-1.5 ${fieldClass('tipoAfiliacion')}`}>
                                <label className="text-sm font-semibold text-heading ml-0.5">{t('empleados.field_tipo_afiliacion')}</label>
                                <select
                                    value={formData.tipoAfiliacion}
                                    onChange={(e) => updateField('tipoAfiliacion', e.target.value as any)}
                                    className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm appearance-none cursor-pointer"
                                >
                                    <option value="">{t('empleados.tipo_afiliacion_none')}</option>
                                    <option value="afp_crecer">AFP Crecer</option>
                                    <option value="afp_confia">AFP Confía</option>
                                    <option value="upiss">UPISS</option>
                                    <option value="ipsfa">IPSFA</option>
                                    <option value="jubilado">{t('empleados.tipo_afiliacion_jubilado')}</option>
                                </select>
                                {formData.tipoAfiliacion === 'jubilado' && (
                                    <p className="text-[11px] text-text-secondary italic ml-0.5">{t('empleados.tipo_afiliacion_jubilado_hint')}</p>
                                )}
                            </div>
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_numero_afiliacion_afp')} value={formData.numeroAfiliacionAfp} />
                        ) : (
                            <InputField
                                label={t('empleados.field_numero_afiliacion_afp')}
                                value={formData.numeroAfiliacionAfp}
                                onChange={(e) => updateField('numeroAfiliacionAfp', e.target.value)}
                                className={fieldClass('numeroAfiliacionAfp')}
                            />
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_numero_afiliado_isss')} value={formData.numeroAfiliadoIsss} />
                        ) : (
                            <InputField
                                label={t('empleados.field_numero_afiliado_isss')}
                                value={formData.numeroAfiliadoIsss}
                                onChange={(e) => updateField('numeroAfiliadoIsss', e.target.value)}
                                className={fieldClass('numeroAfiliadoIsss')}
                            />
                        )}
                        {/* QA-Empleados gap #5 (7ª pasada) — reemplaza el heurístico
                            `!/gerente/i.test(formData.cargo)` (regex contra texto libre, sensible
                            a variantes de escritura) por este flag explícito que el usuario marca
                            directamente, independiente de cómo esté redactado el cargo. */}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_es_gerente_general')} value={formData.esGerenteGeneral ? t('common.yes') : t('common.no')} />
                        ) : (
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={formData.esGerenteGeneral}
                                    onChange={(e) => updateField('esGerenteGeneral', e.target.checked)}
                                    className="w-4 h-4 accent-primary"
                                />
                                <span className="text-sm text-heading">{t('empleados.field_es_gerente_general')}</span>
                            </label>
                        )}
                        <div className="sm:col-span-2 flex flex-col gap-2 mt-1">
                            {isReadOnly ? (
                                <ReadOnlyField label={t('empleados.field_retencion_especial')} value={formData.retencionEspecialViatico ? t('common.yes') : t('common.no')} />
                            ) : (
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={formData.retencionEspecialViatico}
                                        onChange={(e) => updateField('retencionEspecialViatico', e.target.checked)}
                                        className="w-4 h-4 accent-primary"
                                    />
                                    <span className="text-sm text-heading">{t('empleados.field_retencion_especial')}</span>
                                </label>
                            )}
                            {formData.retencionEspecialViatico && !formData.esGerenteGeneral && (
                                <Banner
                                    variant="warning"
                                    title={t('empleados.warning_retencion_cargo_title')}
                                    description={t('empleados.warning_retencion_cargo_desc')}
                                    icon={<AlertTriangle size={18} />}
                                />
                            )}
                        </div>
                    </div>
                </section>

                {/* Banco */}
                <section className={`bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-4 ${activeTab === 'cargo' ? '' : 'hidden'}`}>
                    <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                        <Landmark size={14} className="text-primary" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_banco')}</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_banco')} value={formData.banco} emptyLabel={t('empleados.banco_none')} />
                        ) : (
                            <div className="flex flex-col gap-1.5">
                                <label className="text-sm font-semibold text-heading ml-0.5">{t('empleados.field_banco')}</label>
                                <select
                                    value={formData.banco}
                                    onChange={(e) => updateField('banco', e.target.value)}
                                    className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm appearance-none cursor-pointer"
                                >
                                    <option value="">{t('empleados.banco_none')}</option>
                                    {bancos
                                        .filter((b) => b.estado === 'activo' || b.nombre === formData.banco)
                                        .map((b) => (
                                            <option key={b.id} value={b.nombre}>
                                                {b.nombre}{b.estado === 'inactivo' ? ` (${t('horasExtras.estado_inactivo')})` : ''}
                                            </option>
                                        ))}
                                </select>
                                <p className="text-[11px] text-text-secondary italic ml-0.5">{t('empleados.banco_hint')}</p>
                            </div>
                        )}
                        {isReadOnly || isEditing ? (
                            <SensitiveField
                                label={t('empleados.field_numero_cuenta')}
                                value={formData.numeroCuenta}
                                resourceId={formData.id!}
                                fieldName="numero_cuenta"
                                visibleChars={4}
                                onChange={isReadOnly ? undefined : (v) => updateField('numeroCuenta', v)}
                                className={fieldClass('numeroCuenta')}
                            />
                        ) : (
                            <InputField
                                label={t('empleados.field_numero_cuenta')}
                                value={formData.numeroCuenta}
                                onChange={(e) => updateField('numeroCuenta', e.target.value)}
                                className={fieldClass('numeroCuenta')}
                            />
                        )}
                    </div>
                </section>

                {/* Estado */}
                <section className={`bg-white rounded-lg shadow-cards border border-border p-lg flex flex-col gap-4 ${activeTab === 'cargo' ? '' : 'hidden'}`}>
                    <div className="flex items-center gap-2 pb-1 border-b border-border/50">
                        <UserCheck size={14} className="text-primary" />
                        <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_estado')}</h3>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_estado')} value={
                                formData.estado === 'activo' ? t('empleados.filter_active')
                                    : formData.estado === 'liquidado' ? t('empleados.filter_liquidado')
                                        : t('empleados.filter_inactive')
                            } />
                        ) : (
                            <div className="flex flex-col gap-1.5">
                                <label className="text-sm font-semibold text-heading ml-0.5">{t('empleados.field_estado')}</label>
                                <div className="flex bg-surface p-1 rounded-xl border border-border h-[42px]">
                                    <button
                                        type="button"
                                        onClick={() => updateField('estado', 'activo')}
                                        className={`flex-1 flex items-center justify-center text-xs font-bold rounded-lg transition-all ${formData.estado === 'activo' ? 'bg-primary text-white shadow-md' : 'text-text-secondary hover:text-heading hover:bg-white'}`}
                                    >
                                        {t('empleados.filter_active')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => updateField('estado', 'inactivo')}
                                        className={`flex-1 flex items-center justify-center text-xs font-bold rounded-lg transition-all ${formData.estado === 'inactivo' ? 'bg-error text-white shadow-md' : 'text-text-secondary hover:text-heading hover:bg-white'}`}
                                    >
                                        {t('empleados.filter_inactive')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => updateField('estado', 'liquidado')}
                                        className={`flex-1 flex items-center justify-center text-xs font-bold rounded-lg transition-all ${formData.estado === 'liquidado' ? 'bg-heading text-white shadow-md' : 'text-text-secondary hover:text-heading hover:bg-white'}`}
                                    >
                                        {t('empleados.filter_liquidado')}
                                    </button>
                                </div>
                            </div>
                        )}
                        {isReadOnly ? (
                            <ReadOnlyField label={t('empleados.field_tipo_contrato')} value={formData.tipoContrato} emptyLabel={t('empleados.tipo_contrato_none')} />
                        ) : (
                            <div className={`flex flex-col gap-1.5 ${fieldClass('tipoContrato')}`}>
                                <label className="text-sm font-semibold text-heading ml-0.5">{t('empleados.field_tipo_contrato')}</label>
                                <select
                                    value={formData.tipoContrato}
                                    onChange={(e) => updateField('tipoContrato', e.target.value)}
                                    className="w-full bg-white border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm appearance-none cursor-pointer"
                                >
                                    <option value="">{t('empleados.tipo_contrato_none')}</option>
                                    {tiposContrato
                                        .filter((tc) => tc.estado === 'activo' || tc.nombre === formData.tipoContrato)
                                        .map((tc) => (
                                            <option key={tc.id} value={tc.nombre}>
                                                {tc.nombre}{tc.estado === 'inactivo' ? ` (${t('horasExtras.estado_inactivo')})` : ''}
                                            </option>
                                        ))}
                                </select>
                            </div>
                        )}
                    </div>
                    {estadoActivoAInactivo && tieneCompromisosActivos && (
                        <Banner
                            variant="warning"
                            title={t('empleados.warning_compromisos_activos_title')}
                            description={compromisosDescripcion}
                            icon={<AlertTriangle size={18} />}
                        />
                    )}
                </section>
              </fieldset>
            </form>

            {activeTab === 'cargo' && isEditing && formData.id && (
                <IndemnizacionesSection
                    empleadoId={formData.id}
                    isReadOnly={isReadOnly}
                    fechaIngresoActual={formData.fechaIngreso}
                    onRegistered={() => loadEmpleado(formData.id!)}
                />
            )}

            {activeTab === 'cargo' && isEditing && formData.id && formData.fechaIngreso && (
                <VacacionesResumenSection empleadoId={formData.id} fechaIngreso={formData.fechaIngreso} />
            )}

            {activeTab === 'descuentos' && isEditing && formData.id && (
                <DescuentosSection empleadoId={formData.id} isReadOnly={isReadOnly} />
            )}

            {activeTab === 'documentos' && isEditing && formData.id && (
                <DocumentosSection empleadoId={formData.id} isReadOnly={isReadOnly} />
            )}

            {activeTab === 'historial' && isEditing && formData.id && (
                <HistorialCambiosSection empleadoId={formData.id} />
            )}

            <ConfirmModal
                isOpen={confirmAccion === 'activar' || confirmAccion === 'inactivar' || confirmAccion === 'liquidar'}
                onClose={() => setConfirmAccion(null)}
                onConfirm={handleConfirmarCambioEstado}
                title={confirmAccion === 'activar'
                    ? t('empleados.confirmar_activar_title', { nombre: formData.nombreCompleto })
                    : confirmAccion === 'liquidar'
                        ? t('empleados.confirmar_liquidar_title', { nombre: formData.nombreCompleto })
                        : t('empleados.confirmar_inactivar_title', { nombre: formData.nombreCompleto })}
                message={confirmAccion === 'activar' ? t('empleados.confirmar_activar_message') : (
                    <>
                        {confirmAccion === 'liquidar' ? t('empleados.confirmar_liquidar_message') : t('empleados.confirmar_inactivar_message')}
                        {tieneCompromisosActivos && (
                            <Banner
                                variant="warning"
                                title={t('empleados.warning_compromisos_activos_title')}
                                description={compromisosDescripcion}
                                icon={<AlertTriangle size={18} />}
                                className="mt-4 text-left"
                            />
                        )}
                    </>
                )}
                confirmLabel={confirmAccion === 'activar' ? t('empleados.action_activar') : confirmAccion === 'liquidar' ? t('empleados.action_liquidar') : t('empleados.action_inactivar')}
                variant="warning"
                Icon={confirmAccion === 'activar' ? UserCheck : confirmAccion === 'liquidar' ? FileCheck : UserX}
                isLoading={isProcesandoAccion}
            />

            <ConfirmModal
                isOpen={confirmAccion === 'eliminar'}
                onClose={() => setConfirmAccion(null)}
                onConfirm={handleConfirmarEliminar}
                title={t('empleados.confirmar_eliminar_title', { nombre: formData.nombreCompleto })}
                message={t('empleados.confirmar_eliminar_message')}
                confirmLabel={t('empleados.action_eliminar')}
                variant="danger"
                Icon={Trash2}
                isLoading={isProcesandoAccion}
            />
        </div>
    );
};
