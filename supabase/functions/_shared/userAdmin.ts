// Orquestacion de altas/bajas de personal con el cliente admin (service_role) INYECTADO,
// para poder testearla con vitest sin red (supabase/functions/_shared/userAdmin.test.ts).
// La usan `manage-users` e `invite-employee`.

import type { BuiltInvitePayload } from './invitePayload.ts';

interface AuthErrorLike {
    message: string;
    status?: number;
}

/** Subconjunto estructural del cliente de supabase-js que usamos (evita importar supabase-js aqui). */
export interface AdminLike {
    // deno-lint-ignore no-explicit-any
    from(table: string): any;
    rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }>;
    auth: {
        admin: {
            inviteUserByEmail(
                email: string,
                options: { data: Record<string, unknown>; redirectTo?: string },
            ): Promise<{ data: { user: { id: string } | null }; error: AuthErrorLike | null }>;
            updateUserById(
                id: string,
                attrs: Record<string, unknown>,
            ): Promise<{ error: AuthErrorLike | null }>;
        };
    };
}

export interface InviteResult {
    user: { id: string };
    invitationId: string;
    /** false si updateUserById(app_metadata) fallo: el trigger sync_user_claims ya publico las claims. */
    appMetadataSynced: boolean;
}

async function deleteInvitation(admin: AdminLike, id: string): Promise<void> {
    try {
        await admin.from('staff_invitations').delete().eq('id', id);
    } catch (_e) {
        // best effort: la invitacion vence sola en 1 h
    }
}

/**
 * 1) inserta staff_invitations (la BD devuelve el nonce)  2) inviteUserByEmail con el nonce
 * 3) updateUserById(app_metadata). Si la invitacion falla, borra la fila y relanza el MISMO
 * error (el llamador puede inspeccionar `status === 422` para el flujo delete-then-invite).
 * Cada llamada crea una invitacion NUEVA (los reintentos no reutilizan nonces).
 */
export async function inviteWithInvitation(admin: AdminLike, built: BuiltInvitePayload): Promise<InviteResult> {
    const { data: inv, error: insertError } = await admin
        .from('staff_invitations')
        .insert(built.invitationRow)
        .select('id, nonce')
        .single();

    if (insertError || !inv) throw insertError ?? new Error('invitation_insert_failed');

    const { data, error } = await admin.auth.admin.inviteUserByEmail(
        built.invitationRow.email,
        built.inviteOptions(String(inv.nonce)),
    );

    if (error) {
        await deleteInvitation(admin, inv.id);
        throw error;
    }
    if (!data?.user) {
        await deleteInvitation(admin, inv.id);
        throw new Error('invite_no_user');
    }

    // Redundante con el trigger sync_user_claims (lo pide el spec); no es fatal si falla.
    const { error: metaError } = await admin.auth.admin.updateUserById(data.user.id, {
        app_metadata: built.appMetadata,
    });

    return { user: data.user, invitationId: inv.id, appMetadataSynced: !metaError };
}

export type RevokeResult = { ok: true; revoked: number } | { ok: false; error: string };

/**
 * Cierra TODAS las sesiones de un usuario por id. `auth.admin.signOut(jwt, scope)` de
 * supabase-js recibe un JWT (no un user id), asi que no sirve para esto: se usa el RPC
 * `revoke_user_sessions` (migracion 0c, solo service_role).
 */
export async function revokeUserSessions(admin: AdminLike, userId: string): Promise<RevokeResult> {
    const { data, error } = await admin.rpc('revoke_user_sessions', { p_user_id: userId });
    if (error) return { ok: false, error: error.message };
    return { ok: true, revoked: Number(data ?? 0) };
}
