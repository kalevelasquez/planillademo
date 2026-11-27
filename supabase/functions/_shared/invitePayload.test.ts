import { describe, it, expect } from 'vitest';
import { normalizeRoles, isAdminOrSupervisor, canAssignRoles, buildInvitePayload } from './invitePayload.ts';

const TENANT = 'aaaaaaaa-0000-0000-0000-00000000000a';

describe('normalizeRoles', () => {
    it('acepta array, string y valores anidados; baja a minusculas, recorta y deduplica', () => {
        expect(normalizeRoles(['Admin', ' vendedor ', 'admin'])).toEqual(['admin', 'vendedor']);
        expect(normalizeRoles('Supervisor')).toEqual(['supervisor']);
        expect(normalizeRoles([['admin'], ['vendedor', ['despachador']]])).toEqual(['admin', 'vendedor', 'despachador']);
    });

    it('descarta vacios, nulos y no-strings', () => {
        expect(normalizeRoles(['', '  ', null, undefined, 7, {}, 'admin'])).toEqual(['admin']);
        expect(normalizeRoles(null)).toEqual([]);
        expect(normalizeRoles(undefined)).toEqual([]);
        expect(normalizeRoles({ role: 'admin' })).toEqual([]);
    });
});

describe('isAdminOrSupervisor', () => {
    it('true con admin o supervisor (array o string)', () => {
        expect(isAdminOrSupervisor(['vendedor', 'supervisor'])).toBe(true);
        expect(isAdminOrSupervisor('admin')).toBe(true);
        expect(isAdminOrSupervisor(['ADMIN'])).toBe(true);
    });

    it('false sin esos roles (incluye el bug historico: array comparado con string)', () => {
        expect(isAdminOrSupervisor(['vendedor'])).toBe(false);
        expect(isAdminOrSupervisor([])).toBe(false);
        expect(isAdminOrSupervisor(null)).toBe(false);
    });
});

describe('canAssignRoles (anti-escalacion)', () => {
    it('solo un admin puede asignar el rol admin', () => {
        expect(canAssignRoles(['supervisor'], ['admin'])).toBe(false);
        expect(canAssignRoles(['admin'], ['admin', 'vendedor'])).toBe(true);
    });

    it('un supervisor puede asignar roles no-admin', () => {
        expect(canAssignRoles(['supervisor'], ['vendedor', 'despachador'])).toBe(true);
    });
});

describe('buildInvitePayload', () => {
    const base = { email: '  Ana@Demo.COM ', fullName: ' Ana Perez ', roles: ['Vendedor'], tenantId: TENANT, createdBy: 'caller-1' };

    it('arma la fila de staff_invitations normalizada (email en minusculas, roles normalizados, tenant del caller)', () => {
        const p = buildInvitePayload(base);
        expect(p.invitationRow).toEqual({
            email: 'ana@demo.com',
            full_name: 'Ana Perez',
            roles: ['vendedor'],
            tenant_id: TENANT,
            created_by: 'caller-1',
        });
    });

    it('app_metadata lleva tenant_id y roles (las claims que lee el JWT)', () => {
        expect(buildInvitePayload(base).appMetadata).toEqual({ tenant_id: TENANT, roles: ['vendedor'] });
    });

    it('user_metadata de la invitacion lleva el nonce y NUNCA roles ni tenant_id (la metadata la controla el usuario)', () => {
        const opts = buildInvitePayload(base).inviteOptions('11111111-2222-3333-4444-555555555555');
        expect(opts.data).toEqual({
            full_name: 'Ana Perez',
            needs_password_change: true,
            invitation_nonce: '11111111-2222-3333-4444-555555555555',
        });
        expect(Object.keys(opts.data)).not.toEqual(expect.arrayContaining(['tenant_id']));
        expect(Object.keys(opts.data)).not.toEqual(expect.arrayContaining(['roles']));
        expect(Object.keys(opts.data)).not.toEqual(expect.arrayContaining(['role']));
    });

    it('incluye redirectTo solo si se pasa', () => {
        expect(buildInvitePayload(base).inviteOptions('n1')).not.toHaveProperty('redirectTo');
        expect(buildInvitePayload({ ...base, redirectTo: 'https://x.test/login' }).inviteOptions('n1').redirectTo).toBe('https://x.test/login');
    });

    it('createdBy ausente => null', () => {
        const { createdBy: _omit, ...rest } = base;
        expect(buildInvitePayload(rest).invitationRow.created_by).toBeNull();
    });

    it('rechaza email invalido, sin roles y sin tenant', () => {
        expect(() => buildInvitePayload({ ...base, email: 'no-es-email' })).toThrow('invalid_email');
        expect(() => buildInvitePayload({ ...base, email: '' })).toThrow('invalid_email');
        expect(() => buildInvitePayload({ ...base, roles: [] })).toThrow('roles_required');
        expect(() => buildInvitePayload({ ...base, roles: ['  '] })).toThrow('roles_required');
        expect(() => buildInvitePayload({ ...base, tenantId: '' })).toThrow('tenant_required');
    });

    it('inviteOptions exige un nonce no vacio', () => {
        const p = buildInvitePayload(base);
        expect(() => p.inviteOptions('')).toThrow('nonce_required');
    });

    it('nombre vacio => full_name null en la fila y sin full_name en blanco en la metadata', () => {
        const p = buildInvitePayload({ ...base, fullName: '   ' });
        expect(p.invitationRow.full_name).toBeNull();
        expect(p.inviteOptions('n1').data.full_name).toBe('');
    });
});
