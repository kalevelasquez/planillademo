import { useCallback, useRef } from 'react';
import { useToast } from '../context/ToastContext';

/**
 * Hook de Resiliencia: Monitorea acciones asíncronas y muestra una alerta
 * si exceden un umbral de tiempo (default 60s).
 */
export const useTimeoutGuard = () => {
    const { showToast } = useToast();
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const trackAction = useCallback(async <T>(
        _operationName: string,
        promise: Promise<T>,
        timeoutMs: number = 60000
    ): Promise<T> => {
        // Limpiar cualquier timeout previo
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        // Iniciar guardia de tiempo
        timeoutRef.current = setTimeout(() => {
            showToast(
                "La operación está tardando demasiado. ¿Deseas reintentar o refrescar la página?",
                "warning",
                {
                    label: "Refrescar",
                    onClick: () => window.location.reload()
                }
            );
        }, timeoutMs);

        try {
            const result = await promise;
            return result;
        } finally {
            // Si la promesa termina (éxito o error), cancelamos la alerta
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
                timeoutRef.current = null;
            }
        }
    }, [showToast]);

    return { trackAction };
};
