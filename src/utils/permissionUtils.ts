import { ROLES } from '../config/constants';

/**
 * CA1: Lógica de permisos (US-NFR-02)
 * Extraída a utilidades puras para facilitar el testeo unitario.
 */
export const checkPermissions = (role?: string) => {
    const isAdmin = role === ROLES.ADMIN;
    const isSupervisor = role === ROLES.SUPERVISOR;
    const isVendedor = role === ROLES.VENDEDOR;
    const isDespachador = role === ROLES.DESPACHADOR;

    const canAssignSeller = isAdmin || isSupervisor;
    const canManageInventory = isAdmin || isSupervisor || isDespachador;
    const canManageTeam = isAdmin || isSupervisor;

    return {
        isAdmin,
        isSupervisor,
        isVendedor,
        isDespachador,
        canAssignSeller,
        canManageInventory,
        canManageTeam
    };
};

/**
 * CA4 / CA5 (US-ROL-03): Jerarquía de roles para anti-escalación.
 * ADMIN (100) > SUPERVISOR (50) > OTROS (10)
 */
export const ROLE_RANK: Record<string, number> = {
    [ROLES.ADMIN]: 100,
    [ROLES.SUPERVISOR]: 50,
    [ROLES.VENDEDOR]: 10,
    [ROLES.DESPACHADOR]: 10,
};

export const canAssignRole = (myRole: string | undefined, targetRole: string | string[]): boolean => {
    const myRank = ROLE_RANK[myRole || ''] || 0;

    // Si el objetivo es un array de roles (múltiples roles), verificamos que ninguno sea mayor al propio
    const targetRoles = Array.isArray(targetRole) ? targetRole : [targetRole];

    for (const role of targetRoles) {
        const targetRank = ROLE_RANK[role] || 0;
        if (targetRank > myRank) return false;
    }

    return true;
};
