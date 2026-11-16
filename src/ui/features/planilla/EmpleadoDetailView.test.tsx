import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import { ToastProvider } from '../../../context/ToastContext';
import { EmpleadoDetailView } from './EmpleadoDetailView';
import { useEmpleadoManagement, type EmpleadoFormData } from './hooks/useEmpleadoManagement';
import { usePermission } from '../../../hooks/usePermission';
import { useUbicacionesStore } from '../../../store/ubicacionesStore';
import { useDepartamentosStore } from '../../../store/departamentosStore';
import { useBancosStore } from '../../../store/bancosStore';
import { useTiposContratoStore } from '../../../store/tiposContratoStore';
import { useQuincenasStore } from '../../../store/quincenasStore';
import { anticiposService, type Anticipo } from '../../../services/anticiposService';
import { descuentosService, type Descuento } from '../../../services/descuentosService';
import { horasExtrasManualService, type HorasExtrasManualRow } from '../../../services/horasExtrasManualService';
import type { Permission } from '../../../services/permissionService';
import type { Quincena } from '../../../services/quincenasService';

vi.mock('./hooks/useEmpleadoManagement', () => ({
    useEmpleadoManagement: vi.fn(),
}));

vi.mock('../../../hooks/usePermission', () => ({
    usePermission: vi.fn(),
}));

vi.mock('../../../store/ubicacionesStore', () => ({
    useUbicacionesStore: vi.fn(),
}));

vi.mock('../../../store/departamentosStore', () => ({
    useDepartamentosStore: vi.fn(),
}));

vi.mock('../../../store/bancosStore', () => ({
    useBancosStore: vi.fn(),
}));

vi.mock('../../../store/tiposContratoStore', () => ({
    useTiposContratoStore: vi.fn(),
}));

vi.mock('../../../store/quincenasStore', () => ({
    useQuincenasStore: vi.fn(),
}));

vi.mock('../../../services/anticiposService', async () => {
    const actual = await vi.importActual<typeof import('../../../services/anticiposService')>(
        '../../../services/anticiposService'
    );
    return { ...actual, anticiposService: { ...actual.anticiposService, getActivosPorEmpleado: vi.fn() } };
});

vi.mock('../../../services/descuentosService', async () => {
    const actual = await vi.importActual<typeof import('../../../services/descuentosService')>(
        '../../../services/descuentosService'
    );
    return { ...actual, descuentosService: { ...actual.descuentosService, getActivosPorEmpleado: vi.fn() } };
});

vi.mock('../../../services/horasExtrasManualService', async () => {
    const actual = await vi.importActual<typeof import('../../../services/horasExtrasManualService')>(
        '../../../services/horasExtrasManualService'
    );
    return { ...actual, horasExtrasManualService: { ...actual.horasExtrasManualService, getPorEmpleadoYQuincena: vi.fn() } };
});

// Las 5 sub-secciones hacen sus propios fetch de servicio — se stubean para probar
// EmpleadoDetailView en aislamiento, no su propio contenido (ya tienen tests propios).
vi.mock('./components/IndemnizacionesSection', () => ({ IndemnizacionesSection: () => <div data-testid="indemnizaciones-section" /> }));
vi.mock('./components/DescuentosSection', () => ({ DescuentosSection: () => <div data-testid="descuentos-section" /> }));
vi.mock('./components/DocumentosSection', () => ({ DocumentosSection: () => <div data-testid="documentos-section" /> }));
vi.mock('./components/VacacionesResumenSection', () => ({ VacacionesResumenSection: () => <div data-testid="vacaciones-section" /> }));
vi.mock('./components/HistorialCambiosSection', () => ({ HistorialCambiosSection: () => <div data-testid="historial-section" /> }));

const mockedUseEmpleadoManagement = vi.mocked(useEmpleadoManagement);
const mockedUsePermission = vi.mocked(usePermission);
const mockedUseUbicacionesStore = vi.mocked(useUbicacionesStore);
const mockedUseDepartamentosStore = vi.mocked(useDepartamentosStore);
const mockedUseBancosStore = vi.mocked(useBancosStore);
const mockedUseTiposContratoStore = vi.mocked(useTiposContratoStore);
const mockedUseQuincenasStore = vi.mocked(useQuincenasStore);
const mockedGetAnticiposActivos = vi.mocked(anticiposService.getActivosPorEmpleado);
const mockedGetDescuentosActivos = vi.mocked(descuentosService.getActivosPorEmpleado);
const mockedGetHorasExtrasPendientes = vi.mocked(horasExtrasManualService.getPorEmpleadoYQuincena);

function makeQuincena(overrides: Partial<Quincena> = {}): Quincena {
    return {
        id: 'q1',
        tenant_id: 't1',
        tipo: 'normal',
        nombre: 'Quincena',
        etiqueta_estandar: 'Quincena',
        fecha_inicio: '2026-07-16',
        fecha_fin: '2026-07-31',
        dias_habiles: 12,
        estado: 'en_proceso',
        created_by: null,
        created_at: '2026-07-01T00:00:00Z',
        deleted_at: null,
        enviada_por: null, enviada_at: null,
        aprobada_por: null, aprobada_at: null, aprobada_comentario: null,
        rechazada_por: null, rechazada_at: null, rechazo_motivo: null,
        reabierta_por: null, reabierta_at: null, reapertura_motivo: null,
        es_prueba: false,
        ...overrides,
    };
}

function makeFormData(overrides: Partial<EmpleadoFormData> = {}): EmpleadoFormData {
    return {
        id: 'e1',
        codigoEmpleadoManual: 'C-001',
        nombreCompleto: 'Juan Pérez',
        dui: '01234567-8',
        nit: '',
        nup: '',
        pasaporte: '',
        fechaNacimiento: '1990-01-01',
        sexo: '',
        telefono: '70000000',
        correo: '',
        direccion: '',
        contactoEmergenciaNombre: '',
        contactoEmergenciaTelefono: '',
        cargo: 'Operario',
        departamento: '',
        centroCostos: '',
        ubicacionId: 'u1',
        fechaIngreso: '2026-01-01',
        sueldoMensual: '500',
        tipoAfiliacion: '',
        numeroAfiliacionAfp: '',
        numeroAfiliadoIsss: '',
        retencionEspecialViatico: false,
        esGerenteGeneral: false,
        banco: '',
        numeroCuenta: '',
        estado: 'activo',
        tipoContrato: '',
        ...overrides,
    };
}

function makePermission(overrides: Partial<Permission> = {}): Permission {
    return {
        resource: 'planilla_empleados',
        can_view: true, can_create: true, can_edit: true, can_delete: true, can_export: true, can_approve: true,
        view_scope: 'all', edit_scope: 'all', delete_scope: 'all',
        ...overrides,
    };
}

function setManagementState(overrides: Record<string, unknown> = {}) {
    mockedUseEmpleadoManagement.mockReturnValue({
        formData: makeFormData(),
        isEditing: true,
        isLoading: false,
        isSubmitting: false,
        error: null,
        fieldErrors: {},
        fechaIngresoChanged: false,
        estadoActivoAInactivo: false,
        updateField: vi.fn(),
        loadEmpleado: vi.fn(),
        handleSubmit: vi.fn((e: React.SyntheticEvent) => e.preventDefault()),
        ...overrides,
    } as never);
}

function renderView(idParam = 'e1') {
    return render(
        <ToastProvider>
            <MemoryRouter initialEntries={[`/planilla/empleados/${idParam}`]}>
                <Routes>
                    <Route path="/planilla/empleados/:id" element={<EmpleadoDetailView />} />
                </Routes>
            </MemoryRouter>
        </ToastProvider>
    );
}

describe('EmpleadoDetailView (IMPL-3)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedUsePermission.mockReturnValue(makePermission());
        mockedUseUbicacionesStore.mockReturnValue({ ubicaciones: [{ id: 'u1', nombre: 'Planta' }], fetchUbicaciones: vi.fn() } as never);
        mockedUseDepartamentosStore.mockReturnValue({ departamentos: [], fetchDepartamentos: vi.fn() } as never);
        mockedUseBancosStore.mockReturnValue({ bancos: [], fetchBancos: vi.fn() } as never);
        mockedUseTiposContratoStore.mockReturnValue({ tiposContrato: [], fetchTiposContrato: vi.fn() } as never);
        mockedUseQuincenasStore.mockReturnValue({ quincenas: [makeQuincena()], isLoading: false, error: null, fetchQuincenas: vi.fn(), addQuincena: vi.fn() } as never);
        mockedGetAnticiposActivos.mockResolvedValue([]);
        mockedGetDescuentosActivos.mockResolvedValue([]);
        mockedGetHorasExtrasPendientes.mockResolvedValue([]);
        setManagementState();
    });

    it('muestra el banner de solo lectura y oculta el botón de guardar cuando el usuario no puede editar', () => {
        mockedUsePermission.mockReturnValue(makePermission({ can_edit: false }));
        renderView();

        expect(screen.getByText('Perfil de solo lectura')).toBeInTheDocument();
        expect(screen.queryByText('Guardar')).not.toBeInTheDocument();
    });

    it('muestra el botón Guardar y no el banner de solo lectura cuando el usuario puede editar', () => {
        renderView();

        expect(screen.queryByText('Perfil de solo lectura')).not.toBeInTheDocument();
        expect(screen.getByText('Guardar')).toBeInTheDocument();
    });

    it('muestra la advertencia de cambio de fecha de ingreso solo cuando fechaIngresoChanged es true y se puede editar', () => {
        setManagementState({ fechaIngresoChanged: true });
        renderView();

        expect(screen.getByText('Va a cambiar la fecha de ingreso')).toBeInTheDocument();
    });

    it('oculta la advertencia de fecha de ingreso en modo solo lectura aunque fechaIngresoChanged sea true', () => {
        setManagementState({ fechaIngresoChanged: true });
        mockedUsePermission.mockReturnValue(makePermission({ can_edit: false }));
        renderView();

        expect(screen.queryByText('Va a cambiar la fecha de ingreso')).not.toBeInTheDocument();
    });

    it('muestra la advertencia de retención especial cuando el empleado no está marcado como Gerente General (QA-Empleados gap #5, 7ª pasada — reemplaza el regex sobre `cargo`)', () => {
        setManagementState({ formData: makeFormData({ retencionEspecialViatico: true, esGerenteGeneral: false, cargo: 'Operario' }) });
        renderView();

        expect(screen.getByText('Este beneficio hoy solo aplica a Gerencia General')).toBeInTheDocument();
    });

    it('no muestra la advertencia de retención especial cuando el empleado sí está marcado como Gerente General, sin importar el texto de `cargo`', () => {
        setManagementState({ formData: makeFormData({ retencionEspecialViatico: true, esGerenteGeneral: true, cargo: 'Gte. General' }) });
        renderView();

        expect(screen.queryByText('Este beneficio hoy solo aplica a Gerencia General')).not.toBeInTheDocument();
    });

    it('muestra la advertencia combinada de anticipos y descuentos activos al liquidar (US-ANT-07/US-DESC-06)', async () => {
        mockedGetAnticiposActivos.mockResolvedValue([
            { numero_vale: 'V-001', monto_total: 100, monto_pagado: 40 } as Anticipo,
        ]);
        mockedGetDescuentosActivos.mockResolvedValue([
            { codigo: 'D-002', monto_total: 200, monto_pagado: 50 } as Descuento,
        ]);
        setManagementState({ estadoActivoAInactivo: true });
        renderView();

        expect(await screen.findByText('Este empleado tiene anticipos, descuentos y/o horas extra pendientes')).toBeInTheDocument();
    });

    it('muestra la advertencia cuando el empleado tiene horas extra ya confirmadas de la quincena activa (IMPL-23 CA5/IMPL-25 — gap real corregido)', async () => {
        mockedGetHorasExtrasPendientes.mockResolvedValue([
            { id: 'h1', tenant_id: 't1', quincena_id: 'q1', ubicacion_id: 'u1', empleado_id: 'e1', hed: 2, hen: 1, nocturnidad: 0, feriado: 0, monto_total: 35.5, guardado_por: 'u1', guardado_at: '2026-07-20T00:00:00Z' } as HorasExtrasManualRow,
        ]);
        setManagementState({ estadoActivoAInactivo: true });
        renderView();

        expect(await screen.findByText('Este empleado tiene anticipos, descuentos y/o horas extra pendientes')).toBeInTheDocument();
        expect(screen.getByText(/Horas extra ya confirmadas de la quincena actual: \$35\.50 sin liquidar/)).toBeInTheDocument();
    });

    it('no consulta horas extra pendientes si no hay ninguna quincena activa', () => {
        mockedUseQuincenasStore.mockReturnValue({ quincenas: [], isLoading: false, error: null, fetchQuincenas: vi.fn(), addQuincena: vi.fn() } as never);
        setManagementState({ estadoActivoAInactivo: true });
        renderView();

        expect(mockedGetHorasExtrasPendientes).not.toHaveBeenCalled();
    });

    it('renderiza el valor de numero_afiliacion_afp en modo edición (IMPL-99, campo de captura agregado)', () => {
        setManagementState({ formData: makeFormData({ numeroAfiliacionAfp: 'AFP-12345' }) });
        renderView();

        expect(screen.getByDisplayValue('AFP-12345')).toBeInTheDocument();
    });

    it('renderiza las 5 sub-secciones en su pestaña correspondiente cuando isEditing y formData.id existen (US-UX-02, pestañas del prototipo)', () => {
        renderView();

        // Pestaña por defecto ("Datos Personales") no muestra ninguna sub-sección relacionada.
        expect(screen.queryByTestId('indemnizaciones-section')).not.toBeInTheDocument();
        expect(screen.queryByTestId('descuentos-section')).not.toBeInTheDocument();
        expect(screen.queryByTestId('documentos-section')).not.toBeInTheDocument();
        expect(screen.queryByTestId('vacaciones-section')).not.toBeInTheDocument();
        expect(screen.queryByTestId('historial-section')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Cargo y Remuneración' }));
        expect(screen.getByTestId('indemnizaciones-section')).toBeInTheDocument();
        expect(screen.getByTestId('vacaciones-section')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Descuentos' }));
        expect(screen.getByTestId('descuentos-section')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Documentos' }));
        expect(screen.getByTestId('documentos-section')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Historial' }));
        expect(screen.getByTestId('historial-section')).toBeInTheDocument();
    });

    it('no muestra las pestañas de Descuentos/Documentos/Historial mientras el empleado se está creando (sin id todavía)', () => {
        setManagementState({ isEditing: false, formData: makeFormData({ id: undefined }) });
        renderView('nuevo');

        expect(screen.getByRole('button', { name: 'Datos Personales' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cargo y Remuneración' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Descuentos' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Documentos' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Historial' })).not.toBeInTheDocument();
    });
});
