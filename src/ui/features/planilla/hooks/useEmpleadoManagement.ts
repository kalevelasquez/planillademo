import { useState } from 'react';
import { useAuthStore } from '../../../../store/authStore';
import { usePlanillaEmpleadosStore } from '../../../../store/planillaEmpleadosStore';
import { planillaEmpleadosService, type Empleado } from '../../../../services/planillaEmpleadosService';
import { auditService } from '../../../../services/auditService';
import { MESSAGES } from '../../../../config/constants';
import { useToast } from '../../../../context/ToastContext';
import { Logger } from '../../../../utils/logger';

export interface EmpleadoFormData {
    id?: string;
    codigoEmpleadoManual: string;
    nombreCompleto: string;
    dui: string;
    nit: string;
    nup: string;
    /** Alternativa al DUI para empleados extranjeros (2026-10-15) — ver validate(). */
    pasaporte: string;
    fechaNacimiento: string;
    sexo: 'M' | 'F' | '';
    telefono: string;
    correo: string;
    direccion: string;
    contactoEmergenciaNombre: string;
    contactoEmergenciaTelefono: string;
    cargo: string;
    departamento: string;
    centroCostos: string;
    ubicacionId: string;
    fechaIngreso: string;
    sueldoMensual: string;
    tipoAfiliacion: 'afp_crecer' | 'afp_confia' | 'upiss' | 'jubilado' | 'ipsfa' | '';
    numeroAfiliacionAfp: string;
    /** IMPL-99, columna 7 de la Planilla Única ISSS/AFP. */
    numeroAfiliadoIsss: string;
    retencionEspecialViatico: boolean;
    esGerenteGeneral: boolean;
    banco: string;
    numeroCuenta: string;
    estado: 'activo' | 'inactivo' | 'liquidado';
    tipoContrato: string;
}

const EMPTY_FORM: EmpleadoFormData = {
    codigoEmpleadoManual: '', nombreCompleto: '', dui: '', nit: '', nup: '', pasaporte: '', fechaNacimiento: '', sexo: '',
    telefono: '', correo: '', direccion: '', contactoEmergenciaNombre: '', contactoEmergenciaTelefono: '',
    cargo: '', departamento: '', centroCostos: '', ubicacionId: '', fechaIngreso: '',
    sueldoMensual: '', tipoAfiliacion: '', numeroAfiliacionAfp: '', numeroAfiliadoIsss: '', retencionEspecialViatico: false,
    esGerenteGeneral: false,
    banco: '', numeroCuenta: '', estado: 'activo', tipoContrato: '',
};

// CA3 (IMPL-3, corrección de alcance detectada en UAT agosto 2026 — IMPL-123): obligatoriedad
// evaluada campo por campo, no por fila del DRN. Únicos obligatorios: código de empleado
// (IMPL-120), nombre, fecha de nacimiento, ubicación, fecha de ingreso y sueldo mensual —
// NIT, NUP, sexo, teléfono, tipo de afiliación, banco, número de cuenta y tipo de contrato pasan
// a opcionales.
// DUI dejó de estar en esta lista (2026-10-15) — ver el chequeo de "DUI o Pasaporte" en
// validate(), para poder registrar empleados extranjeros sin DUI salvadoreño.
const REQUIRED_FIELDS: (keyof EmpleadoFormData)[] = [
    'codigoEmpleadoManual', 'nombreCompleto', 'fechaNacimiento', 'ubicacionId', 'fechaIngreso', 'sueldoMensual',
];

function mapEmpleadoToForm(emp: Empleado): EmpleadoFormData {
    return {
        id: emp.id,
        codigoEmpleadoManual: emp.codigo_empleado_manual || '',
        nombreCompleto: emp.nombre_completo,
        dui: emp.dui || '',
        nit: emp.nit || '',
        nup: emp.nup || '',
        pasaporte: emp.pasaporte || '',
        fechaNacimiento: emp.fecha_nacimiento || '',
        sexo: emp.sexo || '',
        telefono: emp.telefono,
        correo: emp.correo || '',
        direccion: emp.direccion || '',
        contactoEmergenciaNombre: emp.contacto_emergencia_nombre || '',
        contactoEmergenciaTelefono: emp.contacto_emergencia_telefono || '',
        cargo: emp.cargo || '',
        departamento: emp.departamento || '',
        centroCostos: emp.centro_costos || '',
        ubicacionId: emp.ubicacion_id || '',
        fechaIngreso: emp.fecha_ingreso,
        sueldoMensual: emp.sueldo_mensual !== null ? String(emp.sueldo_mensual) : '',
        tipoAfiliacion: emp.tipo_afiliacion || '',
        numeroAfiliacionAfp: emp.numero_afiliacion_afp || '',
        numeroAfiliadoIsss: emp.numero_afiliado_isss || '',
        retencionEspecialViatico: emp.retencion_especial_viatico,
        esGerenteGeneral: emp.es_gerente_general,
        banco: emp.banco || '',
        numeroCuenta: emp.numero_cuenta || '',
        estado: emp.estado,
        tipoContrato: emp.tipo_contrato || '',
    };
}

export function useEmpleadoManagement(
    onSaved: (empleado: Empleado) => void,
    // IMPL-124 (UX de alta poco intuitiva) — deja que la vista salte al tab donde vive el
    // primer campo faltante; sin esto, un campo obligatorio del tab "Cargo y Remuneración"
    // faltante mientras el usuario ve "Datos Personales" era invisible (sección oculta con
    // `hidden`, sin ningún indicador en el botón del tab).
    onValidationFailed?: (missingFields: (keyof EmpleadoFormData)[]) => void,
) {
    const { profile } = useAuthStore();
    const { addEmpleado, updateEmpleadoLocal } = usePlanillaEmpleadosStore();
    const { showToast } = useToast();

    const [formData, setFormData] = useState<EmpleadoFormData>(EMPTY_FORM);
    const [fechaIngresoOriginal, setFechaIngresoOriginal] = useState<string | null>(null);
    const [estadoOriginal, setEstadoOriginal] = useState<'activo' | 'inactivo' | 'liquidado' | null>(null);
    // US-AUD-06 CA1 — EDICION_SUELDO se audita como acción distinta de un CREATE/UPDATE
    // genérico, mismo criterio que fechaIngresoOriginal/estadoOriginal.
    const [sueldoMensualOriginal, setSueldoMensualOriginal] = useState<number | null>(null);
    // codigo_reloj_marcador no es parte del formulario (se asigna vía otro flujo, ver
    // getEmpleadosConCodigoReloj en planillaEmpleadosService) — se preserva el valor existente
    // al editar para no pisarlo con null en cada guardado.
    const [codigoRelojMarcadorOriginal, setCodigoRelojMarcadorOriginal] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<keyof EmpleadoFormData, boolean>>>({});

    const isEditing = Boolean(formData.id);
    const fechaIngresoChanged = isEditing && fechaIngresoOriginal !== null && formData.fechaIngreso !== fechaIngresoOriginal;
    // US-ANT-07 (IMPL-83) CA1 — detecta la transición activo→(inactivo|liquidado) para disparar
    // la alerta informativa de anticipos activos, mismo criterio que fechaIngresoChanged.
    // Ampliado (2026-10-08) para cubrir también la transición a 'liquidado', nuevo desde que se
    // agregó ese estado — es, si acaso, más importante verificar compromisos pendientes ahí que
    // al simplemente inactivar.
    const estadoActivoAInactivo = isEditing && estadoOriginal === 'activo' && formData.estado !== 'activo';

    const updateField = <K extends keyof EmpleadoFormData>(field: K, value: EmpleadoFormData[K]) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        if (fieldErrors[field]) {
            setFieldErrors((prev) => ({ ...prev, [field]: false }));
        }
    };

    const loadEmpleado = async (id: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const empleado = await planillaEmpleadosService.getEmpleadoById(id);
            const form = mapEmpleadoToForm(empleado);
            setFormData(form);
            setFechaIngresoOriginal(empleado.fecha_ingreso);
            setEstadoOriginal(empleado.estado);
            setSueldoMensualOriginal(empleado.sueldo_mensual);
            setCodigoRelojMarcadorOriginal(empleado.codigo_reloj_marcador);
        } catch (err: unknown) {
            Logger.error('Error al cargar el perfil del empleado', { empleadoId: id }, err);
            setError(err instanceof Error ? err.message : 'No se pudo cargar el empleado.');
        } finally {
            setIsLoading(false);
        }
    };

    const resetForm = () => {
        setFormData(EMPTY_FORM);
        setFechaIngresoOriginal(null);
        setEstadoOriginal(null);
        setSueldoMensualOriginal(null);
        setCodigoRelojMarcadorOriginal(null);
        setFieldErrors({});
        setError(null);
    };

    // CA3 — no se puede guardar sin los campos obligatorios
    const validate = (): boolean => {
        const missing: Partial<Record<keyof EmpleadoFormData, boolean>> = {};
        for (const field of REQUIRED_FIELDS) {
            if (!formData[field]) missing[field] = true;
        }

        // QA-Empleados gap #4 — sueldoMensual puede ser un texto no vacío pero malformado (ej.
        // "1.234.56", dos puntos decimales). Number(...) da NaN, que JSON.stringify serializa
        // como null y pisa en silencio un campo obligatorio de planilla. Se trata como "faltante"
        // para reusar el mismo camino de error/salto de tab que el resto de los campos.
        if (!missing.sueldoMensual && formData.sueldoMensual && isNaN(Number(formData.sueldoMensual))) {
            missing.sueldoMensual = true;
        }

        // 2026-10-15 — DUI o Pasaporte: se exige al menos uno de los dos (nunca ambos vacíos),
        // para poder registrar empleados extranjeros sin DUI salvadoreño. Si ninguno está
        // presente, se marcan los dos campos para que el usuario vea el error en cualquiera.
        if (!formData.dui && !formData.pasaporte) {
            missing.dui = true;
            missing.pasaporte = true;
        }

        // QA-Empleados gap #5 — el DUI debe cumplir el formato salvadoreño NNNNNNNN-N (8 dígitos,
        // guion, dígito verificador). Solo valida formato cuando el campo no está vacío — el
        // chequeo de arriba ya cubre el caso de que esté vacío.
        if (!missing.dui && formData.dui && !/^\d{8}-\d$/.test(formData.dui)) {
            missing.dui = true;
        }

        // QA-Empleados gap #6 — fecha de nacimiento y fecha de ingreso no pueden ser futuras. El
        // atributo `max` del <input type="date"> es defensa en profundidad (no bloquea texto
        // tipeado/pegado a mano), esta es la validación que realmente bloquea el guardado.
        const todayStr = new Date().toISOString().slice(0, 10);
        if (!missing.fechaNacimiento && formData.fechaNacimiento && formData.fechaNacimiento > todayStr) {
            missing.fechaNacimiento = true;
        }
        if (!missing.fechaIngreso && formData.fechaIngreso && formData.fechaIngreso > todayStr) {
            missing.fechaIngreso = true;
        }

        setFieldErrors(missing);
        const missingFields = Object.keys(missing) as (keyof EmpleadoFormData)[];
        if (missingFields.length > 0) {
            setError(MESSAGES.ERROR.FIELDS_REQUIRED);
            onValidationFailed?.(missingFields);
            return false;
        }
        return true;
    };

    const handleSubmit = async (e: React.SyntheticEvent) => {
        e.preventDefault();
        if (isSubmitting) return;

        if (!profile?.tenant_id) {
            setError(MESSAGES.ERROR.NO_TENANT);
            return;
        }
        if (!validate()) return;

        const dataToSubmit = {
            tenant_id: profile.tenant_id,
            codigo_empleado_manual: formData.codigoEmpleadoManual,
            nombre_completo: formData.nombreCompleto,
            dui: formData.dui || null,
            nit: formData.nit || null,
            nup: formData.nup || null,
            pasaporte: formData.pasaporte || null,
            fecha_nacimiento: formData.fechaNacimiento || null,
            sexo: formData.sexo || null,
            telefono: formData.telefono,
            correo: formData.correo || null,
            direccion: formData.direccion || null,
            contacto_emergencia_nombre: formData.contactoEmergenciaNombre || null,
            contacto_emergencia_telefono: formData.contactoEmergenciaTelefono || null,
            cargo: formData.cargo || null,
            departamento: formData.departamento || null,
            // IMPL-121: campo eliminado del formulario (redundante con ubicacion_id) — la
            // columna sigue existiendo en BD, se deja de escribir en vez de dropearla.
            sucursal: null,
            centro_costos: formData.centroCostos || null,
            ubicacion_id: formData.ubicacionId || null,
            fecha_ingreso: formData.fechaIngreso,
            sueldo_mensual: formData.sueldoMensual ? Number(formData.sueldoMensual) : null,
            tipo_afiliacion: formData.tipoAfiliacion || null,
            numero_afiliacion_afp: formData.numeroAfiliacionAfp || null,
            numero_afiliado_isss: formData.numeroAfiliadoIsss || null,
            retencion_especial_viatico: formData.retencionEspecialViatico,
            es_gerente_general: formData.esGerenteGeneral,
            banco: formData.banco || null,
            numero_cuenta: formData.numeroCuenta || null,
            estado: formData.estado,
            tipo_contrato: formData.tipoContrato || null,
            foto_url: null,
            codigo_reloj_marcador: codigoRelojMarcadorOriginal,
        };

        setError(null);
        setIsSubmitting(true);
        try {
            let saved: Empleado;
            if (formData.id) {
                saved = await planillaEmpleadosService.updateEmpleado(formData.id, dataToSubmit);
                if (dataToSubmit.sueldo_mensual !== sueldoMensualOriginal) {
                    await auditService.logAction('EDICION_SUELDO', 'planilla_empleados', formData.id, {
                        anterior: sueldoMensualOriginal, nuevo: dataToSubmit.sueldo_mensual,
                    });
                }
                updateEmpleadoLocal(formData.id, saved);
                showToast('Empleado actualizado correctamente.', 'success');
            } else {
                saved = await planillaEmpleadosService.createEmpleado(dataToSubmit);
                addEmpleado(saved);
                showToast('Empleado registrado correctamente.', 'success');
            }
            onSaved(saved);
        } catch (err: unknown) {
            Logger.error('Error al guardar el perfil del empleado', { action: formData.id ? 'update' : 'create', empleadoId: formData.id }, err);
            const errCode = String((err as { code?: string })?.code || '');
            const errMsg = err instanceof Error ? err.message : '';
            // idx_planilla_empleados_dui_unico (migración 20260928100000, construida para la carga
            // masiva) — el alta individual puede chocar contra el mismo índice, así que necesita
            // su propio mensaje amigable en vez de caer en el genérico de código duplicado.
            if (errCode === '23505' && errMsg.includes('dui')) {
                setError(MESSAGES.ERROR.EMPLOYEE_DUI_DUPLICADO);
            } else if (errCode === '23505' || errMsg.includes('duplicate') || errMsg.includes('codigo_empleado_manual')) {
                setError(MESSAGES.ERROR.EMPLOYEE_CODIGO_DUPLICADO);
            } else {
                setError(errMsg || MESSAGES.ERROR.EMPLOYEE_SAVE);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return {
        formData,
        isEditing,
        isLoading,
        isSubmitting,
        error,
        fieldErrors,
        fechaIngresoChanged,
        estadoActivoAInactivo,
        updateField,
        loadEmpleado,
        resetForm,
        handleSubmit,
    };
}
