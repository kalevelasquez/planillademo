import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import { HistorialCambiosSection } from './HistorialCambiosSection';
import { auditService, type AuditEntry } from '../../../../services/auditService';
import { useAuthStore } from '../../../../store/authStore';

vi.mock('../../../../services/auditService', async () => {
    const actual = await vi.importActual<typeof import('../../../../services/auditService')>(
        '../../../../services/auditService'
    );
    return {
        ...actual,
        auditService: {
            ...actual.auditService,
            getResourceHistory: vi.fn(),
            getDocumentosEliminados: vi.fn(),
        },
    };
});

vi.mock('../../../../store/authStore', () => ({
    useAuthStore: vi.fn(),
}));

const mockedGetResourceHistory = vi.mocked(auditService.getResourceHistory);
const mockedGetDocumentosEliminados = vi.mocked(auditService.getDocumentosEliminados);
const mockedUseAuthStore = vi.mocked(useAuthStore);

function makeEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
    return {
        id: 'a1',
        tenant_id: 't1',
        user_id: 'u1',
        user_email: 'preparador@imporfrut.com',
        action: 'UPDATE',
        resource_type: 'planilla_empleados',
        resource_id: 'e1',
        old_values: null,
        new_values: null,
        ip_address: null,
        user_agent: null,
        created_at: '2026-08-01T10:00:00Z',
        ...overrides,
    };
}

describe('HistorialCambiosSection (US-EMP-06, IMPL-8)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockedUseAuthStore.mockReturnValue({ profile: { tenant_id: 't1', id: 'u1' } } as never);
        mockedGetResourceHistory.mockResolvedValue([]);
        mockedGetDocumentosEliminados.mockResolvedValue([]);
    });

    it('muestra el estado vacío cuando no hay entradas de historial', async () => {
        render(<HistorialCambiosSection empleadoId="e1" />);

        expect(await screen.findByText('Este empleado no tiene cambios registrados todavía.')).toBeInTheDocument();
    });

    it('renderiza un cambio detectado con el valor sensible enmascarado, nunca en crudo (gap #4 — sin revelado)', async () => {
        mockedGetResourceHistory.mockResolvedValue([
            makeEntry({ old_values: { dui: '01234567-8' }, new_values: { dui: '09876543-2' } }),
        ]);

        render(<HistorialCambiosSection empleadoId="e1" />);

        expect(await screen.findByText('DUI:')).toBeInTheDocument();
        expect(screen.getByText('Personal')).toBeInTheDocument();
        expect(screen.queryByText('01234567-8')).not.toBeInTheDocument();
        expect(screen.queryByText('09876543-2')).not.toBeInTheDocument();
    });

    it('ignora un UPDATE de audit_log cuyos campos rastreados no cambiaron realmente', async () => {
        mockedGetResourceHistory.mockResolvedValue([
            makeEntry({ old_values: { nombre_completo: 'Juan Pérez' }, new_values: { nombre_completo: 'Juan Pérez' } }),
        ]);

        render(<HistorialCambiosSection empleadoId="e1" />);

        expect(await screen.findByText('Este empleado no tiene cambios registrados todavía.')).toBeInTheDocument();
    });

    it('renderiza un documento eliminado mezclado en la misma línea de tiempo (IMPL-125)', async () => {
        mockedGetDocumentosEliminados.mockResolvedValue([
            makeEntry({
                id: 'doc1',
                created_at: '2026-08-05T12:00:00Z',
                old_values: { nombre_archivo: 'dui_frente.pdf', tipo: 'dui' },
            }),
        ]);

        render(<HistorialCambiosSection empleadoId="e1" />);

        expect(await screen.findByText('Documento eliminado: dui_frente.pdf (DUI)')).toBeInTheDocument();
        expect(screen.getByText('Documentos')).toBeInTheDocument();
    });

    it('no consulta el servicio si todavía no hay tenant_id resuelto', () => {
        mockedUseAuthStore.mockReturnValue({ profile: null } as never);

        render(<HistorialCambiosSection empleadoId="e1" />);

        expect(mockedGetResourceHistory).not.toHaveBeenCalled();
        expect(mockedGetDocumentosEliminados).not.toHaveBeenCalled();
    });
});
