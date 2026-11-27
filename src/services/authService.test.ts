import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/supabaseClient', () => ({
    supabase: {
        auth: { getSession: vi.fn(), signOut: vi.fn(), getUser: vi.fn() },
        rpc: vi.fn(),
        from: vi.fn(),
    },
}));
vi.mock('../utils/logger', () => ({
    Logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { supabase } from '../config/supabaseClient';
import { authService } from './authService';

const mockedGetSession = vi.mocked(supabase.auth.getSession);
const mockedRpc = vi.mocked(supabase.rpc);
const mockedFrom = vi.mocked(supabase.from);

const session = { user: { id: 'u1', user_metadata: {} } };

beforeEach(() => {
    vi.clearAllMocks();
    mockedGetSession.mockResolvedValue({ data: { session }, error: null } as never);
});

describe('authService.getBootstrapData', () => {
    it('devuelve null si no hay sesion (no llama al RPC)', async () => {
        mockedGetSession.mockResolvedValue({ data: { session: null }, error: null } as never);

        await expect(authService.getBootstrapData()).resolves.toBeNull();
        expect(mockedRpc).not.toHaveBeenCalled();
    });

    it('devuelve null (explicito) si el RPC responde { error } porque el usuario no tiene perfil (cliente de tienda)', async () => {
        mockedRpc.mockResolvedValue({ data: { error: 'Profile not found' }, error: null } as never);

        await expect(authService.getBootstrapData()).resolves.toBeNull();
        // No debe caer al fallback tradicional (que consulta user_profiles) ni lanzar un TypeError accidental
        expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('devuelve null si el RPC responde sin data', async () => {
        mockedRpc.mockResolvedValue({ data: null, error: null } as never);

        await expect(authService.getBootstrapData()).resolves.toBeNull();
        expect(mockedFrom).not.toHaveBeenCalled();
    });

    it('devuelve null si el RPC responde sin profile', async () => {
        mockedRpc.mockResolvedValue({ data: { permissions: [], server_time: 'x' }, error: null } as never);

        await expect(authService.getBootstrapData()).resolves.toBeNull();
    });

    it('camino feliz: normaliza roles y devuelve perfil, permisos y sesion', async () => {
        mockedRpc.mockResolvedValue({
            data: {
                profile: { id: 'u1', tenant_id: 't1', roles: ['admin', 'supervisor'], full_name: 'Ana' },
                permissions: [{ resource: 'pedidos' }],
                server_time: '2026-11-27T00:00:00Z',
            },
            error: null,
        } as never);

        const res = await authService.getBootstrapData();

        expect(res).not.toBeNull();
        expect(res!.profile.role).toBe('admin');
        expect(res!.profile.roles).toEqual(['admin', 'supervisor']);
        expect(res!.permissions).toHaveLength(1);
        expect(res!.serverTime).toBe('2026-11-27T00:00:00Z');
    });

    it('si el RPC falla con error de transporte, intenta el fallback tradicional', async () => {
        mockedRpc.mockResolvedValue({ data: null, error: { message: 'boom' } } as never);
        const single = vi.fn().mockResolvedValue({ data: { id: 'u1', tenant_id: 't1', role: ['vendedor'] }, error: null });
        mockedFrom.mockReturnValue({ select: () => ({ eq: () => ({ single }) }) } as never);

        const res = await authService.getBootstrapData();

        expect(mockedFrom).toHaveBeenCalledWith('user_profiles');
        expect(res?.profile.role).toBe('vendedor');
    });
});
