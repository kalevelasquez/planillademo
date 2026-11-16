import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';
import type { PlanillaOutletContext } from './PlanillaLayout';

import { BonificacionesView } from './BonificacionesView';
import { ToastProvider } from '../../../context/ToastContext';
import { useAuthStore } from '../../../store/authStore';
import { useQuincenasStore } from '../../../store/quincenasStore';
import { planillaEmpleadosService } from '../../../services/planillaEmpleadosService';
import { bonificacionTiposService } from '../../../services/bonificacionTiposService';
import { bonificacionesService } from '../../../services/bonificacionesService';
import { tablasIncentivosService } from '../../../services/tablasIncentivosService';
import type { Quincena } from '../../../services/quincenasService';

vi.mock('../../../store/authStore', () => ({ useAuthStore: vi.fn() }));
vi.mock('../../../store/quincenasStore', () => ({ useQuincenasStore: vi.fn() }));

vi.mock('../../../services/planillaEmpleadosService', async () => {
    const actual = await vi.importActual<typeof import('../../../services/planillaEmpleadosService')>(
        '../../../services/planillaEmpleadosService'
    );
    return { ...actual, planillaEmpleadosService: { ...actual.planillaEmpleadosService, getEmpleadosActivos: vi.fn() } };
});

vi.mock('../../../services/bonificacionTiposService', async () => {
    const actual = await vi.importActual<typeof import('../../../services/bonificacionTiposService')>(
        '../../../services/bonificacionTiposService'
    );
    return { ...actual, bonificacionTiposService: { ...actual.bonificacionTiposService, getActivos: vi.fn() } };
});

vi.mock('../../../services/bonificacionesService', async () => {
    const actual = await vi.importActual<typeof import('../../../services/bonificacionesService')>(
        '../../../services/bonificacionesService'
    );
    return {
        ...actual,
        bonificacionesService: {
            ...actual.bonificacionesService,
            getPorQuincena: vi.fn(),
            calcularAutomaticos: vi.fn(),
        },
    };
});

vi.mock('../../../services/tablasIncentivosService', async () => {
    const actual = await vi.importActual<typeof import('../../../services/tablasIncentivosService')>(
        '../../../services/tablasIncentivosService'
    );
    return { ...actual, tablasIncentivosService: { ...actual.tablasIncentivosService, getTodas: vi.fn() } };
});

const mockedUseAuthStore = vi.mocked(useAuthStore);
const mockedUseQuincenasStore = vi.mocked(useQuincenasStore);
const mockedGetEmpleadosActivos = vi.mocked(planillaEmpleadosService.getEmpleadosActivos);
const mockedGetTiposActivos = vi.mocked(bonificacionTiposService.getActivos);
const mockedGetPorQuincena = vi.mocked(bonificacionesService.getPorQuincena);
const mockedCalcularAutomaticos = vi.mocked(bonificacionesService.calcularAutomaticos);
const mockedGetTablasIncentivos = vi.mocked(tablasIncentivosService.getTodas);

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

function renderView(quincena: Quincena) {
    mockedUseQuincenasStore.mockReturnValue({ quincenas: [quincena], isLoading: false, error: null, fetchQuincenas: vi.fn(), addQuincena: vi.fn() } as never);
    const outletContext: PlanillaOutletContext = {
        quincenaId: quincena.id,
        quincena,
        quincenaLabel: quincena.etiqueta_estandar,
        quincenaCerrada: quincena.estado === 'aprobada_cerrada',
    };
    return render(
        <MemoryRouter initialEntries={['/planilla/bonificaciones']}>
            <ToastProvider>
                <Routes>
                    <Route path="/planilla/bonificaciones" element={<Outlet context={outletContext} />}>
                        <Route index element={<BonificacionesView />} />
                    </Route>
                </Routes>
            </ToastProvider>
        </MemoryRouter>
    );
}

describe('BonificacionesView — timing del bono automático (IMPL-74 CA3, "2ª quincena del mes")', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedUseAuthStore.mockReturnValue({ profile: { tenant_id: 't1', id: 'u1' } } as never);
        mockedGetEmpleadosActivos.mockResolvedValue([]);
        mockedGetTiposActivos.mockResolvedValue([]);
        mockedGetPorQuincena.mockResolvedValue([]);
        mockedCalcularAutomaticos.mockResolvedValue([]);
        mockedGetTablasIncentivos.mockResolvedValue([]);
    });

    it('habilita "Calcular bonos" sin advertencia en la 2ª quincena de un mes normal (día 16 de inicio)', async () => {
        renderView(makeQuincena({ tipo: 'normal', fecha_inicio: '2026-07-16', fecha_fin: '2026-07-31' }));

        expect(await screen.findByRole('button', { name: /calcular bonos/i })).not.toBeDisabled();
        expect(screen.queryByText(/solo aplica a la 2ª quincena/)).not.toBeInTheDocument();
    });

    it('deshabilita "Calcular bonos" y muestra la advertencia en la 1ª quincena de un mes normal (día 1 de inicio)', async () => {
        renderView(makeQuincena({ tipo: 'normal', fecha_inicio: '2026-07-01', fecha_fin: '2026-07-15' }));

        expect(await screen.findByRole('button', { name: /calcular bonos/i })).toBeDisabled();
        expect(screen.getByText(/solo aplica a la 2ª quincena/)).toBeInTheDocument();
    });

    it('deshabilita "Calcular bonos" en una quincena_25, aunque su fecha de inicio caiga el día 16', async () => {
        renderView(makeQuincena({ tipo: 'quincena_25', fecha_inicio: '2027-01-16', fecha_fin: '2027-01-31' }));

        expect(await screen.findByRole('button', { name: /calcular bonos/i })).toBeDisabled();
        expect(screen.getByText(/solo aplica a la 2ª quincena/)).toBeInTheDocument();
    });

    it('deshabilita "Calcular bonos" en un aguinaldo', async () => {
        renderView(makeQuincena({ tipo: 'aguinaldo', fecha_inicio: '2026-12-01', fecha_fin: '2026-12-31' }));

        expect(await screen.findByRole('button', { name: /calcular bonos/i })).toBeDisabled();
        expect(screen.getByText(/solo aplica a la 2ª quincena/)).toBeInTheDocument();
    });
});
