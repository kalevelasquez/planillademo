import { lazy } from 'react';
import { Logger } from './logger';
import { FORCE_REFRESH_FLAG } from './chunkImportRetry';

/**
 * Utileria de resiliencia para lazy loading (UX-Ajuste).
 *
 * Mismo flag que `importWithRetry` (chunkImportRetry.ts) — un solo reload por sesion ante un
 * chunk fallido, sin importar si lo disparo una vista lazy o un import dinamico suelto (ej. el
 * generador de reportes Word).
 */
export const lazyWithRetry = <T extends React.ComponentType<any>>(componentImport: () => Promise<{ default: T }>) =>
    lazy(async () => {
        const pageHasAlreadyBeenForceRefreshed = JSON.parse(
            window.localStorage.getItem(FORCE_REFRESH_FLAG) || 'false'
        );

        try {
            const module = await componentImport();
            if (!module || !module.default) {
                throw new Error('Module default export not found');
            }
            return module;
        } catch (error) {
            if (!pageHasAlreadyBeenForceRefreshed) {
                window.localStorage.setItem(FORCE_REFRESH_FLAG, 'true');
                window.location.reload();
                // Return a never-resolving promise to allow the browser to reload without React crashing
                return new Promise<{ default: T }>(() => { });
            }
            Logger.error('Fallo critico al cargar vista (ChunkLoadError)', { path: window.location.pathname }, error);
            throw error;
        }
    });
