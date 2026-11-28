/** Cada cuanto se pregunta al servidor si hay un Service Worker nuevo (pestanas abiertas por horas). */
export const SW_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Dispara `registration.update()` periodicamente y al volver a la pestana (visibilitychange).
 * El navegador solo chequea sw.js en navegaciones; sin esto una pestana larga nunca se entera.
 * Si hay nuevo SW, vite-plugin-pwa (autoUpdate) lo activa (skipWaiting + clientsClaim) y recarga
 * UNA vez al evento `activated` con isUpdate: no hay forma de loop, cada recarga consume una activacion.
 * Devuelve la funcion de limpieza.
 */
export function setupSwUpdateChecks(
    registration: Pick<ServiceWorkerRegistration, 'update'> | undefined,
    intervalMs: number = SW_UPDATE_INTERVAL_MS,
): () => void {
    if (!registration) return () => { };

    const check = () => {
        if (!navigator.onLine) return;
        registration.update().catch(() => { /* sin red / sw.js inalcanzable: se reintenta luego */ });
    };
    const onVisibility = () => {
        if (document.visibilityState === 'visible') check();
    };

    const id = window.setInterval(check, intervalMs);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
        window.clearInterval(id);
        document.removeEventListener('visibilitychange', onVisibility);
    };
}
