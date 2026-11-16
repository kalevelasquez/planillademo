import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { IndemnizacionesSection } from './IndemnizacionesSection';
import { planillaEmpleadosService, type Indemnizacion } from '../../../../services/planillaEmpleadosService';

vi.mock('../../../../services/planillaEmpleadosService', async () => {
    const actual = await vi.importActual<typeof import('../../../../services/planillaEmpleadosService')>(
        '../../../../services/planillaEmpleadosService'
    );
    return {
        ...actual,
        planillaEmpleadosService: {
            ...actual.planillaEmpleadosService,
            getIndemnizaciones: vi.fn(),
            registrarIndemnizacion: vi.fn(),
        },
    };
});

const mockedGetIndemnizaciones = vi.mocked(planillaEmpleadosService.getIndemnizaciones);
const mockedRegistrar = vi.mocked(planillaEmpleadosService.registrarIndemnizacion);

function makeIndemnizacion(overrides: Partial<Indemnizacion> = {}): Indemnizacion {
    return {
        id: '1',
        tenant_id: 't1',
        empleado_id: 'e1',
        fecha: '2026-06-01',
        motivo: 'Motivo previo',
        created_at: '2026-06-01T00:00:00Z',
        ...overrides,
    };
}

/** IMPL-137 — el campo de fecha ya no es un <input type="date"> tipeable, es un botón que abre
 * un calendario propio (mask="date" de InputField, ver comentario ahí). Simula la interacción
 * real: abrir el calendario, navegar los meses que hagan falta desde "hoy", clickear el día. */
async function seleccionarFecha(user: ReturnType<typeof userEvent.setup>, labelText: string, isoDate: string) {
    await user.click(screen.getByLabelText(labelText));
    const [anio, mes, dia] = isoDate.split('-').map(Number);
    const ahora = new Date();
    let diffMeses = (anio - ahora.getFullYear()) * 12 + (mes - 1 - ahora.getMonth());
    const boton = diffMeses >= 0 ? 'Mes siguiente' : 'Mes anterior';
    for (let i = 0; i < Math.abs(diffMeses); i++) {
        await user.click(screen.getByRole('button', { name: boton }));
    }
    await user.click(screen.getByRole('button', { name: String(dia) }));
}

describe('IndemnizacionesSection (IMPL-5)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('muestra la advertencia cuando la fecha nueva no es posterior a la última indemnización', async () => {
        mockedGetIndemnizaciones.mockResolvedValue([makeIndemnizacion({ fecha: '2026-06-01' })]);
        const user = userEvent.setup();

        render(
            <IndemnizacionesSection
                empleadoId="e1"
                isReadOnly={false}
                fechaIngresoActual="2026-01-01"
                onRegistered={vi.fn()}
            />
        );

        await user.click(await screen.findByText('Registrar indemnización'));
        await seleccionarFecha(user, 'Fecha de la Indemnización', '2026-05-15'); // anterior a la última (2026-06-01)

        expect(await screen.findByText(/no es posterior a la indemnización más reciente/i)).toBeInTheDocument();
    });

    it('no muestra advertencia con una fecha posterior a la última indemnización', async () => {
        mockedGetIndemnizaciones.mockResolvedValue([makeIndemnizacion({ fecha: '2026-06-01' })]);
        const user = userEvent.setup();

        render(
            <IndemnizacionesSection
                empleadoId="e1"
                isReadOnly={false}
                fechaIngresoActual="2026-01-01"
                onRegistered={vi.fn()}
            />
        );

        await user.click(await screen.findByText('Registrar indemnización'));
        await seleccionarFecha(user, 'Fecha de la Indemnización', '2026-07-01');

        expect(screen.queryByText(/no es posterior a la indemnización más reciente/i)).not.toBeInTheDocument();
    });

    it('pide confirmación en un modal antes de registrar — no llama al servicio hasta confirmar', async () => {
        mockedGetIndemnizaciones.mockResolvedValue([]);
        mockedRegistrar.mockResolvedValue(makeIndemnizacion());
        const onRegistered = vi.fn();
        const user = userEvent.setup();

        render(
            <IndemnizacionesSection
                empleadoId="e1"
                isReadOnly={false}
                fechaIngresoActual="2026-01-01"
                onRegistered={onRegistered}
            />
        );

        await user.click(await screen.findByText('Registrar indemnización'));
        await seleccionarFecha(user, 'Fecha de la Indemnización', '2026-07-01');
        await user.click(screen.getByRole('button', { name: 'Confirmar' }));

        expect(await screen.findByText('¿Registrar esta indemnización?')).toBeInTheDocument();
        expect(mockedRegistrar).not.toHaveBeenCalled();

        // Con el modal abierto hay 2 botones "Confirmar" (el del form inline + el del modal) —
        // el del modal es el que se agrega último al DOM.
        const botonesConfirmar = screen.getAllByRole('button', { name: 'Confirmar' });
        await user.click(botonesConfirmar[botonesConfirmar.length - 1]);

        await waitFor(() => expect(mockedRegistrar).toHaveBeenCalledWith('e1', '2026-07-01', null));
        await waitFor(() => expect(onRegistered).toHaveBeenCalled());
    });
});
