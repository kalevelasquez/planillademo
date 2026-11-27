/**
 * storePaths.ts
 * ─────────────────────────────────────────────────────────────────
 * Mapa de rutas de la SPA y helpers para distinguir el shell publico (tienda/cuenta)
 * del shell admin. Es la unica fuente de verdad de estas constantes.
 *
 *   /          landing (B4). Hasta entonces: gate interino (ver RootGate).
 *   /tienda/*  catalogo y carrito (shell publico)
 *   /cuenta/*  cuenta de cliente (shell publico, sesion propia)
 *   /inicio    dashboard admin (antes vivia en "/")
 *   resto      rutas admin, SIN cambios (no hay prefijo /app)
 */

export const ROUTES = {
    LANDING: '/',
    STORE: '/tienda',
    ACCOUNT: '/cuenta',
    ADMIN_HOME: '/inicio',
    LOGIN: '/login',
} as const;

const underPrefix = (pathname: string | null | undefined, prefix: string): boolean =>
    !!pathname && (pathname === prefix || pathname.startsWith(`${prefix}/`));

/**
 * `true` para `/tienda*` y `/cuenta*`. `"/"` queda FUERA a proposito: si Supabase cae al
 * Site URL con un token admin (invitacion/recovery) el cliente admin debe seguir capturandolo.
 */
export const isStorePath = (pathname?: string | null): boolean =>
    underPrefix(pathname, ROUTES.STORE) || underPrefix(pathname, ROUTES.ACCOUNT);

/** `true` solo para `/cuenta*`: unica zona donde el cliente de tienda captura tokens de la URL. */
export const isAccountPath = (pathname?: string | null): boolean => underPrefix(pathname, ROUTES.ACCOUNT);

// Rutas que no sirven como destino post-login (ciclicas, publicas o de otro shell).
const NON_RETURNABLE = new Set([
    '/',
    '/login',
    '/forgot-password',
    '/reset-password',
    '/setup-account',
    '/force-password-change',
]);

/**
 * Destino tras un login interno: la ruta que el usuario pidio (`location.state.from`, la deja
 * `ProtectedRoute`) o el dashboard `/inicio`. Solo acepta paths internos absolutos.
 */
export const resolvePostLoginPath = (state: unknown): string => {
    const from = (state as { from?: unknown } | null | undefined)?.from;
    if (!from || typeof from !== 'object') return ROUTES.ADMIN_HOME;

    const { pathname, search = '', hash = '' } = from as { pathname?: unknown; search?: unknown; hash?: unknown };
    if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) return ROUTES.ADMIN_HOME;
    if (NON_RETURNABLE.has(pathname) || isStorePath(pathname)) return ROUTES.ADMIN_HOME;

    return `${pathname}${typeof search === 'string' ? search : ''}${typeof hash === 'string' ? hash : ''}`;
};
