// Logica PURA de invitaciones de personal (sin Deno ni supabase-js): se testea con vitest
// (supabase/functions/_shared/invitePayload.test.ts) y la usan las edge functions
// `manage-users` e `invite-employee`.
//
// Contexto de seguridad (change tienda-web-clientes, migraciones 0a/0b):
//   * `user_metadata` lo puede escribir CUALQUIERA con supabase.auth.updateUser()/signUp(),
//     asi que NUNCA lleva roles ni tenant_id.
//   * El alta interna se autoriza con una fila de `staff_invitations` (email + nonce secreto)
//     que escribe la edge function con service_role ANTES de invitar; el trigger handle_new_user
//     exige email + nonce y crea el perfil con los datos de ESA fila.
//   * `app_metadata` (solo escribible por el servidor) es lo que lee el JWT.

export interface InviteParams {
    email: string;
    fullName?: string | null;
    roles: unknown;
    tenantId: string;
    createdBy?: string | null;
    redirectTo?: string | null;
}

export interface InvitationRow {
    email: string;
    full_name: string | null;
    roles: string[];
    tenant_id: string;
    created_by: string | null;
}

export interface BuiltInvitePayload {
    /** Fila a insertar en staff_invitations (la BD genera el nonce). */
    invitationRow: InvitationRow;
    /** Claims a publicar en auth.users.raw_app_meta_data. */
    appMetadata: { tenant_id: string; roles: string[] };
    /** Opciones de inviteUserByEmail, una vez conocido el nonce. */
    inviteOptions: (nonce: string) => {
        data: { full_name: string; needs_password_change: true; invitation_nonce: string };
        redirectTo?: string;
    };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Aplana (string | string[] | anidados), baja a minusculas, recorta, quita vacios y duplicados. */
export function normalizeRoles(input: unknown): string[] {
    const out: string[] = [];
    const walk = (v: unknown) => {
        if (Array.isArray(v)) {
            v.forEach(walk);
        } else if (typeof v === 'string') {
            const r = v.toLowerCase().trim();
            if (r && !out.includes(r)) out.push(r);
        }
    };
    walk(input);
    return out;
}

/** El perfil guarda `role` como text[]: comparar el array con un string siempre daba false. */
export function isAdminOrSupervisor(roles: unknown): boolean {
    const r = normalizeRoles(roles);
    return r.includes('admin') || r.includes('supervisor');
}

/** Anti-escalacion: solo un admin puede asignar el rol admin. */
export function canAssignRoles(callerRoles: unknown, targetRoles: unknown): boolean {
    const target = normalizeRoles(targetRoles);
    if (target.includes('admin')) {
        return normalizeRoles(callerRoles).includes('admin');
    }
    return true;
}

export function buildInvitePayload(p: InviteParams): BuiltInvitePayload {
    const email = String(p.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) throw new Error('invalid_email');

    const roles = normalizeRoles(p.roles);
    if (roles.length === 0) throw new Error('roles_required');

    const tenantId = String(p.tenantId ?? '').trim();
    if (!tenantId) throw new Error('tenant_required');

    const fullName = String(p.fullName ?? '').trim();
    const redirectTo = p.redirectTo ? String(p.redirectTo) : null;

    return {
        invitationRow: {
            email,
            full_name: fullName || null,
            roles,
            tenant_id: tenantId,
            created_by: p.createdBy ?? null,
        },
        appMetadata: { tenant_id: tenantId, roles },
        inviteOptions: (nonce: string) => {
            if (!nonce || !String(nonce).trim()) throw new Error('nonce_required');
            return {
                // Sin roles ni tenant_id: la metadata de usuario no es de fiar.
                data: { full_name: fullName, needs_password_change: true, invitation_nonce: String(nonce) },
                ...(redirectTo ? { redirectTo } : {}),
            };
        },
    };
}
