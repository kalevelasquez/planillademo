import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DocumentosSection } from './DocumentosSection';
import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { useAuthStore } from '../../../../store/authStore';

vi.mock('../../../../services/planillaEmpleadosService', async () => {
    const actual = await vi.importActual<typeof import('../../../../services/planillaEmpleadosService')>(
        '../../../../services/planillaEmpleadosService'
    );
    return {
        ...actual,
        planillaEmpleadosService: {
            ...actual.planillaEmpleadosService,
            getDocumentos: vi.fn(),
            uploadDocumento: vi.fn(),
        },
    };
});

vi.mock('../../../../store/authStore', () => ({
    useAuthStore: vi.fn(),
}));

const mockedGetDocumentos = vi.mocked(planillaEmpleadosService.getDocumentos);
const mockedUpload = vi.mocked(planillaEmpleadosService.uploadDocumento);
const mockedUseAuthStore = vi.mocked(useAuthStore);

function makeFile(name: string, type: string, sizeBytes: number): File {
    const file = new File(['x'.repeat(Math.min(sizeBytes, 1024))], name, { type });
    Object.defineProperty(file, 'size', { value: sizeBytes });
    return file;
}

describe('DocumentosSection (IMPL-6 gap #5 — validación de tamaño/tipo)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedGetDocumentos.mockResolvedValue([]);
        mockedUseAuthStore.mockReturnValue({ profile: { tenant_id: 't1', id: 'u1' } } as never);
    });

    it('rechaza un archivo de tipo no permitido sin llamar al servicio', async () => {
        // fireEvent (no userEvent.upload) a propósito: userEvent respeta el atributo
        // `accept` del input como lo haría un navegador real y ni deja "seleccionar" un
        // archivo fuera de la lista — pero un drag-and-drop puede saltarse ese filtro, que
        // es justo el caso que la validación del cliente cubre.
        render(<DocumentosSection empleadoId="e1" isReadOnly={false} />);

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const badFile = makeFile('nota.txt', 'text/plain', 1024);
        fireEvent.change(fileInput, { target: { files: [badFile] } });

        expect(await screen.findByText(/tipo de archivo no permitido/i)).toBeInTheDocument();
        expect(mockedUpload).not.toHaveBeenCalled();
    });

    it('rechaza un archivo que supera los 10 MB sin llamar al servicio', async () => {
        const user = userEvent.setup();
        render(<DocumentosSection empleadoId="e1" isReadOnly={false} />);

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const bigFile = makeFile('grande.pdf', 'application/pdf', 11 * 1024 * 1024);
        await user.upload(fileInput, bigFile);

        expect(await screen.findByText(/supera el tamaño máximo/i)).toBeInTheDocument();
        expect(mockedUpload).not.toHaveBeenCalled();
    });

    it('sube un archivo válido (PDF, dentro del límite) sin mostrar error', async () => {
        mockedUpload.mockResolvedValue({
            id: 'd1', tenant_id: 't1', empleado_id: 'e1', tipo: 'dui',
            storage_path: 't1/e1/x.pdf', nombre_archivo: 'valido.pdf',
            tamano_bytes: 1024, mime_type: 'application/pdf', origen: 'manual',
            uploaded_by: 'u1', created_at: '2026-01-01T00:00:00Z',
        });
        const user = userEvent.setup();
        render(<DocumentosSection empleadoId="e1" isReadOnly={false} />);

        const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
        const goodFile = makeFile('valido.pdf', 'application/pdf', 1024);
        await user.upload(fileInput, goodFile);

        await waitFor(() => expect(mockedUpload).toHaveBeenCalledWith('t1', 'e1', goodFile, 'dui', 'u1'));
        expect(screen.queryByText(/tipo de archivo no permitido/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/supera el tamaño máximo/i)).not.toBeInTheDocument();
    });
});
