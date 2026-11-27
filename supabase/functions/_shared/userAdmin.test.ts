import { describe, it, expect, vi } from 'vitest';
import { buildInvitePayload } from './invitePayload.ts';
import { inviteWithInvitation, revokeUserSessions, type AdminLike } from './userAdmin.ts';

const TENANT = 'aaaaaaaa-0000-0000-0000-00000000000a';
const NONCE = '99999999-0000-0000-0000-000000000001';

/** Cliente admin falso: registra el orden de las llamadas para verificar "invitacion ANTES de invitar". */
function makeAdmin(opts: {
    insertError?: unknown;
    inviteResult?: { data: { user: { id: string } | null }; error: { message: string; status?: number } | null };
    updateError?: { message: string } | null;
    rpcResult?: { data: unknown; error: unknown };
} = {}) {
    const calls: string[] = [];
    const deletedIds: string[] = [];
    let insertedRow: Record<string, unknown> | null = null;

    const inviteUserByEmail = vi.fn(async (email: string, o: { data: Record<string, unknown>; redirectTo?: string }) => {
        calls.push('invite');
        void email; void o;
        return opts.inviteResult ?? { data: { user: { id: 'user-1' } }, error: null };
    });
    const updateUserById = vi.fn(async (id: string, attrs: Record<string, unknown>) => {
        calls.push('updateUserById');
        void id; void attrs;
        return { error: opts.updateError ?? null };
    });
    const signOut = vi.fn(async () => ({ data: null, error: null }));

    const admin = {
        from: vi.fn((table: string) => {
            expect(table).toBe('staff_invitations');
            return {
                insert: (row: Record<string, unknown>) => {
                    calls.push('insert_invitation');
                    insertedRow = row;
                    return {
                        select: () => ({
                            single: async () =>
                                opts.insertError
                                    ? { data: null, error: opts.insertError }
                                    : { data: { id: 'inv-1', nonce: NONCE }, error: null },
                        }),
                    };
                },
                delete: () => ({
                    eq: async (_col: string, id: string) => {
                        calls.push('delete_invitation');
                        deletedIds.push(id);
                        return { error: null };
                    },
                }),
            };
        }),
        auth: { admin: { inviteUserByEmail, updateUserById, signOut } },
        rpc: vi.fn(async () => opts.rpcResult ?? { data: 3, error: null }),
    } as unknown as AdminLike;

    return { admin, calls, deletedIds, inviteUserByEmail, updateUserById, signOut, getInserted: () => insertedRow };
}

const built = () => buildInvitePayload({ email: 'ana@demo.com', fullName: 'Ana', roles: ['vendedor'], tenantId: TENANT, createdBy: 'caller' });

describe('inviteWithInvitation', () => {
    it('inserta la invitacion ANTES de invitar y pasa el nonce en la metadata (sin roles/tenant)', async () => {
        const t = makeAdmin();

        const res = await inviteWithInvitation(t.admin, built());

        expect(t.calls.slice(0, 2)).toEqual(['insert_invitation', 'invite']);
        expect(t.getInserted()).toMatchObject({ email: 'ana@demo.com', roles: ['vendedor'], tenant_id: TENANT });
        const [email, options] = t.inviteUserByEmail.mock.calls[0];
        expect(email).toBe('ana@demo.com');
        expect(options.data).toEqual({ full_name: 'Ana', needs_password_change: true, invitation_nonce: NONCE });
        expect(res.user.id).toBe('user-1');
        expect(res.invitationId).toBe('inv-1');
    });

    it('despues de invitar escribe app_metadata (tenant_id, roles) en el usuario', async () => {
        const t = makeAdmin();

        const res = await inviteWithInvitation(t.admin, built());

        expect(t.updateUserById).toHaveBeenCalledWith('user-1', { app_metadata: { tenant_id: TENANT, roles: ['vendedor'] } });
        expect(res.appMetadataSynced).toBe(true);
    });

    it('si falla updateUserById NO falla la invitacion (el trigger ya sincroniza) y lo reporta', async () => {
        const t = makeAdmin({ updateError: { message: 'x' } });

        const res = await inviteWithInvitation(t.admin, built());

        expect(res.appMetadataSynced).toBe(false);
        expect(t.deletedIds).toEqual([]);
    });

    it('si inviteUserByEmail falla, LIMPIA la invitacion y relanza el MISMO error (el llamador inspecciona el 422)', async () => {
        const err = { message: 'User already registered', status: 422 };
        const t = makeAdmin({ inviteResult: { data: { user: null }, error: err } });

        await expect(inviteWithInvitation(t.admin, built())).rejects.toBe(err);

        expect(t.deletedIds).toEqual(['inv-1']);
        expect(t.updateUserById).not.toHaveBeenCalled();
    });

    it('si la invitacion no devuelve usuario, limpia y falla', async () => {
        const t = makeAdmin({ inviteResult: { data: { user: null }, error: null } });

        await expect(inviteWithInvitation(t.admin, built())).rejects.toThrow('invite_no_user');

        expect(t.deletedIds).toEqual(['inv-1']);
    });

    it('si no se puede insertar la invitacion, no invita a nadie', async () => {
        const dbErr = { message: 'insert failed' };
        const t = makeAdmin({ insertError: dbErr });

        await expect(inviteWithInvitation(t.admin, built())).rejects.toBe(dbErr);

        expect(t.inviteUserByEmail).not.toHaveBeenCalled();
    });

    it('un reintento (delete-then-invite) crea una invitacion NUEVA cada vez', async () => {
        const t = makeAdmin();
        await inviteWithInvitation(t.admin, built());
        await inviteWithInvitation(t.admin, built());

        expect(t.calls.filter(c => c === 'insert_invitation')).toHaveLength(2);
    });
});

describe('revokeUserSessions (TOGGLE_ACTIVE)', () => {
    it('usa el RPC revoke_user_sessions con el id del usuario', async () => {
        const t = makeAdmin({ rpcResult: { data: 3, error: null } });

        const res = await revokeUserSessions(t.admin, 'user-9');

        expect(t.admin.rpc).toHaveBeenCalledWith('revoke_user_sessions', { p_user_id: 'user-9' });
        expect(res).toEqual({ ok: true, revoked: 3 });
    });

    it('NUNCA llama auth.admin.signOut con un user id (la API de supabase-js espera un JWT)', async () => {
        const t = makeAdmin();

        await revokeUserSessions(t.admin, 'user-9');

        expect(t.signOut).not.toHaveBeenCalled();
    });

    it('si el RPC falla (p. ej. 0c aun no aplicada) devuelve ok:false sin lanzar', async () => {
        const t = makeAdmin({ rpcResult: { data: null, error: { message: 'function not found' } } });

        const res = await revokeUserSessions(t.admin, 'user-9');

        expect(res).toEqual({ ok: false, error: 'function not found' });
    });
});
