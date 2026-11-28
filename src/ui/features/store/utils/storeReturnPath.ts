import { ROUTES, isStorePath } from '../../../../config/storePaths';

/**
 * Destino tras el login de tienda: la ruta pedida (`location.state.from`, la deja `StoreAuthGuard`)
 * solo si es una ruta INTERNA de la tienda distinta del propio login. Cualquier otra (admin, externa,
 * `//host`) se ignora: devuelve `null` y el usuario se queda en su cuenta.
 */
export const resolveStoreReturnPath = (state: unknown): string | null => {
    const from = (state as { from?: unknown } | null | undefined)?.from;
    if (!from || typeof from !== 'object') return null;
    const { pathname, search = '', hash = '' } = from as { pathname?: unknown; search?: unknown; hash?: unknown };
    if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) return null;
    if (!isStorePath(pathname) || pathname === ROUTES.ACCOUNT) return null;
    return `${pathname}${typeof search === 'string' ? search : ''}${typeof hash === 'string' ? hash : ''}`;
};
