import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('../../../../config/supabaseClient', () => ({ supabase: { auth: { getSession } } }));

import { useStaffSession } from './useStaffSession';

beforeEach(() => vi.clearAllMocks());

describe('useStaffSession (solo lectura local de la sesion admin, sin bootstrap)', () => {
    it('false mientras resuelve y true si hay sesion', async () => {
        getSession.mockResolvedValue({ data: { session: { user: { id: 'u' } } } });
        const { result } = renderHook(() => useStaffSession());
        expect(result.current).toBe(false);
        await waitFor(() => expect(result.current).toBe(true));
    });

    it('false si no hay sesion', async () => {
        getSession.mockResolvedValue({ data: { session: null } });
        const { result } = renderHook(() => useStaffSession());
        await waitFor(() => expect(getSession).toHaveBeenCalled());
        expect(result.current).toBe(false);
    });

    it('false si getSession falla (nunca rompe la landing)', async () => {
        getSession.mockRejectedValue(new Error('boom'));
        const { result } = renderHook(() => useStaffSession());
        await waitFor(() => expect(getSession).toHaveBeenCalled());
        expect(result.current).toBe(false);
    });
});
