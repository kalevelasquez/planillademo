import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/supabaseClient', () => ({
    supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn().mockResolvedValue({ data: null, error: null }) } },
}));

import { supabase } from '../config/supabaseClient';
import { quincenasService, getEstadoVisual, type Quincena } from './quincenasService';

const mockedRpc = vi.mocked(supabase.rpc);

function makeQuincena(overrides: Partial<Quincena> = {}): Quincena {
    return {
        id: 'q1',
        tenant_id: 't1',
        tipo: 'normal',
        nombre: '1ra Quincena de Enero 2026',
        etiqueta_estandar: '1ra Quincena Enero 2026',
        fecha_inicio: '2026-01-01',
        fecha_fin: '2026-01-15',
        dias_habiles: 11,
        estado: 'en_proceso',
        created_by: null,
        created_at: '2026-01-01T00:00:00Z',
        deleted_at: null,
        enviada_por: null,
        enviada_at: null,
        aprobada_por: null,
        aprobada_at: null,
        aprobada_comentario: null,
        rechazada_por: null,
        rechazada_at: null,
        rechazo_motivo: null,
        reabierta_por: null,
        reabierta_at: null,
        reapertura_motivo: null,
        es_prueba: false,
        ...overrides,
    };
}

beforeEach(() => {
    mockedRpc.mockReset();
});

describe('getEstadoVisual (US-CIE-01, IMPL-102 — colisión Rechazo/Reapertura)', () => {
    it('devuelve el estado real sin derivar nada cuando la quincena no está en_proceso', () => {
        expect(getEstadoVisual(makeQuincena({ estado: 'enviada_aprobacion' }))).toBe('enviada_aprobacion');
        expect(getEstadoVisual(makeQuincena({ estado: 'aprobada_cerrada' }))).toBe('aprobada_cerrada');
    });

    it('devuelve en_proceso cuando nunca fue rechazada ni reabierta', () => {
        expect(getEstadoVisual(makeQuincena())).toBe('en_proceso');
    });

    it('devuelve reabierta cuando solo tiene reabierta_at', () => {
        const quincena = makeQuincena({ reabierta_at: '2026-02-01T10:00:00Z' });
        expect(getEstadoVisual(quincena)).toBe('reabierta');
    });

    it('devuelve rechazada cuando solo tiene rechazada_at', () => {
        const quincena = makeQuincena({ rechazada_at: '2026-02-01T10:00:00Z' });
        expect(getEstadoVisual(quincena)).toBe('rechazada');
    });

    it('la marca de tiempo más reciente manda cuando tiene ambas: reabierta después de rechazada', () => {
        const quincena = makeQuincena({
            rechazada_at: '2026-02-01T10:00:00Z',
            reabierta_at: '2026-02-05T10:00:00Z',
        });
        expect(getEstadoVisual(quincena)).toBe('reabierta');
    });

    it('la marca de tiempo más reciente manda cuando tiene ambas: rechazada después de reabierta', () => {
        const quincena = makeQuincena({
            reabierta_at: '2026-02-01T10:00:00Z',
            rechazada_at: '2026-02-05T10:00:00Z',
        });
        expect(getEstadoVisual(quincena)).toBe('rechazada');
    });

    it('un empate exacto de timestamps favorece reabierta (>=)', () => {
        const mismoInstante = '2026-02-05T10:00:00Z';
        const quincena = makeQuincena({ reabierta_at: mismoInstante, rechazada_at: mismoInstante });
        expect(getEstadoVisual(quincena)).toBe('reabierta');
    });
});

describe('quincenasService.enviarAAprobacion (US-CIE-00, IMPL-103 CA1)', () => {
    it('llama al RPC enviar_a_aprobacion con el id de la quincena y devuelve la fila actualizada', async () => {
        const actualizada = makeQuincena({ estado: 'enviada_aprobacion', enviada_por: 'u1' });
        mockedRpc.mockResolvedValue({ data: actualizada, error: null } as never);

        const resultado = await quincenasService.enviarAAprobacion('q1');

        expect(mockedRpc).toHaveBeenCalledWith('enviar_a_aprobacion', { p_quincena_id: 'q1' });
        expect(resultado).toEqual(actualizada);
    });

    it('propaga el error del RPC (ej. checklist de módulos incompleto)', async () => {
        mockedRpc.mockResolvedValue({ data: null, error: new Error('Checklist incompleto') } as never);

        await expect(quincenasService.enviarAAprobacion('q1')).rejects.toThrow('Checklist incompleto');
    });
});

describe('quincenasService.aprobarYCerrar (US-CIE-00, IMPL-103 CA2/CA5)', () => {
    it('envía el comentario cuando se provee', async () => {
        const actualizada = makeQuincena({ estado: 'aprobada_cerrada' });
        mockedRpc.mockResolvedValue({ data: actualizada, error: null } as never);

        await quincenasService.aprobarYCerrar('q1', 'Todo en orden');

        expect(mockedRpc).toHaveBeenCalledWith('aprobar_y_cerrar_quincena', {
            p_quincena_id: 'q1',
            p_comentario: 'Todo en orden',
        });
    });

    it('envía null cuando el comentario es opcional y no se provee', async () => {
        mockedRpc.mockResolvedValue({ data: makeQuincena({ estado: 'aprobada_cerrada' }), error: null } as never);

        await quincenasService.aprobarYCerrar('q1');

        expect(mockedRpc).toHaveBeenCalledWith('aprobar_y_cerrar_quincena', {
            p_quincena_id: 'q1',
            p_comentario: null,
        });
    });

    it('propaga el error del RPC (ej. CA5, quien envió intenta aprobar)', async () => {
        mockedRpc.mockResolvedValue({ data: null, error: new Error('No puede aprobar quien envió a aprobación') } as never);

        await expect(quincenasService.aprobarYCerrar('q1')).rejects.toThrow('No puede aprobar quien envió a aprobación');
    });
});

describe('quincenasService.rechazar (US-CIE-00, IMPL-103 CA3)', () => {
    it('llama al RPC rechazar_quincena con el motivo obligatorio', async () => {
        const actualizada = makeQuincena({ rechazada_at: '2026-02-01T10:00:00Z' });
        mockedRpc.mockResolvedValue({ data: actualizada, error: null } as never);

        const resultado = await quincenasService.rechazar('q1', 'Faltan datos de Viáticos');

        expect(mockedRpc).toHaveBeenCalledWith('rechazar_quincena', {
            p_quincena_id: 'q1',
            p_motivo: 'Faltan datos de Viáticos',
        });
        expect(resultado).toEqual(actualizada);
    });

    it('propaga el error del RPC (ej. motivo vacío rechazado server-side)', async () => {
        mockedRpc.mockResolvedValue({ data: null, error: new Error('El motivo de rechazo es obligatorio.') } as never);

        await expect(quincenasService.rechazar('q1', '')).rejects.toThrow('El motivo de rechazo es obligatorio.');
    });
});

describe('quincenasService.reabrir (US-CIE-01, IMPL-104 CA4)', () => {
    it('llama al RPC reabrir_quincena con el motivo obligatorio', async () => {
        const actualizada = makeQuincena({ reabierta_at: '2026-02-05T10:00:00Z' });
        mockedRpc.mockResolvedValue({ data: actualizada, error: null } as never);

        const resultado = await quincenasService.reabrir('q1', 'Corrección solicitada por Contabilidad');

        expect(mockedRpc).toHaveBeenCalledWith('reabrir_quincena', {
            p_quincena_id: 'q1',
            p_motivo: 'Corrección solicitada por Contabilidad',
        });
        expect(resultado).toEqual(actualizada);
    });

    it('propaga el error del RPC (ej. quincena no está aprobada_cerrada)', async () => {
        mockedRpc.mockResolvedValue({ data: null, error: new Error('Solo se pueden re-abrir quincenas Aprobadas y Cerradas.') } as never);

        await expect(quincenasService.reabrir('q1', 'motivo')).rejects.toThrow('Solo se pueden re-abrir quincenas Aprobadas y Cerradas.');
    });
});
