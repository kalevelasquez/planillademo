import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';

import { EmpleadosListView } from './EmpleadosListView';
import type { PlanillaOutletContext } from './PlanillaLayout';
import { usePlanillaEmpleadosStore } from '../../../store/planillaEmpleadosStore';
import { usePermission } from '../../../hooks/usePermission';
import type { Empleado, EmpleadosIndicadores } from '../../../services/planillaEmpleadosService';
import type { Permission } from '../../../services/permissionService';

vi.mock('../../../store/planillaEmpleadosStore', () => ({
    usePlanillaEmpleadosStore: vi.fn(),
}));

vi.mock('../../../hooks/usePermission', () => ({
    usePermission: vi.fn(),
}));

const mockedUseStore = vi.mocked(usePlanillaEmpleadosStore);
const mockedUsePermission = vi.mocked(usePermission);

function makeEmpleado(overrides: Partial<Empleado> = {}): Empleado {
    return {
        id: '1',
        tenant_id: 't1',
        codigo: 'EMP-2026-001',
        codigo_empleado_manual: null,
        nombre_completo: 'Juan Pérez',
        dui: null,
        nit: null,
        nup: null,
        pasaporte: null,
        fecha_nacimiento: null,
        sexo: null,
        telefono: '70000000',
        correo: null,
        direccion: null,
        contacto_emergencia_nombre: null,
        contacto_emergencia_telefono: null,
        cargo: 'Operario',
        departamento: 'Producción',
        sucursal: null,
        centro_costos: null,
        fecha_ingreso: '2026-01-01',
        sueldo_mensual: 500,
        tipo_afiliacion: null,
        numero_afiliacion_afp: null,
        numero_afiliado_isss: null,
        retencion_especial_viatico: false,
        es_gerente_general: false,
        banco: null,
        numero_cuenta: null,
        estado: 'activo',
        tipo_contrato: null,
        foto_url: null,
        codigo_reloj_marcador: null,
        ubicacion_id: null,
        created_at: '2026-01-01T00:00:00Z',
        deleted_at: null,
        ...overrides,
    };
}

function makeIndicadores(overrides: Partial<EmpleadosIndicadores> = {}): EmpleadosIndicadores {
    return { total: 10, activos: 8, inactivos: 2, nuevos: 3, ...overrides };
}

function makePermission(overrides: Partial<Permission> = {}): Permission {
    return {
        resource: 'planilla_empleados',
        can_view: true,
        can_create: true,
        can_edit: true,
        can_delete: true,
        can_export: true,
        can_approve: true,
        view_scope: 'all',
        edit_scope: 'all',
        delete_scope: 'all',
        ...overrides,
    };
}

function setStoreState(overrides: Record<string, unknown> = {}) {
    const state = {
        empleados: [],
        isLoading: false,
        hasMore: false,
        page: 1,
        totalCount: 0,
        totalPages: 1,
        indicadores: makeIndicadores(),
        indicadoresError: null,
        searchQuery: '',
        filters: {},
        fetchEmpleados: vi.fn(),
        fetchPage: vi.fn(),
        setFilters: vi.fn(),
        fetchIndicadores: vi.fn(),
        ...overrides,
    };
    // El selector real usa useShallow(state => ({...})) — acá alcanza con invocar el
    // selector recibido contra nuestro estado de mentira, sin reimplementar zustand.
    mockedUseStore.mockImplementation((selector: unknown) => (selector as (s: typeof state) => unknown)(state));
    return state;
}

function renderView() {
    const outletContext: PlanillaOutletContext = {
        quincenaId: '', quincena: null, quincenaLabel: '', quincenaCerrada: false,
    };
    return render(
        <MemoryRouter initialEntries={['/planilla/empleados']}>
            <Routes>
                <Route path="/planilla/empleados" element={<Outlet context={outletContext} />}>
                    <Route index element={<EmpleadosListView />} />
                </Route>
            </Routes>
        </MemoryRouter>
    );
}

describe('EmpleadosListView (IMPL-2)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedUsePermission.mockReturnValue(makePermission());
    });

    it('muestra los 4 indicadores con los valores reales del store', () => {
        setStoreState({ indicadores: makeIndicadores({ total: 42, activos: 30, inactivos: 12, nuevos: 5 }) });
        renderView();

        expect(screen.getByText('42')).toBeInTheDocument();
        expect(screen.getByText('30')).toBeInTheDocument();
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('muestra el botón "Nuevo empleado" cuando el usuario tiene permiso can_create', () => {
        setStoreState({ empleados: [makeEmpleado()] });
        mockedUsePermission.mockReturnValue(makePermission({ can_create: true }));
        renderView();

        expect(screen.getByText('Nuevo empleado')).toBeInTheDocument();
    });

    it('oculta el botón "Nuevo empleado" cuando el usuario NO tiene permiso can_create (IMPL-2 gap #4)', () => {
        setStoreState({ empleados: [makeEmpleado()] });
        mockedUsePermission.mockReturnValue(makePermission({ can_create: false }));
        renderView();

        expect(screen.queryByText('Nuevo empleado')).not.toBeInTheDocument();
    });

    it('muestra el estado vacío cuando no hay empleados', () => {
        setStoreState({ empleados: [] });
        renderView();

        expect(screen.getByText('Aún no hay empleados registrados')).toBeInTheDocument();
    });

    it('muestra el badge de departamento y el sueldo formateado de un empleado', () => {
        setStoreState({
            empleados: [makeEmpleado({ nombre_completo: 'Ana López', departamento: 'Ventas', sueldo_mensual: 1500 })],
        });
        renderView();

        expect(screen.getAllByText('Ventas').length).toBeGreaterThan(0);
        expect(screen.getByText('$1,500.00')).toBeInTheDocument();
    });
});
