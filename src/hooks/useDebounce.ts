import { useState, useEffect } from 'react';

/**
 * Hook para retrasar la actualización de un valor (debounce).
 * Útil para búsquedas y optimización de llamadas de red.
 */
export function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        // Establecer el temporizador
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        // Limpiar el temporizador si el valor cambia o el componente se desmonta
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
}
