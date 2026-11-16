import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import { DescuentosSection } from './DescuentosSection';
import { ToastProvider } from '../../../../context/ToastContext';
import { useAuthStore } from '../../../../store/authStore';
import { useQuincenasStore } from '../../../../store/quincenasStore';
import { descuentoCategoriasService, type DescuentoCategoria } from '../../../../services/descuentoCategoriasService';
import { descuentosService, type Descuento, type DescuentoEvento } from '../../../../services/descuentosService';

vi.mock('../../../../services/descuentoCategoriasService', async () => {
    const actual = await vi.importActual<typeof import('../../../../services/descuentoCategoriasService')>(
        '../../../../services/descuentoCategoriasService'
    );
    return {
        ...actual,
        descuentoCategoriasService: { ...actual.descuentoCategoriasService, getTodos: vi.fn() },
    };
});

vi.mock('../../../../services/descuentosService', async () => {
    const actual = await vi.importActual<typeof import('../../../../services/descuentosService')>(
        '../../../../services/descuentosService'
    );
    return {
        ...actual,
        descuentosService: {
            ...actual.descuentosService,
            getPorEmpleado: vi.fn(),
            getEventosPorDescuentos: vi.fn(),
            crear: vi.fn(),
            cambiarEstadoPausado: vi.fn(),
        },
    };
});

vi.mock('../../../../store/authStore', () => ({ useAuthStore: vi.fn() }));
vi.mock('../../../../store/quincenasStore', () => ({ useQuincenasStore: vi.fn() }));

const mockedGetTodos = vi.mocked(descuentoCategoriasService.getTodos);
const mockedGetPorEmpleado = vi.mocked(descuentosService.getPorEmpleado);
const mockedGetEventosPorDescuentos = vi.mocked(descuentosService.getEventosPorDescuentos);
const mockedCrear = vi.mocked(descuentosService.crear);
const mockedCambiarEstadoPausado = vi.mocked(descuentosService.cambiarEstadoPausado);
const mockedUseAuthStore = vi.mocked(useAuthStore);
const mockedUseQuincenasStore = vi.mocked(useQuincenasStore);

const CAT_PRESTAMO: DescuentoCategoria = { id: 'cat-prestamo', tenant_id: 't1', nombre: 'Préstamo bancario', tipo: 'fijo', activo: true, created_at: '', updated_at: '' };
const CAT_FINANCIERA: DescuentoCategoria = { id: 'cat-financiera', tenant_id: 't1', nombre: 'Financiera', tipo: 'fijo', activo: true, created_at: '', updated_at: '' };
const CAT_FALTANTE: DescuentoCategoria = { id: 'cat-faltante', tenant_id: 't1', nombre: 'Faltante de caja', tipo: 'variable', activo: true, created_at: '', updated_at: '' };

function makeDescuento(overrides: Partial<Descuento> = {}): Descuento {
    return {
        id: 'd1', tenant_id: 't1', empleado_id: 'e1', categoria_id: 'cat-financiera', codigo: 'DESC-0001',
        institucion: null, monto_quincenal: 30, monto_total: null, numero_cuotas: null,
        monto_pagado: 0, cuotas_pagadas: 0, fecha_fin: null, estado: 'activo', validado_at: null,
        created_by: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

function makeEvento(overrides: Partial<DescuentoEvento> = {}): DescuentoEvento {
    return {
        id: 'ev1', tenant_id: 't1', descuento_id: 'd1', quincena_id: 'q1', tipo: 'pago',
        monto: 30, motivo_suspension: null, registrado_por: 'u1', registrado_at: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

function renderSection(isReadOnly = false) {
    return render(
        <ToastProvider>
            <DescuentosSection empleadoId="e1" isReadOnly={isReadOnly} />
        </ToastProvider>
    );
}

// InputField/el <select> de categoría no usan htmlFor+id (el label no tiene `id` asociado),
// así que getByLabelText no los resuelve — se busca el <label> por texto (exact:false hace la
// búsqueda case-insensitive, por eso se filtra por tagName para no matchear texto suelto en
// options/párrafos que también contienen la palabra) y se toma el input/select hermano.
function getInputByLabel(text: string): HTMLInputElement {
    const label = screen.getAllByText(text, { exact: false }).find((el) => el.tagName === 'LABEL') as HTMLElement;
    return (label.parentElement as HTMLElement).querySelector('input, select') as HTMLInputElement;
}

describe('DescuentosSection (US-DESC-01 / IMPL-58)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedGetTodos.mockResolvedValue([CAT_PRESTAMO, CAT_FINANCIERA, CAT_FALTANTE]);
        mockedGetPorEmpleado.mockResolvedValue([]);
        mockedGetEventosPorDescuentos.mockResolvedValue([]);
        mockedUseAuthStore.mockReturnValue({ profile: { id: 'u1' } } as never);
        mockedUseQuincenasStore.mockReturnValue({ quincenas: [], fetchQuincenas: vi.fn() } as never);
    });

    it('muestra los sub-tabs Fijos/Variables/Historial y arranca en Fijos (CA1)', async () => {
        renderSection();
        await waitFor(() => expect(mockedGetTodos).toHaveBeenCalled());

        expect(screen.getByRole('button', { name: 'Fijos' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Variables' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Historial' })).toBeInTheDocument();
    });

    it('el formulario solo ofrece categorías del tipo activo (Fijos)', async () => {
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: '+ Agregar' }));

        const opciones = Array.from(getInputByLabel('Categoría').querySelectorAll('option')).map((o) => o.textContent);
        expect(opciones).toEqual(expect.arrayContaining(['Préstamo bancario', 'Financiera']));
        expect(opciones).not.toContain('Faltante de caja');
    });

    it('cambia a Variables y el formulario solo ofrece categorías variables', async () => {
        renderSection();
        await screen.findByRole('button', { name: 'Variables' });
        fireEvent.click(screen.getByRole('button', { name: 'Variables' }));
        fireEvent.click(screen.getByRole('button', { name: '+ Agregar' }));

        const opciones = Array.from(getInputByLabel('Categoría').querySelectorAll('option')).map((o) => o.textContent);
        expect(opciones).toContain('Faltante de caja');
        expect(opciones).not.toContain('Préstamo bancario');
    });

    it('selecciona "Préstamo bancario" y fuerza + bloquea "tiene cuotas" (CA2)', async () => {
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: '+ Agregar' }));

        fireEvent.change(getInputByLabel('Categoría'), { target: { value: 'cat-prestamo' } });

        // Primer checkbox del formulario = "tiene cuotas"; el saldo inicial ("ya pagaba") es un
        // segundo checkbox que solo aparece cuando tieneCuotas está activo, ver DescuentosSection.
        const checkbox = screen.getAllByRole('checkbox')[0] as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
        expect(checkbox.disabled).toBe(true);
        expect(screen.getByText(/nunca puede quedar indefinida/)).toBeInTheDocument();
    });

    it('guarda un descuento con monto quincenal cuando no tiene cuotas', async () => {
        mockedCrear.mockResolvedValue(makeDescuento({ id: 'd-new', categoria_id: 'cat-financiera', monto_quincenal: 45 }));
        renderSection();

        fireEvent.click(await screen.findByRole('button', { name: '+ Agregar' }));
        fireEvent.change(getInputByLabel('Categoría'), { target: { value: 'cat-financiera' } });
        fireEvent.change(getInputByLabel('Monto Quincenal'), { target: { value: '45' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

        await waitFor(() => expect(mockedCrear).toHaveBeenCalledWith({
            empleadoId: 'e1', categoriaId: 'cat-financiera', institucion: null,
            montoQuincenal: 45, montoTotal: null, numeroCuotas: null, userId: 'u1',
            fechaFin: null, cuotaExacta: null, montoPagadoInicial: 0, cuotasPagadasInicial: 0,
        }));
        expect(await screen.findByText('Descuento guardado correctamente.')).toBeInTheDocument();
    });

    it('guarda un descuento con monto total + número de cuotas para Préstamo bancario', async () => {
        mockedCrear.mockResolvedValue(makeDescuento({ id: 'd-new2', categoria_id: 'cat-prestamo', monto_total: 600, numero_cuotas: 12 }));
        renderSection();

        fireEvent.click(await screen.findByRole('button', { name: '+ Agregar' }));
        fireEvent.change(getInputByLabel('Categoría'), { target: { value: 'cat-prestamo' } });
        fireEvent.change(getInputByLabel('Monto Total'), { target: { value: '600' } });
        fireEvent.change(getInputByLabel('Número de Cuotas'), { target: { value: '12' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

        await waitFor(() => expect(mockedCrear).toHaveBeenCalledWith({
            empleadoId: 'e1', categoriaId: 'cat-prestamo', institucion: null,
            montoQuincenal: 0, montoTotal: 600, numeroCuotas: 12, userId: 'u1',
            fechaFin: null, cuotaExacta: null, montoPagadoInicial: 0, cuotasPagadasInicial: 0,
        }));
    });

    it('muestra error de validación si falta la categoría y no llama al servicio', async () => {
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: '+ Agregar' }));
        // Monto Quincenal es `required` a nivel HTML (bloquea el submit nativo antes de que
        // corra la validación propia) — se llena para aislar la validación de categoriaId,
        // que solo se chequea en JS porque el <select> no tiene `required`.
        fireEvent.change(getInputByLabel('Monto Quincenal'), { target: { value: '10' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));

        expect(await screen.findByText(/Complete categoría y el monto/)).toBeInTheDocument();
        expect(mockedCrear).not.toHaveBeenCalled();
    });

    it('togglea el estado Activo/Pausado de un descuento existente (CA4)', async () => {
        mockedGetPorEmpleado.mockResolvedValue([makeDescuento({ id: 'd1', categoria_id: 'cat-financiera', estado: 'activo' })]);
        mockedCambiarEstadoPausado.mockResolvedValue(makeDescuento({ id: 'd1', categoria_id: 'cat-financiera', estado: 'pausado' }));

        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: 'Activo' }));

        await waitFor(() => expect(mockedCambiarEstadoPausado).toHaveBeenCalledWith('d1', true));
        expect(await screen.findByRole('button', { name: 'Pausado' })).toBeInTheDocument();
    });

    it('calcula el Total Fijos/Quincena excluyendo los completados (CA5)', async () => {
        mockedGetPorEmpleado.mockResolvedValue([
            makeDescuento({ id: 'd1', categoria_id: 'cat-financiera', monto_quincenal: 50, estado: 'activo' }),
            makeDescuento({ id: 'd2', categoria_id: 'cat-prestamo', monto_quincenal: 30, estado: 'activo' }),
            makeDescuento({ id: 'd3', categoria_id: 'cat-financiera', monto_quincenal: 20, estado: 'completado' }),
        ]);

        renderSection();
        expect(await screen.findByText('Total Fijos / Quincena: $80.00')).toBeInTheDocument();
    });

    it('no muestra el Total Fijos/Quincena en el sub-tab Variables', async () => {
        mockedGetPorEmpleado.mockResolvedValue([makeDescuento({ id: 'd1', categoria_id: 'cat-faltante', monto_quincenal: 15 })]);
        renderSection();

        fireEvent.click(await screen.findByRole('button', { name: 'Variables' }));
        expect(screen.queryByText(/Total Fijos \/ Quincena/)).not.toBeInTheDocument();
    });

    it('el sub-tab Historial lista los eventos ordenados por fecha descendente', async () => {
        mockedGetPorEmpleado.mockResolvedValue([makeDescuento({ id: 'd1', categoria_id: 'cat-financiera' })]);
        mockedGetEventosPorDescuentos.mockResolvedValue([
            makeEvento({ id: 'ev1', tipo: 'pago', monto: 30, registrado_at: '2026-01-01T00:00:00Z' }),
            makeEvento({ id: 'ev2', tipo: 'suspension', monto: null, motivo_suspension: 'Vacaciones', registrado_at: '2026-02-01T00:00:00Z' }),
        ]);

        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: 'Historial' }));

        const items = await screen.findAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent('Suspendido'); // ev2 (feb) es más reciente que ev1 (ene)
        expect(items[1]).toHaveTextContent('$30.00');
    });

    it('muestra el estado vacío cuando no hay descuentos en la categoría activa', async () => {
        renderSection();
        expect(await screen.findByText('No hay descuentos registrados en esta categoría.')).toBeInTheDocument();
    });

    it('muestra el estado vacío del historial cuando no hay eventos', async () => {
        renderSection();
        fireEvent.click(await screen.findByRole('button', { name: 'Historial' }));
        expect(await screen.findByText('Todavía no hay cuotas ni suspensiones registradas para este empleado.')).toBeInTheDocument();
    });

    it('oculta el botón "+ Agregar" y el switch de estado cuando isReadOnly', async () => {
        mockedGetPorEmpleado.mockResolvedValue([makeDescuento({ id: 'd1', categoria_id: 'cat-financiera', estado: 'activo' })]);
        renderSection(true);

        await screen.findByText('Financiera');
        expect(screen.queryByRole('button', { name: '+ Agregar' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Activo' })).not.toBeInTheDocument();
    });
});
