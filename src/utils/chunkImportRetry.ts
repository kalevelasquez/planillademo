import { Logger } from './logger';
import { showGlobalToast } from '../context/ToastContext';

/**
 * Flag usado por `lazyWithRetry` (App.tsx) para las vistas cargadas con React.lazy — un solo
 * reload automático por sesión ante un chunk fallido durante la navegación. `importWithRetry`
 * (más abajo) NO usa este flag: nunca recarga solo, así que no tiene el mismo riesgo de loop.
 */
export const FORCE_REFRESH_FLAG = 'page-has-been-force-refreshed';

/**
 * Reintenta un `import()` dinámico y, si falla (típicamente un chunk stale tras un deploy
 * nuevo — el archivo con ese hash ya no existe porque se publicó una versión más nueva mientras
 * la pestaña seguía abierta), avisa al usuario en vez de recargar en silencio como hacía antes.
 *
 * A diferencia de `lazyWithRetry` (que sí recarga automático una vez, porque ahí el fallo
 * ocurre cargando una VISTA completa vía Suspense/ErrorBoundary — ver comentario en App.tsx),
 * acá el fallo ocurre en medio de una acción puntual del usuario (ej. generar un reporte Word)
 * disparada desde un botón, no durante la navegación — recargar sin avisar arriesga perder
 * cualquier otro trabajo sin guardar que tuviera abierto en otra pantalla. Por eso se usa el
 * mismo patrón de "aviso con botón de acción" que ya usa `ReloadPrompt.tsx` para actualizaciones
 * del Service Worker, en vez de forzar la recarga.
 *
 * Re-lanza el error original después de avisar, para que el caller (ej. el catch del modal que
 * generaba el reporte) también actualice su propio estado de carga/error normalmente.
 */
export async function importWithRetry<T>(importFn: () => Promise<T>, contexto: string): Promise<T> {
    try {
        return await importFn();
    } catch (error) {
        Logger.error(`Fallo al cargar ${contexto} (ChunkLoadError)`, { path: window.location.pathname }, error);

        showGlobalToast(
            'Hay una versión más nueva de la aplicación disponible. Guardá cualquier trabajo pendiente en otra pantalla y hacé clic para actualizar.',
            'warning',
            { label: 'Actualizar ahora', onClick: () => window.location.reload() },
        );

        throw error;
    }
}
