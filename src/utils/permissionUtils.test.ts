import { describe, it, expect } from 'vitest';
import { checkPermissions, canAssignRole } from './permissionUtils';
import { ROLES } from '../config/constants';

describe('permissionUtils - Role Based Access Control (CA1)', () => {
    it('should grant full access to ADMIN', () => {
        const p = checkPermissions(ROLES.ADMIN);
        expect(p.isAdmin).toBe(true);
        expect(p.canManageTeam).toBe(true);
        expect(p.canAssignSeller).toBe(true);
        expect(p.canManageInventory).toBe(true);
    });

    it('should grant supervisor access to SUPERVISOR', () => {
        const p = checkPermissions(ROLES.SUPERVISOR);
        expect(p.isAdmin).toBe(false);
        expect(p.isSupervisor).toBe(true);
        expect(p.canManageTeam).toBe(true);
        expect(p.canAssignSeller).toBe(true);
        expect(p.canManageInventory).toBe(true);
    });

    it('should grant limited access to VENDEDOR', () => {
        const p = checkPermissions(ROLES.VENDEDOR);
        expect(p.isVendedor).toBe(true);
        expect(p.canManageTeam).toBe(false);
        expect(p.canAssignSeller).toBe(false);
        expect(p.canManageInventory).toBe(false);
    });

    it('should grant inventory access to DESPACHADOR', () => {
        const p = checkPermissions(ROLES.DESPACHADOR);
        expect(p.isDespachador).toBe(true);
        expect(p.canManageInventory).toBe(true);
        expect(p.canManageTeam).toBe(false);
        expect(p.canAssignSeller).toBe(false);
    });

    it('should handle undefined role safely', () => {
        const p = checkPermissions(undefined);
        expect(p.isAdmin).toBe(false);
        expect(p.canManageInventory).toBe(false);
    });

    describe('canAssignRole (US-ROL-03 CA4)', () => {
        it('should allow ADMIN to assign any role', () => {
            expect(canAssignRole(ROLES.ADMIN, ROLES.ADMIN)).toBe(true);
            expect(canAssignRole(ROLES.ADMIN, ROLES.SUPERVISOR)).toBe(true);
            expect(canAssignRole(ROLES.ADMIN, ROLES.VENDEDOR)).toBe(true);
        });

        it('should NOT allow SUPERVISOR to assign ADMIN', () => {
            expect(canAssignRole(ROLES.SUPERVISOR, ROLES.ADMIN)).toBe(false);
            expect(canAssignRole(ROLES.SUPERVISOR, ROLES.SUPERVISOR)).toBe(true);
            expect(canAssignRole(ROLES.SUPERVISOR, ROLES.VENDEDOR)).toBe(true);
        });

        it('should NOT allow VENDEDOR to assign SUPERVISOR or ADMIN', () => {
            expect(canAssignRole(ROLES.VENDEDOR, ROLES.ADMIN)).toBe(false);
            expect(canAssignRole(ROLES.VENDEDOR, ROLES.SUPERVISOR)).toBe(false);
            expect(canAssignRole(ROLES.VENDEDOR, ROLES.VENDEDOR)).toBe(true);
        });

        it('should handle multiple roles correctly', () => {
            // Un supervisor tratando de asignar un combo que incluye admin -> FALSE
            expect(canAssignRole(ROLES.SUPERVISOR, [ROLES.VENDEDOR, ROLES.ADMIN])).toBe(false);
            // Un supervisor tratando de asignar combo permitido -> TRUE
            expect(canAssignRole(ROLES.SUPERVISOR, [ROLES.VENDEDOR, ROLES.DESPACHADOR])).toBe(true);
        });
    });
});
