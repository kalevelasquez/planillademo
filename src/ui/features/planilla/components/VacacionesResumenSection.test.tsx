import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { VacacionesResumenSection } from './VacacionesResumenSection';
import { vacacionesService, type Vacacion } from '../../../../services/vacacionesService';

vi.mock('../../../../services/vacacionesService', async () => {
    const actual = await vi.importActual<typeof import('../../../../services/vacacionesService')>(
        '../../../../services/vacacionesService'
    );
    return {
        ...actual,
        vacacionesService: {
            ...actual.vacacionesService,
            getPorEmpleado: vi.fn(),
        },
    };
});

const mockedGetPorEmpleado = vi.mocked(vacacionesService.getPorEmpleado);

function makeVacacion(overrides: Partial<Vacacion> = {}): Vacacion {
    return {
        id: '1', tenant_id: 't1', quincena_id: 'q1', empleado_id: 'e1',
        fecha_inicio: '2026-01-01', fecha_fin: '2026-01-05', dias: 5,
        sueldo_diario: 20, monto_base: 100, recargo_30: 30, monto_total: 130,
        conciliado: true, no_gozada: false,
        created_by: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
        ...overrides,
    };
}

describe('VacacionesResumenSection (IMPL-7)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('suma solo los días NO gozados=false (efectivamente descansados) para "Gozados"', async () => {
        mockedGetPorEmpleado.mockResolvedValue([
            makeVacacion({ dias: 5, no_gozada: false }),
            makeVacacion({ dias: 3, no_gozada: false }),
            makeVacacion({ dias: 10, no_gozada: true }), // pagada, no descansada — no debe sumar
        ]);

        render(<VacacionesResumenSection empleadoId="e1" fechaIngreso="2024-01-01" />);

        expect(await screen.findByText('8 días')).toBeInTheDocument();
    });

    it('calcula "Acumulados" a 15 días por año completo de servicio (IMPL-7, sin proporcional pendiente)', async () => {
        mockedGetPorEmpleado.mockResolvedValue([]);
        // fechaIngreso exactamente 3 años atrás de "hoy" → 3 años completos, 0 meses del año en curso.
        const hoy = new Date();
        const fechaIngreso = `${hoy.getFullYear() - 3}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

        render(<VacacionesResumenSection empleadoId="e1" fechaIngreso={fechaIngreso} />);

        await screen.findByText('0 días'); // espera a que resuelva "Gozados"
        expect(screen.getAllByText('45 días')).toHaveLength(2); // Acumulados = 15 × 3, Pendientes = 45 - 0 (coinciden)
    });

    it('resta lo gozado de lo acumulado para "Pendientes", mostrando el sobregiro en negativo (IMPL-179)', async () => {
        mockedGetPorEmpleado.mockResolvedValue([makeVacacion({ dias: 50, no_gozada: false })]);
        const hoy = new Date();
        const fechaIngreso = `${hoy.getFullYear() - 3}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;

        render(<VacacionesResumenSection empleadoId="e1" fechaIngreso={fechaIngreso} />);

        await screen.findByText('50 días'); // Gozados
        expect(screen.getByText('45 días')).toBeInTheDocument(); // Acumulados = 15 × 3
        // Bugfix real (IMPL-179): antes se truncaba a 0, ocultando el sobregiro real de -5 días.
        expect(screen.getByText('-5 días')).toBeInTheDocument();
    });
});
